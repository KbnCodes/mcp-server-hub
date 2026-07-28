# MCP Server Hub

**Host multiple Model Context Protocol servers behind one authenticated gateway — in one click.**

A production-ready, stateless [Streamable HTTP](https://modelcontextprotocol.io/specification) hub that gives your AI agents (Claude, Cursor, LibreChat, custom clients) instant access to web fetching, shared memory, GitHub, Postgres and utility tools — all from a single Railway service with a single Bearer token.

Built for the **2026-07-28 MCP spec revision**: no sessions, no sticky routing, any replica serves any request.

**Deploy it, or run it locally:**

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template) &nbsp; [![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/KbnCodes/mcp-server-hub)

```bash
# ...or try it on your machine in one command (auto-generates a dev token):
npx @kbncodes/mcp-server-hub --dev
```

---

## Why this hub?

| | This template | Typical MCP templates |
|---|---|---|
| Servers per deploy | **5 in one service** | 1 |
| Authentication | Bearer token (timing-safe compare), spec-compliant `401 + WWW-Authenticate` + RFC 9728 metadata | None, optional, or hardcoded defaults |
| Transport | Stateless Streamable HTTP (2026-07-28-ready) | Often deprecated SSE or sessionful |
| Admin UI | Built-in status dashboard at `/` | None |
| Healthcheck | `/health` wired into Railway | Usually missing |
| Horizontal scaling | Yes — stateless, no session store | Rarely |

## What's inside

| Server | Endpoint | Tools | Requires |
|---|---|---|---|
| **Utils** | `/mcp/utils` | `current_time`, `convert_timezone`, `generate_uuid`, `hash_text`, `base64`, `calculate` | — |
| **Fetch** | `/mcp/fetch` | `fetch_url` (HTML→clean text), `fetch_json` | — |
| **Memory** | `/mcp/memory` | `memory_set/get/list/delete/search` — shared agent notes | — (volume optional) |
| **GitHub** | `/mcp/github` | `search_repositories`, `get_repo`, `get_file`, `list_issues` | `GITHUB_TOKEN` |
| **Postgres** | `/mcp/postgres` | `list_tables`, `describe_table`, `query` (READ ONLY transactions) | `DATABASE_URL` |

Plus:

- **Admin dashboard** at `/` — server status, tool inventory, copy-paste client config
- **`/health`** healthcheck endpoint (configured in `railway.json`)
- **`/.well-known/oauth-protected-resource`** — RFC 9728 Protected Resource Metadata

## Deploy on Railway

1. Click **Deploy** on the template page (or deploy this repo).
2. Railway auto-generates a strong `AUTH_TOKEN` for you.
3. Open your service URL — the dashboard walks you through connecting a client.

That's it. Optionally:

- Add a **GitHub token** (`GITHUB_TOKEN`) to enable the GitHub server.
- Attach a **Postgres database** and set `DATABASE_URL=${{Postgres.DATABASE_URL}}` to enable read-only SQL.
- Mount a **volume** at `/data` and set `MEMORY_FILE=/data/memory.json` to persist agent memory.

> Railway is the recommended home for this template: it lists in the marketplace for discovery and pays template authors via the **25% Template Kickback Program**.

## Run locally with `npx`

Want to try it on your machine first? The hub is published to npm — no clone, no build:

```bash
npx @kbncodes/mcp-server-hub --dev
```

`--dev` (or any interactive terminal) auto-generates an ephemeral `AUTH_TOKEN`, prints it, and serves the dashboard at http://localhost:8080/. For a stable token, set it yourself:

```bash
AUTH_TOKEN=$(openssl rand -hex 32) npx @kbncodes/mcp-server-hub
```

> The published binary stays **production-safe**: in a non-interactive environment (containers, CI) it still fails closed and refuses to start without `AUTH_TOKEN` unless you set `ALLOW_NO_AUTH=true`.

## Deploy on Render

This repo ships a [`render.yaml`](render.yaml) blueprint, so Render provisions everything (Docker build, `/health` check, auto-generated `AUTH_TOKEN`) in one click:

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/KbnCodes/mcp-server-hub)

