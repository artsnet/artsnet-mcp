import { vi } from "vitest";
import type { Song, Tag } from "../src/client.js";

export const license = { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/", attribution: "Artsnet (https://artsnet.com)", covers: "editorial data" };

export const song: Song = {
  slug: "night-highway",
  url: { ja: "https://artsnet.com/ja/songs/night-highway", en: "https://artsnet.com/en/songs/night-highway" },
  status: "noticed",
  language: "en",
  title: { original: "Endless Dream", ja: "Endless Dream", en: "Endless Dream" },
  description: { ja: "ドリームウェーブ", en: "A dreamwave track" },
  genres: ["dreamwave"],
  tags: [{ slug: "dreamwave", category: "genre", label: { ja: "ドリームウェーブ", en: "Dreamwave" } }],
  youtube: { videoId: "dQw4w9WgXcQ", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", channelId: "UCBR8-60-B28hp2BmDPdntcQ", channelTitle: "Moon1k", publishedAt: null },
  performerCandidates: [{ kind: "nomination", performerKey: "wikidata:Q1", name: { default: "Piano Trio", ja: "ピアノトリオ", en: "Piano Trio" }, description: { ja: null, en: null }, wikidataUrl: "https://www.wikidata.org/wiki/Q1", youtubeChannelUrl: null, image: null, reviewedAt: null }],
  approvedAt: "2026-09-13T03:00:00.000Z",
  cataloguedAt: "2026-09-13T03:00:00.000Z",
  updatedAt: "2026-09-14T03:00:00.000Z",
};

export const tag: Tag = { slug: "dreamwave", category: "genre", label: { ja: "ドリームウェーブ", en: "Dreamwave" } };

export type Call = { url: URL; init: RequestInit | undefined };

/** A fetch double that answers like the v1 API and records calls. */
export function fakeApi(overrides: { songs?: Song[]; nextCursor?: string | null; status?: number; body?: unknown } = {}) {
  const calls: Call[] = [];
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push({ url, init });
    const envelope = { schemaVersion: 1, license, generatedAt: "2026-11-07T00:00:00.000Z" };
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (overrides.status) return json(overrides.body ?? { schemaVersion: 1, error: "x", detail: "forced" }, overrides.status);
    if (url.pathname.endsWith("/tags")) return json({ ...envelope, tags: [tag] });
    if (/\/songs\/[^/]+$/.test(url.pathname)) {
      const slug = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      return slug === song.slug ? json({ ...envelope, song }) : json({ schemaVersion: 1, error: "not-found", detail: "No public song has that slug." }, 404);
    }
    if (url.pathname.endsWith("/songs")) return json({ ...envelope, songs: overrides.songs ?? [song], nextCursor: overrides.nextCursor ?? null });
    return new Response("", { status: 500 });
  });
  return { fetcher: fetcher as unknown as typeof fetch, calls };
}
