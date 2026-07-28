/**
 * Utils server — dependency-free everyday tools for agents.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}

/**
 * Minimal recursive-descent arithmetic parser: + - * / % ** and parentheses.
 * No code generation — safe against injection by construction.
 */
function evaluateExpression(input: string): number {
  let pos = 0;
  const src = input.replace(/\s+/g, "");
  if (src.length === 0) throw new Error("Empty expression");
  if (src.length > 500) throw new Error("Expression too long");

  function peek(): string {
    return src[pos] ?? "";
  }
  function parseNumber(): number {
    const match = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(src.slice(pos));
    if (!match) throw new Error(`Expected a number at position ${pos}`);
    pos += match[0].length;
    return Number(match[0]);
  }
  function parsePrimary(): number {
    if (peek() === "(") {
      pos++;
      const value = parseAddSub();
      if (peek() !== ")") throw new Error("Missing closing parenthesis");
      pos++;
      return value;
    }
    if (peek() === "-") {
      pos++;
      return -parsePrimary();
    }
    if (peek() === "+") {
      pos++;
      return parsePrimary();
    }
    return parseNumber();
  }
  function parsePower(): number {
    const base = parsePrimary();
    if (src.startsWith("**", pos)) {
      pos += 2;
      return base ** parsePower(); // right-associative
    }
    return base;
  }
  function parseMulDiv(): number {
    let value = parsePower();
    for (;;) {
      const op = peek();
      if (op === "*" && !src.startsWith("**", pos)) {
        pos++;
        value *= parsePower();
      } else if (op === "/") {
        pos++;
        value /= parsePower();
      } else if (op === "%") {
        pos++;
        value %= parsePower();
      } else {
        return value;
      }
    }
  }
  function parseAddSub(): number {
    let value = parseMulDiv();
    for (;;) {
      const op = peek();
      if (op === "+") {
        pos++;
        value += parseMulDiv();
      } else if (op === "-") {
        pos++;
        value -= parseMulDiv();
      } else {
        return value;
      }
    }
  }

  const result = parseAddSub();
  if (pos !== src.length) throw new Error(`Unexpected character '${src[pos]}' at position ${pos}`);
  return result;
}

export function createUtilsServer(): McpServer {
  const server = new McpServer({ name: "hub-utils", version: "1.0.0" });

  server.registerTool(
    "current_time",
    {
      title: "Current time",
      description: "Get the current date/time. Optionally pass an IANA timezone (e.g. 'Asia/Kolkata').",
      inputSchema: { timezone: z.string().optional().describe("IANA timezone name, defaults to UTC") },
    },
    async ({ timezone }) => {
      const tz = timezone || "UTC";
      try {
        const now = new Date();
        const formatted = new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          dateStyle: "full",
          timeStyle: "long",
        }).format(now);
        return text(JSON.stringify({ timezone: tz, iso: now.toISOString(), formatted }));
      } catch {
        return text(`Unknown timezone: ${tz}`);
      }
    },
  );

  server.registerTool(
    "convert_timezone",
    {
      title: "Convert timezone",
      description: "Convert an ISO 8601 timestamp to another IANA timezone.",
      inputSchema: {
        timestamp: z.string().describe("ISO 8601 timestamp, e.g. 2026-07-28T12:00:00Z"),
        timezone: z.string().describe("Target IANA timezone, e.g. America/New_York"),
      },
    },
    async ({ timestamp, timezone }) => {
      const date = new Date(timestamp);
      if (Number.isNaN(date.getTime())) return text(`Invalid timestamp: ${timestamp}`);
      try {
        const formatted = new Intl.DateTimeFormat("en-US", {
          timeZone: timezone,
          dateStyle: "full",
          timeStyle: "long",
        }).format(date);
        return text(JSON.stringify({ input: timestamp, timezone, formatted }));
      } catch {
        return text(`Unknown timezone: ${timezone}`);
      }
    },
  );

  server.registerTool(
    "generate_uuid",
    {
      title: "Generate UUIDs",
      description: "Generate one or more random UUID v4 values.",
      inputSchema: { count: z.number().int().min(1).max(100).optional().describe("How many, default 1") },
    },
    async ({ count }) => text(JSON.stringify(Array.from({ length: count ?? 1 }, () => randomUUID()))),
  );

  server.registerTool(
    "hash_text",
    {
      title: "Hash text",
      description: "Compute a cryptographic hash of a text input.",
      inputSchema: {
        input: z.string().max(100_000).describe("Text to hash"),
        algorithm: z.enum(["sha256", "sha512", "md5"]).optional().describe("Default sha256"),
      },
    },
    async ({ input, algorithm }) => {
      const algo = algorithm ?? "sha256";
      return text(createHash(algo).update(input).digest("hex"));
    },
  );

  server.registerTool(
    "base64",
    {
      title: "Base64 encode/decode",
      description: "Encode text to base64 or decode base64 to text.",
      inputSchema: {
        input: z.string().max(100_000).describe("Input text or base64 string"),
        mode: z.enum(["encode", "decode"]).describe("encode or decode"),
      },
    },
    async ({ input, mode }) => {
      if (mode === "encode") return text(Buffer.from(input, "utf8").toString("base64"));
      try {
        return text(Buffer.from(input, "base64").toString("utf8"));
      } catch {
        return text("Invalid base64 input.");
      }
    },
  );

  server.registerTool(
    "calculate",
    {
      title: "Calculator",
      description: "Evaluate a basic arithmetic expression (+ - * / % ** and parentheses).",
      inputSchema: { expression: z.string().describe("e.g. (2 + 3) * 4 ** 2") },
    },
    async ({ expression }) => {
      try {
        const result = evaluateExpression(expression);
        if (!Number.isFinite(result)) return text("Expression did not produce a finite number.");
        return text(String(result));
      } catch (err) {
        return text(`Failed to evaluate: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  return server;
}
