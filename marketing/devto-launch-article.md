---
title: "I built one gateway to give AI agents web, memory, GitHub & Postgres — in one command"
published: false
description: "MCP Server Hub bundles five Model Context Protocol servers behind a single authenticated, stateless Streamable-HTTP endpoint. Here's why and how."
tags: ai, mcp, opensource, typescript
cover_image: https://cdn.jsdelivr.net/gh/KbnCodes/mcp-server-hub@main/assets/hero-diagram.svg
canonical_url: https://github.com/KbnCodes/mcp-server-hub
---

> **TL;DR** — [MCP Server Hub](https://github.com/KbnCodes/mcp-server-hub) is a stateless Streamable-HTTP gateway hosting **five MCP servers** (web fetch, shared memory, GitHub, Postgres, utilities) behind **one Bearer token**. Try it now: `npx @kbncodes/mcp-server-hub --dev`.

## The problem

If you've built more than one AI agent, this will feel familiar. Every project starts by re-wiring the same tools:

- A **web fetcher** so the agent can read pages.
- A **memory store** so it remembers things between turns.
- **GitHub** access to read repos and issues.
- A **database** connection for real data.
- A grab-bag of **utilities** — hashing, UUIDs, timestamps.

Each one is a separate MCP server: a separate process, a separate config entry, a separate thing to authenticate and secure. Multiply that across projects and you're maintaining the same plumbing over and over.

## The idea

What if all of that lived behind **one URL**, guarded by **one token**?

That's MCP Server Hub. Point any MCP client — Claude, Cursor, LibreChat, or your own — at a single endpoint, pass a Bearer token, and the agent gets all five toolsets at once:

| Server | Path | What it does |
|---|---|---|
| 🌐 Fetch | `/mcp/fetch` | Bounded web fetch with SSRF guards + HTML cleanup |
| 🧠 Memory | `/mcp/memory` | Shared notes store, optional volume persistence |
| 🐙 GitHub | `/mcp/github` | Read-only repo / issue / file tools |
| 🐘 Postgres | `/mcp/postgres` | Querying inside READ-ONLY transactions |
| 🛠️ Utils | `/mcp/utils` | Time, UUID, hash, base64, safe calculator |

## Why stateless matters

MCP Server Hub is built for the **2026-07-28 MCP spec revision**: it's **stateless Streamable HTTP**. No sessions, no sticky routing — **any replica can serve any request**.

That single design decision is what makes it production-ready: put it behind a load balancer, scale to N replicas, and you don't need session affinity or a shared session store. It just works horizontally.

## Secure by default

Bundling tools behind one endpoint only works if that endpoint is trustworthy. So security isn't an add-on here:

- **Fail-closed auth** — the hub refuses to boot without an `AUTH_TOKEN`, uses timing-safe comparison, and locks out brute-force attempts (429 after 10 failures/min per IP).
- **SSRF defense** — the fetch server resolves every hostname and blocks private/reserved ranges (incl. cloud metadata `169.254.169.254`); redirects are re-validated per hop.
- **SQL isolation** — Postgres queries run single-statement inside `READ ONLY` transactions with timeouts; `COMMIT; DROP …` style attacks are rejected by the database itself.
- **No code execution** — a hand-written arithmetic parser, zero `eval`/codegen anywhere.
- **Hardened HTTP** — helmet headers, strict CSP with per-request nonces, sanitized JSON-RPC errors, body-size limits.
- **Least privilege** — runs as a non-root `node` user in Docker.

## Try it in 10 seconds

```bash
npx @kbncodes/mcp-server-hub --dev
```

That boots the hub locally with an auto-generated dev token and opens an admin dashboard showing server status, the full tool inventory, and copy-paste client config.

## Deploy it for real

- 🚂 **Railway** — one click from the [marketplace template](https://railway.com/deploy/mcp-server-hub). Auto-generates a strong `AUTH_TOKEN`, exposes `/health`.
- 🎨 **Render** — one click via the included `render.yaml`.
- 🐳 **Docker** — multi-stage, non-root image included.

## Connect a client

Once deployed, point your MCP client at the hub:

```json
{
  "mcpServers": {
    "hub-fetch": {
      "url": "https://<your-app>.up.railway.app/mcp/fetch",
      "headers": { "Authorization": "Bearer <YOUR_TOKEN>" }
    }
  }
}
```

## Extend it

Adding your own server is a three-step job:

1. Create `src/servers/myserver.ts` exporting a factory that registers tools.
2. Add an entry to `src/registry.ts`.
3. Redeploy — it appears in the dashboard and at `/mcp/myserver`.

## Wrapping up

MCP Server Hub is **MIT licensed** and live on both npm and the Railway marketplace. If it saves you the same plumbing it saved me, a ⭐ on the [repo](https://github.com/KbnCodes/mcp-server-hub) means a lot — and I'd love to hear which servers you'd want added next.

- 📦 npm: `@kbncodes/mcp-server-hub`
- 💻 GitHub: https://github.com/KbnCodes/mcp-server-hub
- 🚂 Deploy: https://railway.com/deploy/mcp-server-hub
