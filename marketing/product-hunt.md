# Product Hunt Listing — MCP Server Hub

> Copy-paste into the Product Hunt submission form. Assets to attach: `assets/hero-diagram.svg` (export PNG), `assets/feature-grid.svg` (export PNG), a terminal GIF of `npx @kbncodes/mcp-server-hub --dev`, and `assets/logo.svg` as the thumbnail.

---

## Name
MCP Server Hub

## Tagline (60 char max)
Five MCP servers behind one authenticated URL

## Alternative taglines
- One URL, one token, five MCP servers for your AI agents
- The one-click gateway that gives AI agents real tools
- Stateless MCP gateway: web, memory, GitHub & Postgres

## Topics / Categories
Developer Tools · Artificial Intelligence · Open Source · GitHub · API

## Links
- Website / Repo: https://github.com/KbnCodes/mcp-server-hub
- npm: https://www.npmjs.com/package/@kbncodes/mcp-server-hub
- Deploy: https://railway.com/deploy/mcp-server-hub

## Description (260 char max)
MCP Server Hub is a stateless Streamable-HTTP gateway that hosts 5 Model Context Protocol servers — web fetch, shared memory, GitHub, Postgres & utilities — behind one Bearer token. Deploy to Railway in a click or run `npx @kbncodes/mcp-server-hub`. Secure by default.

---

## First comment (the "maker's story" — post immediately after launch)

Hey Product Hunt! 👋

I build a lot of AI agents, and every single project started the same way: re-wiring the same handful of MCP tools — web fetching, a memory store, GitHub access, a database connection — over and over. Five processes, five configs, five things to secure.

So I built **MCP Server Hub**: one gateway that hosts all five MCP servers behind a **single authenticated URL**. Point any MCP client (Claude, Cursor, LibreChat, your own) at it, pass one Bearer token, and your agent instantly has:

- 🌐 **Fetch** — bounded web fetching with full SSRF protection
- 🧠 **Memory** — a shared notes store (optionally persisted to a volume)
- 🐙 **GitHub** — read-only repo/issue/file tools
- 🐘 **Postgres** — querying inside READ-ONLY transactions (destructive SQL is rejected by the DB itself)
- 🛠️ **Utils** — time, UUID, hashing, base64, a safe calculator

A few things I care about that made it in:

- **Stateless Streamable HTTP** (built for the 2026-07-28 MCP spec) — no sessions, no sticky routing, so you can run N replicas behind a load balancer with zero session affinity.
- **Secure by default** — fail-closed auth, timing-safe token compare, brute-force lockout, helmet + strict CSP, non-root Docker, and zero `eval` anywhere.
- **Deploy in seconds** — one-click on Railway & Render, or `npx @kbncodes/mcp-server-hub --dev` to try it locally with an auto-generated token.

It's **MIT licensed** and fully extensible — add your own server in a single file and it appears in the dashboard automatically.

Would genuinely love your feedback on the architecture and which servers you'd want next. Happy to answer anything in the comments! 🙏

## Gallery caption ideas
1. "One agent → one gateway → five servers. That's the whole idea."
2. "Six reasons it's production-ready, not a toy."
3. "From zero to a working toolset in one command."
