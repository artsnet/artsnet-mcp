import { describe, expect, it } from "vitest";
import { createWorkerHandler } from "../worker/index.js";
import { fakeApi, song } from "./helpers.js";

const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };

async function rpc(handler: ReturnType<typeof createWorkerHandler>, body: unknown, env = {}) {
  const response = await handler.fetch(new Request("https://mcp.example/mcp", { method: "POST", headers, body: JSON.stringify(body) }), env);
  return { response, json: response.headers.get("content-type")?.includes("json") ? await response.json() : null };
}

describe("Worker", () => {
  it("answers health and CORS preflight, and 404s other paths", async () => {
    const handler = createWorkerHandler({ fetcher: fakeApi().fetcher });
    const health = await handler.fetch(new Request("https://mcp.example/"));
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toMatchObject({ name: "artsnet-mcp", mcp: "/mcp" });
    const preflight = await handler.fetch(new Request("https://mcp.example/mcp", { method: "OPTIONS", headers: { Origin: "https://app.example" } }));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect((await handler.fetch(new Request("https://mcp.example/other"))).status).toBe(404);
  });

  it("serves initialize, tools/list and tools/call statelessly over JSON", async () => {
    const api = fakeApi();
    const handler = createWorkerHandler({ fetcher: api.fetcher });
    const init = await rpc(handler, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
    expect(init.response.status).toBe(200);
    expect(init.json).toMatchObject({ result: { serverInfo: { name: "artsnet" } } });
    const list = await rpc(handler, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    expect(list.json.result.tools.map((tool: { name: string }) => tool.name).sort()).toEqual(["get_song", "list_tags", "search_songs"]);
    const call = await rpc(handler, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_song", arguments: { slug: "night-highway" } } }, { ARTSNET_API_BASE: "http://localhost:8787/api/v1" });
    expect(call.json.result.structuredContent).toMatchObject({ ok: true, song });
    expect(api.calls.at(-1)?.url.href).toBe("http://localhost:8787/api/v1/songs/night-highway");
    expect(call.response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("restricts CORS to configured origins", async () => {
    const handler = createWorkerHandler({ fetcher: fakeApi().fetcher });
    const env = { ARTSNET_MCP_ALLOWED_ORIGINS: "https://good.example" };
    const good = await handler.fetch(new Request("https://mcp.example/", { headers: { Origin: "https://good.example" } }), env);
    expect(good.headers.get("Access-Control-Allow-Origin")).toBe("https://good.example");
    const bad = await handler.fetch(new Request("https://mcp.example/", { headers: { Origin: "https://evil.example" } }), env);
    expect(bad.headers.get("Access-Control-Allow-Origin")).toBe("null");
  });
});
