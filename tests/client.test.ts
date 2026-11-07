import { describe, expect, it } from "vitest";
import { ArtsnetApiError, createArtsnetClient, DEFAULT_USER_AGENT } from "../src/client.js";
import { fakeApi, license, song, tag } from "./helpers.js";

describe("createArtsnetClient", () => {
  it("builds the search URL from params and sends identifying headers", async () => {
    const api = fakeApi({ nextCursor: "abc" });
    const client = createArtsnetClient({ fetcher: api.fetcher, userAgent: "Test/1" });
    const result = await client.searchSongs({ query: " piano ", language: "ja", status: "noticed", tags: ["j-pop", "acoustic"], since: "2026-01-01T00:00:00Z", limit: 5, cursor: "c1" });
    expect(result).toMatchObject({ schemaVersion: 1, license, songs: [song], nextCursor: "abc" });
    const call = api.calls[0];
    expect(`${call?.url.origin}${call?.url.pathname}`).toBe("https://artsnet.com/api/v1/songs");
    expect(Object.fromEntries(call?.url.searchParams ?? [])).toEqual({ q: "piano", language: "ja", status: "noticed", tag: "acoustic", since: "2026-01-01T00:00:00Z", limit: "5", cursor: "c1" });
    expect(call?.url.searchParams.getAll("tag")).toEqual(["j-pop", "acoustic"]);
    expect(call?.init?.headers).toMatchObject({ Accept: "application/json", "User-Agent": "Test/1" });
  });

  it("sends no query string for an empty search and uses the default User-Agent and base", async () => {
    const api = fakeApi();
    await createArtsnetClient({ fetcher: api.fetcher }).searchSongs();
    expect(api.calls[0]?.url.href).toBe("https://artsnet.com/api/v1/songs");
    expect(api.calls[0]?.init?.headers).toMatchObject({ "User-Agent": DEFAULT_USER_AGENT });
  });

  it("gets a song, lists tags, and honours a custom base URL", async () => {
    const api = fakeApi();
    const client = createArtsnetClient({ fetcher: api.fetcher, baseUrl: "http://localhost:8787/api/v1/" });
    await expect(client.getSong("night-highway")).resolves.toMatchObject({ song });
    await expect(client.listTags()).resolves.toMatchObject({ tags: [tag] });
    expect(api.calls.map((call) => call.url.href)).toEqual(["http://localhost:8787/api/v1/songs/night-highway", "http://localhost:8787/api/v1/tags"]);
  });

  it("maps 404, 400, other statuses, network failures and bad shapes to error codes", async () => {
    const client = (fetcher: typeof fetch) => createArtsnetClient({ fetcher });
    await expect(client(fakeApi().fetcher).getSong("missing")).rejects.toMatchObject({ code: "not-found", status: 404, detail: "No public song has that slug." });
    await expect(client(fakeApi({ status: 400 }).fetcher).searchSongs()).rejects.toMatchObject({ code: "invalid-input", status: 400, detail: "forced" });
    await expect(client(fakeApi({ status: 503 }).fetcher).searchSongs()).rejects.toMatchObject({ code: "unavailable", status: 503 });
    await expect(client((async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch).searchSongs()).rejects.toMatchObject({ code: "unavailable", cause: expect.any(TypeError) });
    await expect(client((async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch).searchSongs()).rejects.toMatchObject({ code: "unavailable" });
    await expect(client((async () => Response.json({ hello: 1 })) as unknown as typeof fetch).listTags()).rejects.toMatchObject({ code: "unavailable", detail: "unexpected response shape" });
  });

  it("rejects a malformed slug and a bad base URL before any request", async () => {
    const api = fakeApi();
    await expect(createArtsnetClient({ fetcher: api.fetcher }).getSong("Not A Slug")).rejects.toBeInstanceOf(ArtsnetApiError);
    expect(api.calls).toHaveLength(0);
    expect(() => createArtsnetClient({ baseUrl: "ftp://x" })).toThrow(ArtsnetApiError);
  });
});
