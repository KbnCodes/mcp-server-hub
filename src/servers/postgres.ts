/**
 * Postgres server — READ-ONLY SQL access to a Postgres database.
 * Activates only when DATABASE_URL is set. All queries run inside a
 * READ ONLY transaction, so writes are rejected by the database itself.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import pg from "pg";
import type { HubConfig } from "../config.js";

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}

/** Return only the driver's error message — never stacks or connection details. */
function dbErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 500);
  return "database error";
}

let pool: pg.Pool | undefined;

function getPool(databaseUrl: string): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: databaseUrl, max: 5, connectionTimeoutMillis: 10_000 });
    pool.on("error", (err) => console.error("[postgres] pool error:", err.message));
  }
  return pool;
}

/** Run a query inside a READ ONLY transaction with a statement timeout. */
async function readOnlyQuery(databaseUrl: string, sql: string, rowLimit: number): Promise<pg.QueryResult> {
  const client = await getPool(databaseUrl).connect();
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    await client.query("SET LOCAL statement_timeout = '15s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '20s'");
    // Extended query protocol (values: []): the server rejects multi-statement
    // strings, so "COMMIT; <write>" cannot escape the READ ONLY transaction.
    const result = await client.query({ text: sql, values: [] });
    await client.query("COMMIT");
    if (result.rows.length > rowLimit) result.rows = result.rows.slice(0, rowLimit);
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export function createPostgresServer(config: HubConfig): McpServer {
  const server = new McpServer({ name: "hub-postgres", version: "1.0.0" });
  const databaseUrl = config.databaseUrl ?? "";

  server.registerTool(
    "list_tables",
    {
      title: "List tables",
      description: "List all tables in the database with their schemas and estimated row counts.",
      inputSchema: {},
    },
    async () => {
      try {
        const result = await readOnlyQuery(
          databaseUrl,
          `SELECT schemaname AS schema, relname AS table, n_live_tup AS estimated_rows
           FROM pg_stat_user_tables ORDER BY schemaname, relname`,
          500,
        );
        return text(JSON.stringify(result.rows, null, 2));
      } catch (err) {
        return text(`Query failed: ${dbErrorMessage(err)}`);
      }
    },
  );

  server.registerTool(
    "describe_table",
    {
      title: "Describe table",
      description: "Show the columns, types and nullability of a table.",
      inputSchema: {
        table: z.string().describe("Table name"),
        schema: z.string().optional().describe("Schema name, default 'public'"),
      },
    },
    async ({ table, schema }) => {
      try {
        const client = await getPool(databaseUrl).connect();
        try {
          await client.query("BEGIN TRANSACTION READ ONLY");
          const result = await client.query(
            `SELECT column_name, data_type, is_nullable, column_default
             FROM information_schema.columns
             WHERE table_name = $1 AND table_schema = $2
             ORDER BY ordinal_position`,
            [table, schema ?? "public"],
          );
          await client.query("COMMIT");
          if (result.rows.length === 0) return text(`Table "${schema ?? "public"}.${table}" not found.`);
          return text(JSON.stringify(result.rows, null, 2));
        } finally {
          client.release();
        }
      } catch (err) {
        return text(`Describe failed: ${dbErrorMessage(err)}`);
      }
    },
  );

  server.registerTool(
    "query",
    {
      title: "Run read-only SQL",
      description:
        "Execute a SQL query inside a READ ONLY transaction (writes are rejected by the database). Results capped at 200 rows.",
      inputSchema: { sql: z.string().min(1).max(10_000).describe("A single SQL statement to run (multi-statement strings are rejected)") },
    },
    async ({ sql }) => {
      try {
        const result = await readOnlyQuery(databaseUrl, sql, 200);
        return text(
          JSON.stringify({ rowCount: result.rowCount, rows: result.rows }, null, 2),
        );
      } catch (err) {
        return text(`Query failed: ${dbErrorMessage(err)}`);
      }
    },
  );

  return server;
}
