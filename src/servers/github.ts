/**
 * GitHub server — read-only access to the GitHub REST API.
 * Activates only when GITHUB_TOKEN is set.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { HubConfig } from "../config.js";

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}

// GitHub owner/repo names: alphanumerics, hyphen, underscore, dot only.
const NAME_PATTERN = /^[A-Za-z0-9_.\-]+$/;

function validName(value: string): boolean {
  return NAME_PATTERN.test(value) && !value.includes("..");
}

/** Encode a repo file path per segment (blocks traversal via .. or %2f). */
function encodeRepoPath(path: string): string | undefined {
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0 || segments.some((s) => s === "." || s === "..")) return undefined;
  return segments.map((s) => encodeURIComponent(s)).join("/");
}

/** Strip anything that looks like a credential from error text. */
function sanitizeApiError(msg: string): string {
  return msg.replace(/(gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|Bearer [^\s"]+)/g, "[redacted]").slice(0, 500);
}

export function createGithubServer(config: HubConfig): McpServer {
  const server = new McpServer({ name: "hub-github", version: "1.0.0" });

  async function gh(path: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(`https://api.github.com${path}`, {
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${config.githubToken}`,
          accept: "application/vnd.github+json",
          "user-agent": "mcp-server-hub/1.0",
          "x-github-api-version": "2022-11-28",
        },
      });
      if (!res.ok) throw new Error(`GitHub API ${res.status}: ${sanitizeApiError(await res.text())}`);
      return res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  server.registerTool(
    "search_repositories",
    {
      title: "Search repositories",
      description: "Search GitHub repositories by query (GitHub search syntax supported).",
      inputSchema: {
        query: z.string().describe("Search query, e.g. 'mcp server language:typescript stars:>100'"),
        limit: z.number().int().min(1).max(30).optional().describe("Max results, default 10"),
      },
    },
    async ({ query, limit }) => {
      try {
        const data = (await gh(`/search/repositories?q=${encodeURIComponent(query)}&per_page=${limit ?? 10}`)) as {
          total_count: number;
          items: Array<{ full_name: string; description: string | null; stargazers_count: number; html_url: string }>;
        };
        const repos = data.items.map((r) => ({
          name: r.full_name,
          stars: r.stargazers_count,
          description: r.description,
          url: r.html_url,
        }));
        return text(JSON.stringify({ total: data.total_count, results: repos }, null, 2));
      } catch (err) {
        return text(`Search failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  server.registerTool(
    "get_repo",
    {
      title: "Get repository info",
      description: "Get metadata for a repository (stars, forks, topics, license, default branch).",
      inputSchema: {
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
      },
    },
    async ({ owner, repo }) => {
      if (!validName(owner) || !validName(repo)) return text("Invalid owner or repo name.");
      try {
        const r = (await gh(`/repos/${owner}/${repo}`)) as Record<string, unknown>;
        const summary = {
          full_name: r.full_name,
          description: r.description,
          stars: r.stargazers_count,
          forks: r.forks_count,
          open_issues: r.open_issues_count,
          language: r.language,
          topics: r.topics,
          default_branch: r.default_branch,
          license: (r.license as { name?: string } | null)?.name ?? null,
          updated_at: r.updated_at,
          html_url: r.html_url,
        };
        return text(JSON.stringify(summary, null, 2));
      } catch (err) {
        return text(`Lookup failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  server.registerTool(
    "get_file",
    {
      title: "Read a file",
      description: "Read a file's content from a repository (max ~1MB, text files).",
      inputSchema: {
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        path: z.string().describe("File path within the repo"),
        ref: z.string().optional().describe("Branch, tag or commit SHA (default branch if omitted)"),
      },
    },
    async ({ owner, repo, path, ref }) => {
      if (!validName(owner) || !validName(repo)) return text("Invalid owner or repo name.");
      const encodedPath = encodeRepoPath(path);
      if (!encodedPath) return text("Invalid file path.");
      try {
        const suffix = ref ? `?ref=${encodeURIComponent(ref)}` : "";
        const data = (await gh(`/repos/${owner}/${repo}/contents/${encodedPath}${suffix}`)) as {
          type: string;
          size: number;
          content?: string;
          encoding?: string;
        };
        if (data.type !== "file" || !data.content) return text(`"${path}" is not a readable file.`);
        if (data.size > 1_000_000) return text(`File too large (${data.size} bytes).`);
        return text(Buffer.from(data.content, "base64").toString("utf8"));
      } catch (err) {
        return text(`Read failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  server.registerTool(
    "list_issues",
    {
      title: "List issues",
      description: "List recent issues for a repository.",
      inputSchema: {
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        state: z.enum(["open", "closed", "all"]).optional().describe("Default open"),
        limit: z.number().int().min(1).max(50).optional().describe("Max results, default 10"),
      },
    },
    async ({ owner, repo, state, limit }) => {
      if (!validName(owner) || !validName(repo)) return text("Invalid owner or repo name.");
      try {
        const data = (await gh(
          `/repos/${owner}/${repo}/issues?state=${state ?? "open"}&per_page=${limit ?? 10}`,
        )) as Array<{ number: number; title: string; state: string; user: { login: string }; html_url: string; created_at: string }>;
        const issues = data.map((i) => ({
          number: i.number,
          title: i.title,
          state: i.state,
          author: i.user.login,
          created_at: i.created_at,
          url: i.html_url,
        }));
        return text(JSON.stringify(issues, null, 2));
      } catch (err) {
        return text(`List failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  return server;
}
