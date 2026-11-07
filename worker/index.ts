/**
 * The same tools over Streamable HTTP, for a Cloudflare Worker at mcp.artsnet.com (or any host).
 * Stateless: every request gets a fresh server and transport, so the Worker needs no storage and
 * scales horizontally. Deploy with `npm run worker:deploy` after setting the route in wrangler.jsonc.
 */
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createArtsnetClient } from "../src/client.js";
import { createServer } from "../src/server.js";
import { VERSION } from "../src/version.js";

export type WorkerEnv = {
  /** Override the API base, e.g. for a staging deployment. */
  ARTSNET_API_BASE?: string;
  /** Allowed browser origins for CORS, comma-separated. Default: any. */
  ARTSNET_MCP_ALLOWED_ORIGINS?: string;
};

const MCP_PATH = "/mcp";

function corsHeaders(env: WorkerEnv, request: Request): Record<string, string> {
  const allowed = env.ARTSNET_MCP_ALLOWED_ORIGINS?.split(",").map((value) => value.trim()).filter(Boolean);
  const origin = request.headers.get("Origin") ?? "";
  const allowOrigin = !allowed || allowed.length === 0 ? "*" : allowed.includes(origin) ? origin : "null";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
    "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version",
    "Access-Control-Max-Age": "86400",
  };
}

function withHeaders(response: Response, headers: Record<string, string>): Response {
  const copy = new Response(response.body, response);
  for (const [name, value] of Object.entries(headers)) copy.headers.set(name, value);
  return copy;
}

export function createWorkerHandler(options: { fetcher?: typeof fetch } = {}) {
  return {
    async fetch(request: Request, env: WorkerEnv = {}): Promise<Response> {
      const url = new URL(request.url);
      const cors = corsHeaders(env, request);
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      if (url.pathname === "/" || url.pathname === "/healthz") {
        return withHeaders(Response.json({ name: "artsnet-mcp", version: VERSION, mcp: MCP_PATH, data: "CC BY 4.0, Artsnet (https://artsnet.com)" }), cors);
      }
      if (url.pathname !== MCP_PATH) return withHeaders(new Response("Not found", { status: 404 }), cors);
      const clientOptions: Parameters<typeof createArtsnetClient>[0] = { userAgent: `artsnet-mcp-worker/${VERSION} (+https://github.com/artsnet/artsnet-mcp)` };
      if (env.ARTSNET_API_BASE) clientOptions.baseUrl = env.ARTSNET_API_BASE;
      if (options.fetcher) clientOptions.fetcher = options.fetcher;
      const server = createServer(createArtsnetClient(clientOptions));
      const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
      await server.connect(transport);
      try {
        return withHeaders(await transport.handleRequest(request), cors);
      } finally {
        // Close after the response has been produced; stateless transports are single-use.
        await transport.close().catch(() => {});
      }
    },
  };
}

export default createWorkerHandler();
