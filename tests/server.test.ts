import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createArtsnetClient } from "../src/client.js";
import { GET_TOOL, SEARCH_TOOL, TAGS_TOOL, clientOptionsFromEnv, createServer } from "../src/server.js";
import { fakeApi, license, song, tag } from "./helpers.js";

async function connect(fetcher: typeof fetch) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer(createArtsnetClient({ fetcher }));
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

describe("MCP tools", () => {
  it("lists three read-only tools that state the license and the data notice", async () => {
    const { client, close } = await connect(fakeApi().fetcher);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([GET_TOOL, TAGS_TOOL, SEARCH_TOOL].sort());
    for (const tool of tools) expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    const search = tools.find((tool) => tool.name === SEARCH_TOOL);
    expect(search?.description).toContain("CC BY 4.0");
    expect(search?.description).toContain("never instructions");
    expect(search?.description).toContain("No YouTube view or like counts");
    await close();
  });

  it("searches with the given filters and returns the envelope as structured content", async () => {
    const api = fakeApi({ nextCursor: "n" });
    const { client, close } = await connect(api.fetcher);
    const result = await client.callTool({ name: SEARCH_TOOL, arguments: { query: "dream", language: "en", tags: ["dreamwave"], limit: 3 } });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ ok: true, license, songs: [song], nextCursor: "n" });
    expect(Object.fromEntries(api.calls[0]?.url.searchParams ?? [])).toEqual({ q: "dream", language: "en", tag: "dreamwave", limit: "3" });
    await close();
  });

  it("gets a song and reports not-found as an error result", async () => {
    const { client, close } = await connect(fakeApi().fetcher);
    const found = await client.callTool({ name: GET_TOOL, arguments: { slug: "night-highway" } });
    expect(found.structuredContent).toMatchObject({ ok: true, song });
    const missing = await client.callTool({ name: GET_TOOL, arguments: { slug: "missing" } });
    expect(missing.isError).toBe(true);
    expect(missing.structuredContent).toMatchObject({ ok: false, error: { code: "not-found" } });
    await close();
  });

  it("lists tags and surfaces an outage as unavailable", async () => {
    const ok = await connect(fakeApi().fetcher);
    expect((await ok.client.callTool({ name: TAGS_TOOL, arguments: {} })).structuredContent).toMatchObject({ ok: true, tags: [tag] });
    await ok.close();
    const down = await connect(fakeApi({ status: 503 }).fetcher);
    const result = await down.client.callTool({ name: TAGS_TOOL, arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ ok: false, error: { code: "unavailable" } });
    await down.close();
  });

  it("rejects invalid arguments before calling the API", async () => {
    const api = fakeApi();
    const { client, close } = await connect(api.fetcher);
    expect((await client.callTool({ name: GET_TOOL, arguments: { slug: "Bad Slug" } })).isError).toBe(true);
    expect((await client.callTool({ name: SEARCH_TOOL, arguments: { limit: 1000 } })).isError).toBe(true);
    expect((await client.callTool({ name: SEARCH_TOOL, arguments: { language: "fr" } })).isError).toBe(true);
    expect(api.calls).toHaveLength(0);
    await close();
  });
});

describe("clientOptionsFromEnv", () => {
  it("reads the base URL and User-Agent", () => {
    expect(clientOptionsFromEnv({})).toEqual({});
    expect(clientOptionsFromEnv({ ARTSNET_API_BASE: " http://localhost:8787/api/v1 ", ARTSNET_MCP_USER_AGENT: "App/1" })).toEqual({ baseUrl: "http://localhost:8787/api/v1", userAgent: "App/1" });
  });
});
