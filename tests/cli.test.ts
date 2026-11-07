import { describe, expect, it, vi } from "vitest";
import { ArtsnetApiError, type ArtsnetClient } from "../src/client.js";
import { EXIT_CODES, HELP, parseArgs, runCli } from "../src/cli.js";
import { VERSION } from "../src/version.js";
import { license, song, tag } from "./helpers.js";

const envelope = { schemaVersion: 1, license, generatedAt: "2026-11-07T00:00:00.000Z" };

function io(argv: string[], overrides: Partial<ArtsnetClient> = {}, env: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const createClient = vi.fn(() => ({
    baseUrl: "https://artsnet.com/api/v1",
    searchSongs: vi.fn(async () => ({ ...envelope, songs: [song], nextCursor: null })),
    getSong: vi.fn(async () => ({ ...envelope, song })),
    listTags: vi.fn(async () => ({ ...envelope, tags: [tag] })),
    ...overrides,
  }));
  return { run: () => runCli({ argv, env, stdout: (t) => out.push(t), stderr: (t) => err.push(t), createClient }), out, err, createClient };
}

describe("parseArgs", () => {
  it("parses search with every filter", () => {
    expect(parseArgs(["search", "dream", "wave", "--language", "en", "--status", "noticed", "--tag", "a", "--tag", "b", "--since", "2026-01-01", "--limit", "7", "--cursor", "c", "--json", "--base", "http://x/api/v1", "--user-agent", "U/1"])).toEqual({
      command: { kind: "search", params: { query: "dream wave", language: "en", status: "noticed", tags: ["a", "b"], since: "2026-01-01", limit: 7, cursor: "c" } },
      json: true,
      client: { baseUrl: "http://x/api/v1", userAgent: "U/1" },
    });
  });

  it("parses get and tags and reads env defaults", () => {
    expect(parseArgs(["get", "night-highway"], { ARTSNET_API_BASE: "http://localhost:8787/api/v1" })).toEqual({ command: { kind: "get", slug: "night-highway" }, json: false, client: { baseUrl: "http://localhost:8787/api/v1" } });
    expect(parseArgs(["tags"])).toMatchObject({ command: { kind: "tags" } });
    expect(parseArgs(["--help"])).toMatchObject({ command: { kind: "help" } });
  });

  it.each([[], ["nope"], ["get"], ["get", "a", "b"], ["tags", "x"], ["search", "--language", "fr"], ["search", "--status", "draft"], ["search", "--limit", "0"], ["search", "--bogus"], ["search", "--tag"]])("rejects %j", (...argv) => {
    expect(parseArgs(argv).command).toMatchObject({ kind: "usage-error" });
  });
});

describe("runCli", () => {
  it("prints help and version", async () => {
    const help = io(["-h"]);
    expect(await help.run()).toBe(0);
    expect(help.out.join("")).toBe(HELP);
    const version = io(["-v"]);
    await version.run();
    expect(version.out.join("")).toBe(`${VERSION}\n`);
  });

  it("prints JSON or a readable listing with the license line", async () => {
    const json = io(["search", "dream", "--json"]);
    expect(await json.run()).toBe(0);
    expect(JSON.parse(json.out.join(""))).toMatchObject({ songs: [song] });
    const human = io(["search", "dream"]);
    await human.run();
    expect(human.out.join("")).toContain("night-highway  Endless Dream");
    expect(human.out.join("")).toContain("performer candidates: Piano Trio");
    expect(human.out.join("")).toContain("data: CC BY 4.0, Artsnet (https://artsnet.com)");
  });

  it("gets a song and lists tags", async () => {
    const get = io(["get", "night-highway"]);
    expect(await get.run()).toBe(0);
    expect(get.out.join("")).toContain("youtube: https://www.youtube.com/watch?v=dQw4w9WgXcQ (Moon1k)");
    const tags = io(["tags"]);
    await tags.run();
    expect(tags.out.join("")).toContain("dreamwave");
  });

  it("maps API failures to exit codes and a JSON failure line", async () => {
    const missing = io(["get", "missing"], { getSong: vi.fn(async () => { throw new ArtsnetApiError("not-found", { detail: "No public song has that slug." }); }) });
    expect(await missing.run()).toBe(EXIT_CODES["not-found"]);
    expect(missing.err.join("")).toContain("error: not-found: No public song has that slug.");
    const down = io(["tags", "--json"], { listTags: vi.fn(async () => { throw new Error("boom"); }) });
    expect(await down.run()).toBe(EXIT_CODES.unavailable);
    expect(JSON.parse(down.out.join(""))).toMatchObject({ ok: false, error: { code: "unavailable" } });
  });
});
