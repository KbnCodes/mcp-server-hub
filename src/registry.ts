/**
 * Server registry — the catalog of MCP servers this hub can host.
 *
 * Each entry provides a factory that builds a FRESH McpServer per request.
 * That is the stateless Streamable HTTP pattern: no sessions, no shared
 * transport, any replica can serve any request (2026-07-28 stateless core).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HubConfig } from "./config.js";
import { createUtilsServer } from "./servers/utils.js";
import { createFetchServer } from "./servers/fetch.js";
import { createMemoryServer } from "./servers/memory.js";
import { createGithubServer } from "./servers/github.js";
import { createPostgresServer } from "./servers/postgres.js";

export interface ServerEntry {
  id: string;
  name: string;
  description: string;
  /** Human-readable list of tool names, shown in the admin UI. */
  tools: string[];
  /** Extra requirement (env var) that must be present for this server to activate. */
  requires?: string;
  /** Whether the requirement is satisfied in the current environment. */
  available: boolean;
  /** Whether the operator enabled it via ENABLED_SERVERS. */
  enabled: boolean;
  create: () => McpServer;
}

export function buildRegistry(config: HubConfig): Map<string, ServerEntry> {
  const wantAll = config.enabledServers.includes("all");
  const wants = (id: string) => wantAll || config.enabledServers.includes(id);

  const entries: ServerEntry[] = [
    {
      id: "utils",
      name: "Utils",
      description: "Time, timezone conversion, UUIDs, hashing, base64 and calculator tools.",
      tools: ["current_time", "convert_timezone", "generate_uuid", "hash_text", "base64", "calculate"],
      available: true,
      enabled: wants("utils"),
      create: () => createUtilsServer(),
    },
    {
      id: "fetch",
      name: "Fetch",
      description: "Fetch web pages and APIs; returns cleaned text or raw JSON with size limits.",
      tools: ["fetch_url", "fetch_json"],
      available: true,
      enabled: wants("fetch"),
      create: () => createFetchServer(config),
    },
    {
      id: "memory",
      name: "Memory",
      description: "Shared key-value notes store for agents. Optional volume persistence via MEMORY_FILE.",
      tools: ["memory_set", "memory_get", "memory_list", "memory_delete", "memory_search"],
      available: true,
      enabled: wants("memory"),
      create: () => createMemoryServer(config),
    },
    {
      id: "github",
      name: "GitHub",
      description: "Search repositories, read files and list issues via the GitHub REST API.",
      tools: ["search_repositories", "get_file", "list_issues", "get_repo"],
      requires: "GITHUB_TOKEN",
      available: Boolean(config.githubToken),
      enabled: wants("github") && Boolean(config.githubToken),
      create: () => createGithubServer(config),
    },
    {
      id: "postgres",
      name: "Postgres",
      description: "Read-only SQL access to a Postgres database (schema inspection + SELECT queries).",
      tools: ["list_tables", "describe_table", "query"],
      requires: "DATABASE_URL",
      available: Boolean(config.databaseUrl),
      enabled: wants("postgres") && Boolean(config.databaseUrl),
      create: () => createPostgresServer(config),
    },
  ];

  return new Map(entries.map((e) => [e.id, e]));
}
