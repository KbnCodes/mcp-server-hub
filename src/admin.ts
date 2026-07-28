/**
 * Admin dashboard — a single self-contained HTML page (no build step).
 * The page itself is public; all data it shows is fetched from /api/status,
 * which requires the same Bearer token as the MCP endpoints.
 */
import type { ServerEntry } from "./registry.js";

export function renderAdminPage(nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>MCP Server Hub</title>
<style nonce="${nonce}">
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; background: #0b0d12; color: #e6e8ee; min-height: 100vh; }
  .wrap { max-width: 980px; margin: 0 auto; padding: 40px 20px; }
  h1 { font-size: 24px; letter-spacing: -0.02em; }
  h1 .accent { color: #8b7cf6; }
  .sub { color: #8a90a4; margin-top: 6px; font-size: 14px; }
  .card { background: #12151d; border: 1px solid #232838; border-radius: 12px; padding: 20px; margin-top: 20px; }
  .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  input[type=password], input[type=text] { background: #0b0d12; border: 1px solid #2c3247; color: #e6e8ee; border-radius: 8px; padding: 9px 12px; font-size: 14px; flex: 1; min-width: 220px; }
  button { background: #8b7cf6; color: #fff; border: 0; border-radius: 8px; padding: 9px 16px; font-size: 14px; cursor: pointer; font-weight: 600; }
  button:hover { background: #7a6ae0; }
  button.ghost { background: #232838; color: #c7cbdc; font-weight: 500; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 14px; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #1d2230; vertical-align: top; }
  th { color: #8a90a4; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; }
  .pill { display: inline-block; border-radius: 99px; padding: 2px 10px; font-size: 12px; font-weight: 600; }
  .pill.on { background: #103524; color: #4ade80; }
  .pill.off { background: #33131a; color: #f87171; }
  .pill.req { background: #2d2410; color: #fbbf24; }
  code { background: #0b0d12; border: 1px solid #232838; border-radius: 6px; padding: 2px 7px; font-size: 12.5px; color: #a5b4fc; }
  pre { background: #0b0d12; border: 1px solid #232838; border-radius: 8px; padding: 14px; overflow-x: auto; font-size: 12.5px; line-height: 1.6; margin-top: 10px; }
  .muted { color: #8a90a4; font-size: 13px; }
  .stats { display: flex; gap: 24px; flex-wrap: wrap; margin-top: 8px; }
  .stat b { font-size: 20px; display: block; }
  .stat span { color: #8a90a4; font-size: 12px; }
  .err { color: #f87171; font-size: 13px; margin-top: 8px; display: none; }
  .toolTag { display:inline-block; background:#1a1e2b; border-radius:6px; padding:1px 7px; margin:1px 2px; font-size:11.5px; color:#9aa3c0; }
  .hidden { display: none; }
  .mt6 { margin-top: 6px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>MCP <span class="accent">Server Hub</span></h1>
  <div class="sub">Multiple Model Context Protocol servers behind one authenticated, stateless Streamable HTTP gateway. Spec-ready for 2026-07-28.</div>

  <div class="card">
    <div class="row">
      <input id="token" type="password" placeholder="Bearer token (AUTH_TOKEN)" />
      <button id="connectBtn">Connect</button>
      <button class="ghost" id="forgetBtn">Forget</button>
    </div>
    <div class="err" id="err"></div>
  </div>

  <div class="card hidden" id="statusCard">
    <div class="stats">
      <div class="stat"><b id="stEnabled">–</b><span>servers enabled</span></div>
      <div class="stat"><b id="stTools">–</b><span>tools exposed</span></div>
      <div class="stat"><b id="stUptime">–</b><span>uptime</span></div>
      <div class="stat"><b id="stVersion">–</b><span>hub version</span></div>
    </div>
    <table id="serversTable">
      <thead><tr><th>Server</th><th>Status</th><th>Tools</th><th>Endpoint</th></tr></thead>
      <tbody></tbody>
    </table>
  </div>

  <div class="card hidden" id="connectCard">
    <b>Connect a client</b>
    <div class="muted mt6">Claude Desktop / Cursor / any MCP client (Streamable HTTP):</div>
    <pre id="clientConfig"></pre>
  </div>
</div>
<script nonce="${nonce}">
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");
function fmtUptime(s) {
  if (s < 3600) return Math.floor(s / 60) + "m";
  if (s < 86400) return Math.floor(s / 3600) + "h " + Math.floor((s % 3600) / 60) + "m";
  return Math.floor(s / 86400) + "d " + Math.floor((s % 86400) / 3600) + "h";
}
async function connect() {
  const token = $("token").value || localStorage.getItem("hubToken") || "";
  $("err").style.display = "none";
  try {
    const res = await fetch("/api/status", { headers: { authorization: "Bearer " + token } });
    if (res.status === 401) throw new Error("Unauthorized — check your AUTH_TOKEN.");
    if (!res.ok) throw new Error("Request failed with HTTP " + res.status);
    const data = await res.json();
    localStorage.setItem("hubToken", token);
    render(data, token);
  } catch (e) {
    $("err").textContent = e.message;
    $("err").style.display = "block";
  }
}
function render(data, token) {
  $("statusCard").style.display = "block";
  $("connectCard").style.display = "block";
  const enabled = data.servers.filter((s) => s.enabled);
  $("stEnabled").textContent = enabled.length + " / " + data.servers.length;
  $("stTools").textContent = enabled.reduce((n, s) => n + s.tools.length, 0);
  $("stUptime").textContent = fmtUptime(data.uptimeSeconds);
  $("stVersion").textContent = data.version;
  const tbody = $("serversTable").querySelector("tbody");
  tbody.innerHTML = "";
  for (const s of data.servers) {
    const tr = document.createElement("tr");
    const status = s.enabled
      ? '<span class="pill on">enabled</span>'
      : s.requires && !s.available
        ? '<span class="pill req">needs ' + esc(s.requires) + "</span>"
        : '<span class="pill off">disabled</span>';
    tr.innerHTML =
      "<td><b>" + esc(s.name) + "</b><div class='muted'>" + esc(s.description) + "</div></td>" +
      "<td>" + status + "</td>" +
      "<td>" + s.tools.map((t) => "<span class='toolTag'>" + esc(t) + "</span>").join("") + "</td>" +
      "<td><code>/mcp/" + esc(s.id) + "</code></td>";
    tbody.appendChild(tr);
  }
  const origin = location.origin;
  const cfg = {
    mcpServers: Object.fromEntries(
      enabled.map((s) => [
        "hub-" + s.id,
        { url: origin + "/mcp/" + s.id, headers: { Authorization: "Bearer " + (token ? "<your-token>" : "") } },
      ]),
    ),
  };
  $("clientConfig").textContent = JSON.stringify(cfg, null, 2);
}
if (localStorage.getItem("hubToken")) { $("token").value = localStorage.getItem("hubToken"); connect(); }
$("connectBtn").addEventListener("click", connect);
$("forgetBtn").addEventListener("click", () => { localStorage.removeItem("hubToken"); location.reload(); });
$("token").addEventListener("keydown", (e) => { if (e.key === "Enter") connect(); });
</script>
</body>
</html>`;
}

export interface StatusPayload {
  status: "ok";
  version: string;
  uptimeSeconds: number;
  protocol: { transport: string; stateless: boolean; supportedVersions: string[] };
  servers: Array<Pick<ServerEntry, "id" | "name" | "description" | "tools" | "requires" | "available" | "enabled">>;
}
