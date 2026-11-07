#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { ArtsnetApiError, createArtsnetClient, songLanguages, songStatuses, type ArtsnetClient, type SearchParams, type Song } from "./client.js";
import { API_BASE_ENV, USER_AGENT_ENV } from "./env.js";
import { clientOptionsFromEnv } from "./server.js";
import { VERSION } from "./version.js";

export const EXIT_CODES = { ok: 0, usage: 1, "invalid-input": 2, "not-found": 3, unavailable: 4 } as const;

export const HELP = `artsnet ${VERSION}
Read Artsnet's catalogue of reviewed AI-created songs (artsnet.com/api/v1). No key. Data: CC BY 4.0, credit "Artsnet (https://artsnet.com)".

Usage:
  artsnet search [<keywords>] [--language ja|en|other] [--status noticed|performance-candidate] [--tag <slug>]... [--since <iso>] [--limit <n>] [--cursor <c>] [--json]
  artsnet get <slug> [--json]
  artsnet tags [--json]

Options:
  --json               Print the API response as JSON
  --base <url>         API base (default: https://artsnet.com/api/v1, or ${API_BASE_ENV})
  --user-agent <ua>    Identify your application (or ${USER_AGENT_ENV})
  -h, --help           Show this help
  -v, --version        Print the version

Exit codes: 0 ok, 1 usage error, 2 rejected request, 3 not found, 4 artsnet.com unavailable.
`;

export type Command =
  | { kind: "search"; params: SearchParams }
  | { kind: "get"; slug: string }
  | { kind: "tags" }
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "usage-error"; message: string };

export type ParsedArgs = { command: Command; json: boolean; client: { baseUrl?: string; userAgent?: string } };

export function parseArgs(argv: readonly string[], env: Record<string, string | undefined> = {}): ParsedArgs {
  const client = clientOptionsFromEnv(env);
  let json = false;
  const positional: string[] = [];
  const params: SearchParams = {};
  const tags: string[] = [];
  const fail = (message: string): ParsedArgs => ({ command: { kind: "usage-error", message }, json, client });
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    const next = (): string => {
      const value = argv[(i += 1)];
      if (value === undefined || value === "") throw new Error(`${arg} needs a value`);
      return value;
    };
    try {
      switch (arg) {
        case "-h": case "--help": return { command: { kind: "help" }, json, client };
        case "-v": case "--version": return { command: { kind: "version" }, json, client };
        case "--json": json = true; break;
        case "--base": client.baseUrl = next(); break;
        case "--user-agent": client.userAgent = next(); break;
        case "--language": {
          const value = next();
          if (!(songLanguages as readonly string[]).includes(value)) throw new Error(`--language must be one of ${songLanguages.join(", ")}`);
          params.language = value as SearchParams["language"];
          break;
        }
        case "--status": {
          const value = next();
          if (!(songStatuses as readonly string[]).includes(value)) throw new Error(`--status must be one of ${songStatuses.join(", ")}`);
          params.status = value as SearchParams["status"];
          break;
        }
        case "--tag": tags.push(next()); break;
        case "--since": params.since = next(); break;
        case "--cursor": params.cursor = next(); break;
        case "--limit": {
          const value = Number(next());
          if (!Number.isInteger(value) || value < 1 || value > 100) throw new Error("--limit must be an integer from 1 to 100");
          params.limit = value;
          break;
        }
        default:
          if (arg.startsWith("-")) throw new Error(`unknown option ${arg}`);
          positional.push(arg);
      }
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  }
  if (tags.length) params.tags = tags;
  const [name, ...rest] = positional;
  if (name === "search") {
    const query = rest.join(" ").trim();
    if (query) params.query = query;
    return { command: { kind: "search", params }, json, client };
  }
  if (name === "get") {
    if (rest.length !== 1) return fail("get needs exactly one slug");
    return { command: { kind: "get", slug: rest[0] as string }, json, client };
  }
  if (name === "tags") {
    if (rest.length) return fail("tags takes no arguments");
    return { command: { kind: "tags" }, json, client };
  }
  return fail(name ? `unknown command ${name}` : "missing command (search, get, tags)");
}

export function formatSong(song: Song): string {
  const lines = [
    `${song.slug}  ${song.title.original}`,
    `  ${song.status} · ${song.language} · approved ${song.approvedAt ?? "n/a"}`,
    `  ${song.url.en}`,
  ];
  if (song.description.en) lines.push(`  ${song.description.en}`);
  if (song.youtube) lines.push(`  youtube: ${song.youtube.url}${song.youtube.channelTitle ? ` (${song.youtube.channelTitle})` : ""}`);
  if (song.tags.length) lines.push(`  tags: ${song.tags.map((tag) => tag.slug).join(", ")}`);
  if (song.performerCandidates.length) {
    const names = song.performerCandidates.map((candidate) => (candidate.kind === "recommendation" ? candidate.performer.name.romanized : candidate.name.en ?? candidate.name.default));
    lines.push(`  performer candidates: ${names.join(", ")}`);
  }
  return `${lines.join("\n")}\n`;
}

export type CliIo = {
  argv: readonly string[];
  env?: Record<string, string | undefined>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  createClient?: (options: ParsedArgs["client"]) => ArtsnetClient;
};

export async function runCli(io: CliIo): Promise<number> {
  const { command, json, client: clientOptions } = parseArgs(io.argv, io.env ?? {});
  if (command.kind === "help") { io.stdout(HELP); return EXIT_CODES.ok; }
  if (command.kind === "version") { io.stdout(`${VERSION}\n`); return EXIT_CODES.ok; }
  if (command.kind === "usage-error") { io.stderr(`error: ${command.message}\n\n${HELP}`); return EXIT_CODES.usage; }
  try {
    const client = (io.createClient ?? createArtsnetClient)(clientOptions);
    if (command.kind === "search") {
      const result = await client.searchSongs(command.params);
      if (json) io.stdout(`${JSON.stringify(result)}\n`);
      else {
        io.stdout(result.songs.length ? result.songs.map(formatSong).join("") : "no songs matched\n");
        if (result.nextCursor) io.stdout(`more: --cursor ${result.nextCursor}\n`);
        io.stdout(`data: ${result.license.name}, ${result.license.attribution}\n`);
      }
    } else if (command.kind === "get") {
      const result = await client.getSong(command.slug);
      io.stdout(json ? `${JSON.stringify(result)}\n` : `${formatSong(result.song)}data: ${result.license.name}, ${result.license.attribution}\n`);
    } else {
      const result = await client.listTags();
      io.stdout(json ? `${JSON.stringify(result)}\n` : result.tags.map((tag) => `${tag.slug.padEnd(24)} ${tag.category.padEnd(9)} ${tag.label.en} / ${tag.label.ja}\n`).join(""));
    }
    return EXIT_CODES.ok;
  } catch (error) {
    const code = error instanceof ArtsnetApiError ? error.code : "unavailable";
    const detail = error instanceof ArtsnetApiError && error.detail ? `: ${error.detail}` : "";
    if (json) io.stdout(`${JSON.stringify({ ok: false, error: { code, message: `${code}${detail}` } })}\n`);
    else io.stderr(`error: ${code}${detail}\n`);
    return EXIT_CODES[code];
  }
}

const isEntryPoint = (() => {
  try {
    return process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (isEntryPoint) {
  runCli({ argv: process.argv.slice(2), env: process.env, stdout: (text) => process.stdout.write(text), stderr: (text) => process.stderr.write(text) }).then(
    (code) => { process.exitCode = code; },
    (error) => { process.stderr.write(`fatal: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = EXIT_CODES.usage; },
  );
}
