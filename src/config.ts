/**
 * Central configuration, loaded once from environment variables.
 * Every option is documented in README.md and railway.toml.
 */

export interface HubConfig {
  port: number;
  /** Bearer token required on /mcp/* and /api/*. Empty = auth disabled (NOT recommended). */
  authToken: string;
  /** Comma-separated server ids to enable. "all" enables every available server. */
  enabledServers: string[];
  /** Optional GitHub token — enables the `github` server when present. */
  githubToken: string | undefined;
  /** Optional Postgres connection string — enables the `postgres` server when present. */
  databaseUrl: string | undefined;
  /** Optional path for persisting the memory server's store (mount a Railway volume). */
  memoryFile: string | undefined;
  /** Max bytes fetched per request by the fetch server. */
  fetchMaxBytes: number;
  /** Strictly reject requests whose Mcp-Method header mismatches the JSON-RPC body (2026-07-28 spec). */
  strictHeaderValidation: boolean;
  /** Requests per minute per IP on /mcp/* and /api/* (429 beyond). */
  rateLimitRpm: number;
  /** Max JSON request body size in bytes. */
  maxBodyBytes: number;
  /** Explicit opt-in to run without authentication (NOT recommended). */
  allowNoAuth: boolean;
  /** Canonical public URL (scheme://host) used in auth challenges and metadata. */
  publicUrl: string | undefined;
  /** Log one structured line per MCP request. */
  auditLog: boolean;
  /** When non-empty, the fetch server may only reach these hostnames. */
  fetchAllowHosts: string[];
}

function parseEnabled(raw: string | undefined): string[] {
  if (!raw || raw.trim() === "" || raw.trim().toLowerCase() === "all") return ["all"];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function loadConfig(): HubConfig {
  return {
    port: Number(process.env.PORT) || 8080,
    authToken: process.env.AUTH_TOKEN?.trim() ?? "",
    enabledServers: parseEnabled(process.env.ENABLED_SERVERS),
    githubToken: process.env.GITHUB_TOKEN?.trim() || undefined,
    databaseUrl: process.env.DATABASE_URL?.trim() || undefined,
    memoryFile: process.env.MEMORY_FILE?.trim() || undefined,
    fetchMaxBytes: Number(process.env.FETCH_MAX_BYTES) || 1_000_000,
    strictHeaderValidation: process.env.STRICT_HEADER_VALIDATION === "true",
    rateLimitRpm: Number(process.env.RATE_LIMIT_RPM) || 120,
    maxBodyBytes: Number(process.env.MAX_BODY_BYTES) || 1_000_000,
    allowNoAuth: process.env.ALLOW_NO_AUTH === "true",
    publicUrl: process.env.PUBLIC_URL?.trim().replace(/\/+$/, "") || undefined,
    auditLog: process.env.AUDIT_LOG === "true",
    fetchAllowHosts: (process.env.FETCH_ALLOW_HOSTS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  };
}

/** MCP protocol versions this hub accepts on the MCP-Protocol-Version header. */
export const SUPPORTED_PROTOCOL_VERSIONS = [
  "2024-11-05",
  "2025-03-26",
  "2025-06-18",
  "2025-11-25",
  "2026-07-28",
];
