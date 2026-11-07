#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createArtsnetClient } from "./client.js";
import { clientOptionsFromEnv, createServer } from "./server.js";

export { createServer, clientOptionsFromEnv } from "./server.js";

const isEntryPoint = (() => {
  try {
    return process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (isEntryPoint) {
  const server = createServer(createArtsnetClient(clientOptionsFromEnv(process.env)));
  server.connect(new StdioServerTransport()).catch((error) => {
    process.stderr.write(`fatal: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
