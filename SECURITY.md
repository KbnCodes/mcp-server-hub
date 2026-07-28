# Security Policy

## Supported versions

The latest published version of this template receives security fixes. Older
deployments should redeploy to pick up patches (Railway shows an update
notification when the template is updated).

## Reporting a vulnerability

Please **do not open a public GitHub issue** for security vulnerabilities.

Instead, report privately via GitHub's **Security Advisories** ("Report a
vulnerability" on the repository's Security tab). Include:

- A description of the issue and its impact
- Steps to reproduce (a curl command or minimal client script is ideal)
- The affected endpoint/server (`/mcp/utils`, `/mcp/fetch`, gateway, dashboard, …)

You can expect an acknowledgement within 72 hours. Fixes for confirmed issues
are prioritized and published as a template update.

## Scope

In scope:

- Authentication/authorization bypasses on `/mcp/*` or `/api/*`
- SSRF bypasses in the fetch server (private/internal address access)
- Write access through the Postgres server (READ ONLY escape)
- Injection, path traversal or credential leakage in any bundled server
- Denial-of-service vectors that survive the built-in rate/size limits

Out of scope:

- Deployments that explicitly set `ALLOW_NO_AUTH=true`
- Issues requiring a compromised `AUTH_TOKEN`, `GITHUB_TOKEN` or `DATABASE_URL`
- Vulnerabilities in upstream dependencies without a demonstrated impact here
  (report those upstream, but feel free to notify us too)

## Hardening checklist for deployers

- Keep `AUTH_TOKEN` long and random (the Railway template auto-generates one)
- Provide a **read-only database role** in `DATABASE_URL` for defense in depth
- Use a **fine-grained GitHub PAT** limited to the repositories you need
- Set `FETCH_ALLOW_HOSTS` if your agents only need specific APIs
- Enable `AUDIT_LOG=true` and review logs for unexpected tool usage
