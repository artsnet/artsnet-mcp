# Contributing

Thanks for helping.

- The tool surface lives in `src/server.ts` and is shared by the stdio binary (`src/mcp.ts`) and the Worker (`worker/index.ts`). Change it in one place.
- The API contract comes from the Artsnet repository (`/api/v1`). A field added there can be surfaced here; a field this package needs must be added there first.
- Tests use a fetch double (`tests/helpers.ts`) and never call artsnet.com.

```bash
npm install
npm run typecheck && npm test && npm run build
npx wrangler deploy --dry-run --outdir /tmp/artsnet-mcp-worker   # bundles the Worker without deploying
```

Commit messages: a short imperative summary line, optionally followed by why.
