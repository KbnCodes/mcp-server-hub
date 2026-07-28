#!/usr/bin/env node
/**
 * MCP Server Hub — entrypoint.
 *
 * A stateless Streamable HTTP gateway hosting multiple MCP servers:
 *
 *   POST /mcp/:serverId   MCP endpoint (Bearer auth, fresh server per request)
 *   GET  /                Admin dashboard
 *   GET  /api/status      Hub + registry status (Bearer auth)
 *   GET  /health          Healthcheck (no auth, used by Railway)
 *   GET  /.well-known/oauth-protected-resource   RFC 9728 resource metadata
 *
 * Design notes:
 * - Stateless per the 2026-07-28 MCP "stateless core": no sessions, no
 *   Mcp-Session-Id, any replica can serve any request. Implemented today via
 *   the SDK's `sessionIdGenerator: undefined` mode.
 * - Validates MCP-Protocol-Version (2025-03-26+ requirement) and the new
 *   Mcp-Method header (2026-07-28) when present.
 */
import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig, SUPPORTED_PROTOCOL_VERSIONS } from "./config.js";
import { buildRegistry } from "./registry.js";
import { renderAdminPage, type StatusPayload } from "./admin.js";

const HUB_VERSION = "1.0.0";
const startedAt = Date.now();

// --------------------------------------------------------------- CLI ------
// Minimal flag handling so the published npm bin is pleasant to run:
//   npx mcp-server-hub [--dev] [--help] [--version]
const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  printHelp();
  process.exit(0);
}
if (argv.includes("--version") || argv.includes("-v")) {
  console.log(HUB_VERSION);
  process.exit(0);
}
const devMode = argv.includes("--dev");

const config = loadConfig();
const registry = buildRegistry(config);

// Fail closed in production, but make local `npx` runs pleasant: when no token
// is configured and we're clearly interactive (a TTY) or explicitly in --dev,
// mint an ephemeral token and print it instead of refusing to start.
if (!config.authToken && !config.allowNoAuth) {
  if (devMode || process.stdout.isTTY) {
    config.authToken = randomBytes(24).toString("base64url");
    console.warn("[hub] No AUTH_TOKEN set — generated an ephemeral token for this local session.");
    console.warn("[hub] Set AUTH_TOKEN yourself for a stable token (this one changes on every restart).");
    console.warn(`\n    AUTH_TOKEN = ${config.authToken}\n`);
  } else {
    console.error("[hub] FATAL: AUTH_TOKEN is not set. Set AUTH_TOKEN, or set ALLOW_NO_AUTH=true to run unauthenticated (NOT recommended).");
    console.error("[hub] Tip: run locally with `npx mcp-server-hub --dev` to auto-generate a token.");
    process.exit(1);
  }
}
if (config.authToken && config.authToken.length < 16) {
  console.warn("[hub] WARNING: AUTH_TOKEN is shorter than 16 characters — use a long random token (e.g. openssl rand -hex 32).");
}

const app = express();
app.set("trust proxy", 1); // Railway/reverse proxy: use the real client IP
app.use(
  helmet({
    contentSecurityPolicy: false, // set per-route (admin page uses a nonce)
    frameguard: { action: "deny" },
    referrerPolicy: { policy: "no-referrer" },
  }),
);
app.use(express.json({ limit: config.maxBodyBytes }));
app.disable("x-powered-by");

// No caching for authenticated/token-bearing surfaces.
app.use(["/mcp", "/api"], (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// Global per-IP rate limit on MCP + API surfaces.
app.use(
  ["/mcp", "/api"],
  rateLimit({
    windowMs: 60_000,
    limit: config.rateLimitRpm,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
      jsonrpc: "2.0",
      error: { code: -32000, message: "Rate limit exceeded. Retry later." },
      id: null,
    },
  }),
);

// ---------------------------------------------------------------- auth ----

// Brute-force protection: track failed auth attempts per IP (fixed window).
const AUTH_FAIL_LIMIT = 10;
const AUTH_FAIL_WINDOW_MS = 60_000;
const authFailures = new Map<string, { count: number; resetAt: number }>();

function registerAuthFailure(ip: string): void {
  const now = Date.now();
  const entry = authFailures.get(ip);
  if (!entry || entry.resetAt <= now) {
    authFailures.set(ip, { count: 1, resetAt: now + AUTH_FAIL_WINDOW_MS });
    return;
  }
  entry.count += 1;
}

function isAuthBlocked(ip: string): boolean {
  const entry = authFailures.get(ip);
  if (!entry) return false;
  if (entry.resetAt <= Date.now()) {
    authFailures.delete(ip);
    return false;
  }
  return entry.count >= AUTH_FAIL_LIMIT;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of authFailures) if (entry.resetAt <= now) authFailures.delete(ip);
}, AUTH_FAIL_WINDOW_MS).unref();

