/**
 * Memory server — a shared notes/key-value store agents can read and write.
 * In stateless hub mode the STORE is module-level (per process), so all
 * requests on this replica share it. Set MEMORY_FILE (on a Railway volume)
 * to persist across restarts and deploys.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import type { HubConfig } from "../config.js";

interface MemoryEntry {
  value: string;
  tags: string[];
  updatedAt: string;
}

// DoS caps for a shared store.
const MAX_ENTRIES = 1000;
const MAX_TOTAL_BYTES = 10_000_000;

const store = new Map<string, MemoryEntry>();
let loadedFrom: string | undefined;

function storeBytes(): number {
  let total = 0;
  for (const [key, e] of store) total += key.length + e.value.length;
  return total;
}

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}

function loadStore(file: string): void {
  if (loadedFrom === file) return;
  loadedFrom = file;
  try {
    if (existsSync(file)) {
      const data = JSON.parse(readFileSync(file, "utf8")) as Record<string, MemoryEntry>;
      for (const [key, entry] of Object.entries(data)) store.set(key, entry);
      console.log(`[memory] loaded ${store.size} entries from ${file}`);
    }
  } catch (err) {
    console.error(`[memory] failed to load ${file}:`, err);
  }
}

function persistStore(file: string | undefined): void {
  if (!file) return;
  try {
    mkdirSync(dirname(file), { recursive: true });
    // Atomic write: temp file + rename, so a crash never corrupts the store.
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(store), null, 2), "utf8");
    renameSync(tmp, file);
  } catch (err) {
    console.error(`[memory] failed to persist to ${file}:`, err);
  }
}

export function createMemoryServer(config: HubConfig): McpServer {
  if (config.memoryFile) loadStore(config.memoryFile);

  const server = new McpServer({ name: "hub-memory", version: "1.0.0" });

  server.registerTool(
    "memory_set",
    {
      title: "Store a memory",
      description: "Store or overwrite a note under a key, with optional tags for later search.",
      inputSchema: {
        key: z.string().min(1).max(200).describe("Unique key for this note"),
        value: z.string().max(50_000).describe("The note content"),
        tags: z.array(z.string().max(100)).max(20).optional().describe("Optional tags for filtering"),
      },
    },
    async ({ key, value, tags }) => {
      if (!store.has(key) && store.size >= MAX_ENTRIES) {
        return text(`Store is full (${MAX_ENTRIES} entries). Delete entries before adding new ones.`);
      }
      const previous = store.get(key);
      const delta = key.length + value.length - (previous ? key.length + previous.value.length : 0);
      if (storeBytes() + delta > MAX_TOTAL_BYTES) {
        return text(`Store size limit reached (${MAX_TOTAL_BYTES} bytes). Delete entries to free space.`);
      }
      store.set(key, { value, tags: tags ?? [], updatedAt: new Date().toISOString() });
      persistStore(config.memoryFile);
      return text(`Stored "${key}" (${value.length} chars, ${store.size} total entries).`);
    },
  );

  server.registerTool(
    "memory_get",
    {
      title: "Retrieve a memory",
      description: "Get the note stored under a key.",
      inputSchema: { key: z.string().describe("The key to look up") },
    },
    async ({ key }) => {
      const entry = store.get(key);
      if (!entry) return text(`No entry found for "${key}".`);
      return text(JSON.stringify({ key, ...entry }, null, 2));
    },
  );

  server.registerTool(
    "memory_list",
    {
      title: "List memories",
      description: "List all stored keys with tags and timestamps (values omitted).",
      inputSchema: {},
    },
    async () => {
      const listing = [...store.entries()].map(([key, e]) => ({
        key,
        tags: e.tags,
        updatedAt: e.updatedAt,
        size: e.value.length,
      }));
      return text(JSON.stringify(listing, null, 2));
    },
  );

  server.registerTool(
    "memory_delete",
    {
      title: "Delete a memory",
      description: "Delete the note stored under a key.",
      inputSchema: { key: z.string().describe("The key to delete") },
    },
    async ({ key }) => {
      const existed = store.delete(key);
      persistStore(config.memoryFile);
      return text(existed ? `Deleted "${key}".` : `No entry found for "${key}".`);
    },
  );

  server.registerTool(
    "memory_search",
    {
      title: "Search memories",
      description: "Case-insensitive search across keys, values and tags.",
      inputSchema: { query: z.string().min(1).describe("Search text") },
    },
    async ({ query }) => {
      const q = query.toLowerCase();
      const hits = [...store.entries()]
        .filter(
          ([key, e]) =>
            key.toLowerCase().includes(q) ||
            e.value.toLowerCase().includes(q) ||
            e.tags.some((t) => t.toLowerCase().includes(q)),
        )
        .map(([key, e]) => ({ key, tags: e.tags, updatedAt: e.updatedAt, preview: e.value.slice(0, 200) }));
      return text(hits.length ? JSON.stringify(hits, null, 2) : `No matches for "${query}".`);
    },
  );

  return server;
}
