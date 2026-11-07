import { VERSION } from "./version.js";

/**
 * A small client for Artsnet's public catalogue API (/api/v1). The API is read-only, needs no
 * key, and returns Artsnet's editorial data under CC BY 4.0 together with YouTube identifiers.
 * It never returns YouTube view, like or comment counts.
 */

export const DEFAULT_API_BASE = "https://artsnet.com/api/v1";
export const DEFAULT_USER_AGENT = `artsnet-mcp/${VERSION} (+https://github.com/artsnet/artsnet-mcp)`;
export const DEFAULT_TIMEOUT_MS = 15_000;

export const songLanguages = ["ja", "en", "other"] as const;
export const songStatuses = ["noticed", "performance-candidate"] as const;
export type SongLanguage = (typeof songLanguages)[number];
export type SongStatus = (typeof songStatuses)[number];

export type License = { name: string; url: string; attribution: string; covers: string };

export type PerformerCandidate =
  | { kind: "recommendation"; source: string; rank: number; performer: { slug: string; name: { native: string; romanized: string }; description: { ja: string; en: string } }; rationale: { ja: string; en: string } }
  | { kind: "nomination"; performerKey: string; name: { default: string; ja: string | null; en: string | null }; description: { ja: string | null; en: string | null }; wikidataUrl: string | null; youtubeChannelUrl: string | null; image: { url: string; filePageUrl: string; licenseName: string; licenseUrl: string; artistCredit: string } | null; reviewedAt: string | null };

export type Song = {
  slug: string;
  url: { ja: string; en: string };
  status: SongStatus;
  language: SongLanguage;
  title: { original: string; ja: string; en: string };
  description: { ja: string; en: string };
  genres: string[];
  tags: Array<{ slug: string; category: string; label: { ja: string; en: string } }>;
  youtube: { videoId: string; url: string; channelId: string | null; channelTitle: string | null; publishedAt: string | null } | null;
  performerCandidates: PerformerCandidate[];
  approvedAt: string | null;
  cataloguedAt: string;
  updatedAt: string;
};

export type Tag = { slug: string; category: string; label: { ja: string; en: string } };

export type Envelope = { schemaVersion: number; license: License; generatedAt: string };
export type SearchResult = Envelope & { songs: Song[]; nextCursor: string | null };
export type SongResult = Envelope & { song: Song };
export type TagsResult = Envelope & { tags: Tag[] };

export type SearchParams = {
  /** Keywords matched against titles, channel name, performer names and tag slugs. */
  query?: string | undefined;
  language?: SongLanguage | undefined;
  status?: SongStatus | undefined;
  /** Tag slugs; a song must carry every one. */
  tags?: readonly string[] | undefined;
  /** ISO timestamp: only songs updated at or after it (incremental sync). */
  since?: string | undefined;
  /** 1 to 100. Default 50 on the server. */
  limit?: number | undefined;
  cursor?: string | undefined;
};

export type ArtsnetApiErrorCode = "invalid-input" | "not-found" | "unavailable";

export class ArtsnetApiError extends Error {
  readonly code: ArtsnetApiErrorCode;
  readonly status: number | null;
  readonly detail: string | null;

  constructor(code: ArtsnetApiErrorCode, options: { status?: number | null; detail?: string | null; cause?: unknown } = {}) {
    super(`Artsnet API request failed: ${code}${options.detail ? ` (${options.detail})` : ""}`, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ArtsnetApiError";
    this.code = code;
    this.status = options.status ?? null;
    this.detail = options.detail ?? null;
  }
}

export type ClientOptions = {
  /** Base URL of the API. Default `https://artsnet.com/api/v1`. */
  baseUrl?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  /** Identify your application; the default names only this package. */
  userAgent?: string;
};

export type ArtsnetClient = {
  readonly baseUrl: string;
  searchSongs(params?: SearchParams): Promise<SearchResult>;
  getSong(slug: string): Promise<SongResult>;
  listTags(): Promise<TagsResult>;
};

/** Slugs embed YouTube video IDs: mixed case, digits, "_" and "-" (e.g. youtube-3GXxiE-xG7w). */
export const SLUG_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createArtsnetClient(options: ClientOptions = {}): ArtsnetClient {
  const baseUrl = (options.baseUrl ?? DEFAULT_API_BASE).replace(/\/+$/, "");
  if (!/^https?:\/\//.test(baseUrl)) throw new ArtsnetApiError("invalid-input", { detail: "baseUrl must be an http(s) URL" });
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const headers = { Accept: "application/json", "User-Agent": options.userAgent ?? DEFAULT_USER_AGENT };

  async function request<T extends Envelope>(path: string, params?: URLSearchParams): Promise<T> {
    const url = `${baseUrl}${path}${params && [...params.keys()].length ? `?${params}` : ""}`;
    let response: Response;
    try {
      response = await fetcher(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      throw new ArtsnetApiError("unavailable", { cause: error });
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    const detail = isRecord(body) && typeof body.detail === "string" ? body.detail : null;
    if (response.status === 404) throw new ArtsnetApiError("not-found", { status: 404, detail });
    if (response.status === 400) throw new ArtsnetApiError("invalid-input", { status: 400, detail });
    if (!response.ok) throw new ArtsnetApiError("unavailable", { status: response.status, detail });
    if (!isRecord(body) || typeof body.schemaVersion !== "number" || !isRecord(body.license)) throw new ArtsnetApiError("unavailable", { status: response.status, detail: "unexpected response shape" });
    return body as T;
  }

  return {
    baseUrl,
    searchSongs(params = {}) {
      const search = new URLSearchParams();
      const query = params.query?.trim();
      if (query) search.set("q", query);
      if (params.language) search.set("language", params.language);
      if (params.status) search.set("status", params.status);
      for (const tag of params.tags ?? []) search.append("tag", tag);
      if (params.since) search.set("since", params.since);
      if (params.limit !== undefined) search.set("limit", String(params.limit));
      if (params.cursor) search.set("cursor", params.cursor);
      return request<SearchResult>("/songs", search);
    },
    getSong(slug) {
      const trimmed = slug.trim();
      if (!SLUG_PATTERN.test(trimmed)) return Promise.reject(new ArtsnetApiError("invalid-input", { detail: "not a song slug" }));
      return request<SongResult>(`/songs/${encodeURIComponent(trimmed)}`);
    },
    listTags() {
      return request<TagsResult>("/tags");
    },
  };
}