function tokenMatches(provided: string): boolean {
  const expected = Buffer.from(config.authToken, "utf8");
  const actual = Buffer.from(provided, "utf8");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

function requireAuth(req: express.Request, res: express.Response): boolean {
  if (!config.authToken) return true; // auth explicitly disabled via ALLOW_NO_AUTH
  const ip = req.ip ?? "unknown";
  if (isAuthBlocked(ip)) {
    res.status(429).set("Retry-After", "60").json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Too many failed authentication attempts. Retry later." },
      id: null,
    });
    return false;
  }
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (token && tokenMatches(token)) return true;
  registerAuthFailure(ip);
  console.warn(`[hub] auth failure from ${ip} on ${req.method} ${req.path}`);
  // Per MCP authorization spec: 401 + WWW-Authenticate with resource metadata.
  res
    .status(401)
    .set(
      "WWW-Authenticate",
      `Bearer resource_metadata="${baseUrl(req)}/.well-known/oauth-protected-resource"`,
    )
    .json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized: provide Authorization: Bearer <AUTH_TOKEN>" },
      id: null,
    });
  return false;
}

function baseUrl(req: express.Request): string {
  if (config.publicUrl) return config.publicUrl;
  const proto = req.headers["x-forwarded-proto"] === "https" ? "https" : req.protocol;
  const rawHost = req.headers.host ?? "localhost";
  // Host header is attacker-controlled; only reflect a strictly safe charset.
  const host = /^[A-Za-z0-9.:\-\[\]]+$/.test(rawHost) ? rawHost : "localhost";
  return `${proto}://${host}`;
}

// ------------------------------------------------- protocol validation ----

/** Validate MCP-Protocol-Version and (2026-07-28) Mcp-Method headers. */
function validateProtocolHeaders(req: express.Request, res: express.Response): boolean {
  const version = req.headers["mcp-protocol-version"];
  if (typeof version === "string" && !SUPPORTED_PROTOCOL_VERSIONS.includes(version)) {
    res.status(400).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: `Unsupported MCP-Protocol-Version "${version.slice(0, 32)}". Supported: ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")}`,
      },
      id: null,
    });
    return false;
  }

  // 2026-07-28 spec (SEP-2243): Mcp-Method header must match the body method.
  const mcpMethod = req.headers["mcp-method"];
  if (typeof mcpMethod === "string" && req.body && typeof req.body === "object" && !Array.isArray(req.body)) {
    const bodyMethod = (req.body as { method?: unknown }).method;
    if (typeof bodyMethod === "string" && bodyMethod !== mcpMethod) {
      if (config.strictHeaderValidation) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32600, message: `Mcp-Method header ("${mcpMethod}") does not match body method ("${bodyMethod}")` },
          id: null,
        });
        return false;
      }
      console.warn(`[hub] Mcp-Method mismatch: header="${mcpMethod}" body="${bodyMethod}"`);
    }
  }
  return true;
}

// ------------------------------------------------------- MCP endpoints ----

const SERVER_ID_PATTERN = /^[a-z0-9_-]{1,32}$/;

function auditRequest(req: express.Request, res: express.Response, serverId: string): void {
  if (!config.auditLog) return;
  const body = req.body as { method?: unknown; params?: { name?: unknown } } | undefined;
  const method = typeof body?.method === "string" ? body.method : "-";
  const tool = method === "tools/call" && typeof body?.params?.name === "string" ? body.params.name : "-";
  res.on("finish", () => {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        ip: req.ip,
        server: serverId,
        method,
        tool,
        status: res.statusCode,
      }),
    );
  });
}

app.post("/mcp/:serverId", async (req, res) => {
  if (!requireAuth(req, res)) return;
  if (!validateProtocolHeaders(req, res)) return;

  const serverId = req.params.serverId.toLowerCase();
  if (!SERVER_ID_PATTERN.test(serverId)) {
    res.status(404).json({
      jsonrpc: "2.0",
      error: { code: -32601, message: "Unknown server (invalid id)." },
      id: null,
    });
    return;
  }
  auditRequest(req, res, serverId);
  const entry = registry.get(serverId);
  if (!entry || !entry.enabled) {
    const enabled = [...registry.values()].filter((e) => e.enabled).map((e) => `/mcp/${e.id}`);
    res.status(404).json({
      jsonrpc: "2.0",
      error: {
        code: -32601,
        message: entry
          ? `Server "${serverId}" is disabled${entry.requires && !entry.available ? ` (set ${entry.requires} to enable it)` : ""}.`
          : `Unknown server "${serverId}". Enabled endpoints: ${enabled.join(", ")}`,
      },
      id: null,
    });
    return;
  }

  // Stateless mode: fresh server + transport per request; no sessions.
  let server: McpServer | undefined;
  let transport: StreamableHTTPServerTransport | undefined;
  try {
    server = entry.create();
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      transport?.close();
      server?.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error(`[hub] error handling /mcp/${serverId}:`, err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// Stateless transport: no SSE streams to resume, no sessions to delete.
app.get("/mcp/:serverId", (_req, res) => {
  res.status(405).set("Allow", "POST").json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method Not Allowed: this hub runs stateless Streamable HTTP (POST only)." },
    id: null,
  });
});
app.delete("/mcp/:serverId", (_req, res) => {
  res.status(405).set("Allow", "POST").json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method Not Allowed: stateless mode has no sessions to terminate." },
    id: null,
  });
});