After the first deploy, set `PUBLIC_URL` to your Render URL (e.g. `https://mcp-server-hub.onrender.com`) so the auth challenge and RFC 9728 metadata advertise the correct address. To persist memory, add a Render disk mounted at `/data` and set `MEMORY_FILE=/data/memory.json` (see the commented block in `render.yaml`).

## Deploy on Manufact Cloud

[Manufact](https://manufact.com/) is an MCP-native host that can also distribute your server to the **ChatGPT Apps Store, Claude Connectors, and Gemini**. Because this hub uses the official `@modelcontextprotocol/sdk`, you can deploy it as-is:

1. Push this repo to GitHub and connect it in Manufact Cloud (every push auto-deploys), or use the CLI:
   ```bash
   npm install -g @mcp-use/cli
   mcp-use login
   mcp-use deploy
   ```
2. Set `AUTH_TOKEN` (plus any optional `GITHUB_TOKEN` / `DATABASE_URL`) in the Manufact environment settings.
3. Set `PUBLIC_URL` to the assigned Manufact URL.

> **Note:** Manufact is **usage-based hosting that you pay for** — it does **not** offer template revenue sharing. Use it for *reach* (ChatGPT/Claude/Gemini distribution); use **Railway's 25% Template Kickback** for *earnings*.

## Connect a client

Any MCP client that speaks Streamable HTTP works. Point it at a server endpoint and pass your token:

```json
{
  "mcpServers": {
    "hub-fetch": {
      "url": "https://YOUR-APP.up.railway.app/mcp/fetch",
      "headers": { "Authorization": "Bearer YOUR_AUTH_TOKEN" }
    },
    "hub-memory": {
      "url": "https://YOUR-APP.up.railway.app/mcp/memory",
      "headers": { "Authorization": "Bearer YOUR_AUTH_TOKEN" }
    }
  }
}
```

Quick smoke test with curl:

```bash
curl -X POST https://YOUR-APP.up.railway.app/mcp/utils \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `AUTH_TOKEN` | **Yes** | — | Bearer token for `/mcp/*` and `/api/*`. Auto-generated by the Railway template. |
| `ENABLED_SERVERS` | No | `all` | Comma-separated server ids (`utils,fetch,memory,github,postgres`) or `all`. |
| `GITHUB_TOKEN` | No | — | GitHub PAT; activates the `github` server. |
| `DATABASE_URL` | No | — | Postgres connection string; activates the `postgres` server (read-only). |
| `MEMORY_FILE` | No | — | File path (on a volume) to persist the memory server, e.g. `/data/memory.json`. |
| `FETCH_MAX_BYTES` | No | `1000000` | Max bytes fetched per request by the fetch server. |
| `STRICT_HEADER_VALIDATION` | No | `false` | Reject `Mcp-Method` header/body mismatches (2026-07-28 behavior) instead of warning. |
| `RATE_LIMIT_RPM` | No | `120` | Requests per minute per IP on `/mcp/*` and `/api/*`; 429 beyond. |
| `MAX_BODY_BYTES` | No | `1000000` | Max JSON request body size in bytes. |
| `ALLOW_NO_AUTH` | No | `false` | Explicit opt-in to run without authentication (the hub refuses to start otherwise when `AUTH_TOKEN` is unset). |
| `PUBLIC_URL` | No | — | Canonical `scheme://host` used in auth challenges and RFC 9728 metadata. |
| `AUDIT_LOG` | No | `false` | Log one structured JSON line per MCP request (ip, server, method, tool, status). |
| `FETCH_ALLOW_HOSTS` | No | — | Comma-separated hostname allowlist for the fetch server. |
| `PORT` | No | `8080` | Listen port (Railway injects this). |

## Spec compliance & the 2026-07-28 revision

This hub is **stateless by design**, which is exactly the model the 2026-07-28 MCP revision standardizes:

- **No sessions** — no `Mcp-Session-Id`, no sticky routing; a fresh MCP server instance handles each request (`sessionIdGenerator: undefined`). Scale replicas freely.
- **`MCP-Protocol-Version` validation** — unsupported versions get a clean `400` (per spec since 2025-03-26). Accepted: `2024-11-05` → `2026-07-28`.
- **`Mcp-Method` header awareness (SEP-2243)** — mismatches between the new routing header and the JSON-RPC body are logged, or rejected with `STRICT_HEADER_VALIDATION=true`.
- **Authorization done right** — `Authorization: Bearer` verified with a timing-safe compare; failures return `401` with a `WWW-Authenticate` challenge pointing at RFC 9728 resource metadata.
- **No deprecated surfaces** — no HTTP+SSE legacy transport, no Roots/Sampling/Logging reliance (deprecated in the new revision).

When the v2 SDK (`@modelcontextprotocol/server` 2.x) goes stable alongside the final spec, migration is isolated to `src/index.ts` (transport) and the per-server factories — the stateless architecture carries over unchanged.

## Local development

```bash
cp .env.example .env   # set AUTH_TOKEN
npm install
npm run dev            # hot-reload dev server
npm run build && npm start
```

## Architecture

```
src/
  index.ts        Express gateway: auth, protocol validation, stateless MCP handling
  config.ts       Env configuration + supported protocol versions
  registry.ts     Server catalog (id → factory); fresh McpServer per request
  admin.ts        Self-contained dashboard (no build step)
  servers/
    utils.ts      Time/UUID/hash/base64/calculator (safe expression parser)
    fetch.ts      Bounded web fetch with SSRF guards + HTML cleanup
    memory.ts     Shared notes store, optional volume persistence
    github.ts     Read-only GitHub REST tools
    postgres.ts   READ ONLY transaction SQL tools
```

**Security posture:**

- **Authentication** — mandatory Bearer token (fail-closed: the hub refuses to start without `AUTH_TOKEN` unless `ALLOW_NO_AUTH=true`), timing-safe comparison, brute-force lockout (10 failed attempts/min per IP → 429).
- **Rate limiting** — per-IP limits on `/mcp/*` and `/api/*` (`RATE_LIMIT_RPM`), standard `RateLimit` headers.
- **SSRF defense** — the fetch server resolves every hostname via DNS and blocks all private/reserved ranges (IPv4 + IPv6, incl. cloud metadata `169.254.169.254`); redirects are followed manually with every hop re-validated; embedded credentials rejected; optional `FETCH_ALLOW_HOSTS` allowlist.
- **SQL isolation** — Postgres queries run single-statement over the extended query protocol inside `READ ONLY` transactions with statement + idle timeouts; multi-statement strings (e.g. `COMMIT; DROP …`) are rejected by the database itself.
- **No code execution** — hand-written arithmetic parser, no `eval`/codegen anywhere.
- **Hardened HTTP surface** — helmet security headers, strict CSP with per-request nonces on the dashboard, `X-Frame-Options: DENY`, `Cache-Control: no-store` on token-bearing routes, sanitized JSON-RPC error responses (no stack traces or paths), body-size limits, slowloris timeouts.
- **Input validation** — zod schemas with length caps on every tool input; server ids, GitHub owner/repo names and file paths validated against strict patterns; memory store capped (1000 entries / 10 MB) with atomic persistence.
- **Least privilege** — runs as non-root `node` user in Docker; secrets only via environment variables; API error messages scrubbed of tokens.
- **Auditability** — optional structured request log (`AUDIT_LOG=true`).

See [SECURITY.md](SECURITY.md) for the vulnerability reporting policy.

## Adding your own server

1. Create `src/servers/myserver.ts` exporting `createMyServer(config): McpServer` and register tools with `server.registerTool(...)`.
2. Add an entry to `src/registry.ts` with an id, description, tool list and factory.
3. Redeploy — it appears in the dashboard and at `/mcp/myserver`.

## License

MIT
