/**
 * Fetch server — retrieve web pages and JSON APIs with size limits and
 * basic HTML-to-text cleanup. No external dependencies.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { HubConfig } from "../config.js";

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}

/** Strip scripts/styles/tags and collapse whitespace for LLM consumption. */
const NL = String.fromCharCode(10);
const BLANK_LINES = new RegExp(NL + "\\s*" + NL + "+", "g");
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, NL)
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article)>/gi, NL)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(BLANK_LINES, NL + NL)
    .trim();
}

// ------------------------------------------------------- SSRF guards ----

/** Private/reserved IPv4 ranges: 0/8, 10/8, 100.64/10, 127/8, 169.254/16 (cloud metadata), 172.16/12, 192.168/16. */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

/** Private/reserved IPv6: loopback, unique-local fc00::/7, link-local fe80::/10, IPv4-mapped. */
function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(lower)) return true;
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateIPv4(ip);
  if (family === 6) return isPrivateIPv6(ip);
  return true; // not a recognizable IP -> treat as blocked
}

/**
 * Validate a URL for outbound fetching. Resolves the hostname and rejects
 * any URL whose addresses land in private/reserved ranges (covers decimal,
 * hex and other exotic IP encodings, since checks run post-resolution).
 */
async function validateUrl(raw: string, allowHosts: string[]): Promise<URL | string> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return `Invalid URL: ${raw.slice(0, 200)}`;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "Only http/https URLs are allowed.";
  if (url.username || url.password) return "URLs with embedded credentials are not allowed.";

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (allowHosts.length > 0 && !allowHosts.includes(host)) {
    return `Host "${host}" is not in FETCH_ALLOW_HOSTS.`;
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".railway.internal")) {
    return "Fetching internal/private addresses is not allowed.";
  }

  if (isIP(host)) {
    if (isPrivateAddress(host)) return "Fetching internal/private addresses is not allowed.";
    return url;
  }
  try {
    const addresses = await lookup(host, { all: true, verbatim: true });
    if (addresses.length === 0) return `Could not resolve host "${host}".`;
    if (addresses.some((a) => isPrivateAddress(a.address))) {
      return "Fetching internal/private addresses is not allowed.";
    }
  } catch {
    return `Could not resolve host "${host}".`;
  }
  return url;
}

const MAX_REDIRECTS = 3;

async function boundedFetch(
  url: URL,
  maxBytes: number,
  accept: string,
  allowHosts: string[],
): Promise<{ status: number; body: string; contentType: string }> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(current, {
        signal: controller.signal,
        redirect: "manual",
        headers: { accept, "user-agent": "mcp-server-hub/1.0 (+https://railway.com)" },
      });

      // Follow redirects manually so every hop passes SSRF validation.
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel().catch(() => undefined);
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          throw new Error("Redirect to an invalid URL.");
        }
        const validated = await validateUrl(next.href, allowHosts);
        if (typeof validated === "string") throw new Error(`Blocked redirect: ${validated}`);
        current = validated;
        continue;
      }

      const reader = res.body?.getReader();
      let received = 0;
      const chunks: Uint8Array[] = [];
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
          chunks.push(value);
          if (received >= maxBytes) {
            controller.abort();
            break;
          }
        }
      }
      const body = Buffer.concat(chunks).toString("utf8");
      return { status: res.status, body, contentType: res.headers.get("content-type") ?? "" };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Too many redirects (max ${MAX_REDIRECTS}).`);
}

export function createFetchServer(config: HubConfig): McpServer {
  const server = new McpServer({ name: "hub-fetch", version: "1.0.0" });

  server.registerTool(
    "fetch_url",
    {
      title: "Fetch URL",
      description: "Fetch a web page and return readable text (HTML is cleaned). Truncated at the configured size limit.",
      inputSchema: {
        url: z.string().describe("The http(s) URL to fetch"),
        raw: z.boolean().optional().describe("Return raw body instead of cleaned text"),
      },
    },
    async ({ url, raw }) => {
      const parsed = await validateUrl(url, config.fetchAllowHosts);
      if (typeof parsed === "string") return text(parsed);
      try {
        const res = await boundedFetch(parsed, config.fetchMaxBytes, "text/html,application/xhtml+xml,text/plain,*/*", config.fetchAllowHosts);
        const isHtml = res.contentType.includes("html");
        const body = raw || !isHtml ? res.body : htmlToText(res.body);
        return text(`HTTP ${res.status} ${parsed.href}\n\n${body}`);
      } catch (err) {
        return text(`Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  server.registerTool(
    "fetch_json",
    {
      title: "Fetch JSON API",
      description: "GET a JSON API endpoint and return the parsed JSON (pretty-printed).",
      inputSchema: { url: z.string().describe("The http(s) URL of a JSON API") },
    },
    async ({ url }) => {
      const parsed = await validateUrl(url, config.fetchAllowHosts);
      if (typeof parsed === "string") return text(parsed);
      try {
        const res = await boundedFetch(parsed, config.fetchMaxBytes, "application/json", config.fetchAllowHosts);
        try {
          return text(JSON.stringify(JSON.parse(res.body), null, 2));
        } catch {
          return text(`HTTP ${res.status} — response was not valid JSON:\n${res.body.slice(0, 2000)}`);
        }
      } catch (err) {
        return text(`Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  return server;
}