// ------------------------------------------------------- hub endpoints ----

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    version: HUB_VERSION,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    serversEnabled: [...registry.values()].filter((e) => e.enabled).length,
  });
});

app.get("/api/status", (req, res) => {
  if (!requireAuth(req, res)) return;
  const payload: StatusPayload = {
    status: "ok",
    version: HUB_VERSION,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    protocol: {
      transport: "streamable-http",
      stateless: true,
      supportedVersions: SUPPORTED_PROTOCOL_VERSIONS,
    },
    servers: [...registry.values()].map(({ id, name, description, tools, requires, available, enabled }) => ({
      id,
      name,
      description,
      tools,
      requires,
      available,
      enabled,
    })),
  };
  res.json(payload);
});

// RFC 9728 Protected Resource Metadata (referenced by the 401 challenge).
app.get("/.well-known/oauth-protected-resource", (req, res) => {
  res.json({
    resource: baseUrl(req),
    bearer_methods_supported: ["header"],
    resource_documentation: "https://github.com/KbnCodes/mcp-server-hub",
    resource_signing_alg_values_supported: [],
  });
});

app.get("/", (_req, res) => {
  const nonce = randomBytes(16).toString("base64");
  res
    .set(
      "Content-Security-Policy",
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    )
    .type("html")
    .send(renderAdminPage(nonce));
});

// ------------------------------------------------------ error handling ----

// Sanitized error responses: no stack traces, no file paths (body-parser
// errors would otherwise render Express's default HTML error page).
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = (err as { status?: number })?.status;
  if (status === 413) {
    res.status(413).json({
      jsonrpc: "2.0",
      error: { code: -32600, message: `Request body too large (max ${config.maxBodyBytes} bytes).` },
      id: null,
    });
    return;
  }
  if (status && status >= 400 && status < 500) {
    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32700, message: "Parse error: request body is not valid JSON." },
      id: null,
    });
    return;
  }
  console.error("[hub] unhandled error:", err);
  if (!res.headersSent) {
    res.status(500).json({
      jsonrpc: "2.0",
      error: { code: -32603, message: "Internal server error" },
      id: null,
    });
  }
});

// ---------------------------------------------------------------- boot ----

function printHelp(): void {
  console.log(`MCP Server Hub v${HUB_VERSION}
Host multiple MCP servers behind one authenticated Streamable HTTP gateway.

Usage:
  mcp-server-hub [options]

Options:
  --dev            Run locally; auto-generate an ephemeral AUTH_TOKEN if none is set.
  -h, --help       Show this help.
  -v, --version    Print the version.

Common environment variables:
  AUTH_TOKEN         Bearer token protecting /mcp/* and /api/* (required in production).
  PORT               Listen port (default 8080).
  ENABLED_SERVERS    Comma-separated ids or "all" (utils,fetch,memory,github,postgres).
  GITHUB_TOKEN       Enables the github server.
  DATABASE_URL       Enables the read-only postgres server.
  ALLOW_NO_AUTH      Set true to run without auth (NOT recommended).

Once running, open http://localhost:8080/ for the dashboard. See README.md for full docs.`);
}

if (!config.authToken) {
  console.warn("[hub] WARNING: ALLOW_NO_AUTH=true — the hub is running WITHOUT authentication.");
}

const httpServer = app.listen(config.port, () => {
  const enabled = [...registry.values()].filter((e) => e.enabled).map((e) => e.id);
  console.log(`[hub] MCP Server Hub v${HUB_VERSION} listening on :${config.port}`);
  console.log(`[hub] transport=streamable-http stateless=true auth=${config.authToken ? "bearer" : "DISABLED"}`);
  console.log(`[hub] enabled servers: ${enabled.join(", ") || "(none)"}`);
  for (const entry of registry.values()) {
    if (!entry.enabled && entry.requires && !entry.available) {
      console.log(`[hub] server "${entry.id}" inactive — set ${entry.requires} to enable it`);
    }
  }
});

// Slowloris defense: bound header/request read times.
httpServer.headersTimeout = 30_000;
httpServer.requestTimeout = 60_000;
