# Google Auth & MCP

How Tomcat Core authenticates humans (`@tomcat.eu`) for the HTTP API and the local MCP server.

## Overview

| Surface | Auth | Role source |
| --- | --- | --- |
| Core HTTP API (prod) | `Authorization: Bearer <google-id-token>` | Postgres `users` (auto-provision `@tomcat.eu`) |
| **MCP HTTP remote (prod)** | `Authorization: Bearer <google-id-token>` on `/mcp` | Postgres `users` (auto-provision `@tomcat.eu`) |
| Core HTTP API (service) | `X-Service-Token` JWT | Registered clients + optional `act_as` |
| MCP stdio (local dev) | Google session in `.secrets/` | DB if `DATABASE_URL` set, else dev placeholder |
| Dev only | `X-Mock-Identity` header | Disabled when `NODE_ENV=production` |

Google OAuth uses a **Desktop client** (CLI / MCP). Society will add a separate **Web client** later.

## One-time GCP setup

1. OAuth consent screen: **Internal**, domain `tomcat.eu`
2. Credentials → **Desktop app** → note Client ID
3. Set `GOOGLE_OAUTH_CLIENT_ID` in `.env` and `.env.secrets`
4. Download client JSON → `.secrets/google-oauth-desktop.json` (gitignored)

Prod deploy injects `GOOGLE_OAUTH_CLIENT_ID` and `ALLOWED_GOOGLE_DOMAINS` via `deploy-container.sh`.

## Daily commands

```bash
# Sign in (opens browser, @tomcat.eu only)
export CORE_URL=https://tomcatcore91c5e290-api.functions.fnc.fr-par.scw.cloud  # optional /me probe
npm run auth:google

# Check session
npm run auth:status

# Clear local session
npm run auth:logout

# Print a fresh Bearer token + Cursor remote snippet (~1h lifetime)
npm run auth:token

# Local stdio MCP (offline dev, uses local .env connectors)
npm run mcp:stdio
```

Session files (mode `600`, gitignored):

| File | Contents |
| --- | --- |
| `.secrets/google-oauth-session.json` | ID token, refresh token, expiry |
| `.secrets/google-oauth-desktop.json` | OAuth client id + secret |
| `.secrets/google-id-token` | Legacy ID token mirror (for tooling) |

ID tokens expire in ~1 hour. Refresh runs automatically on MCP tool calls and at MCP startup.

## Cursor MCP config

### Remote (recommended for the team)

Uses prod CoreStore + connectors on Scaleway. First `@tomcat.eu` login auto-creates an `internal_team` row in `users`.

```bash
npm run auth:google
npm run auth:token
```

Paste the snippet into `~/.cursor/mcp.json`, or configure manually:

```json
{
  "mcpServers": {
    "tomcat-core": {
      "url": "https://tomcatcore91c5e290-api.functions.fnc.fr-par.scw.cloud/mcp",
      "headers": {
        "Authorization": "Bearer <google-id-token>"
      }
    }
  }
}
```

Re-run `npm run auth:token` when the token expires (~1 hour).

### Local stdio (dev / offline)

```json
{
  "mcpServers": {
    "tomcat-core-local": {
      "command": "/absolute/path/to/tomcat-core/scripts/mcp-launch.sh"
    }
  }
}
```

Before first use: `npm run auth:google`.

## Security model

**Enforced today**

- Google ID token verified cryptographically (`aud`, `email_verified`, `hd=tomcat.eu`)
- Prod + Postgres: first `@tomcat.eu` login auto-provisions `internal_team` in `users`; revoked users stay blocked (`active=false`)
- MCP remote `/mcp` requires the same Bearer token and `ai.query` permission (internal roles)
- MCP re-resolves identity before **each tool call** (stdio: token refresh from local session)
- Approval-required MCP tools blocked on MCP surfaces
- Mock auth forbidden in production

**Known limits**

- Remote MCP uses prod connectors via CoreStore; no local `.env` connector keys needed in Cursor.
- Bearer tokens expire ~1h; refresh with `npm run auth:token` (stdio refreshes automatically).
- stdio local still reads `.env` connectors directly; keep for offline dev only.
- Single `GOOGLE_OAUTH_CLIENT_ID` today; add comma-separated audiences before Society Web client.

## Token lifecycle (UX)

| Surface | Token source | Expiry handling |
| --- | --- | --- |
| **stdio local** | `.secrets/google-oauth-session.json` | Auto-refresh via refresh token before each tool call |
| **HTTP remote (Cursor)** | Static `Authorization` header in `mcp.json` | Manual: `npm run auth:token` then update header (~1h) |

First `@tomcat.eu` Google login auto-creates `internal_team` in Postgres. Re-login does **not** restore access after `active=false`.

**Remote MCP expired token:** HTTP 401 with `reason: invalid_token` → re-run `npm run auth:token`.

**Revoked user:** HTTP 401 with `reason: access_revoked` → contact admin; `auth:google` will not help.

**Revoke access**

```sql
UPDATE users SET active = false, updated_at = now()::text WHERE email = 'user@tomcat.eu';
```

## Admin: roles and revoke

First Google login for `@tomcat.eu` creates `internal_team` automatically. Use SQL or `POST /internal/users` to promote roles (e.g. `admin`) or re-enable someone.

```bash
./scripts/scaleway/db-psql.sh
```

Promote or re-enable:

```sql
INSERT INTO users (email, role, team, active, created_at, updated_at)
VALUES ('name@tomcat.eu', 'admin', NULL, true, now()::text, now()::text)
ON CONFLICT (email) DO UPDATE SET active = true, role = EXCLUDED.role, updated_at = now()::text;
```

Or `POST /internal/users` as an existing admin.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| MCP fails at start (stdio) | `npm run auth:status` then `npm run auth:google` |
| Remote MCP → 401 | Re-run `npm run auth:token` and update Cursor headers |
| Remote MCP → 403 | User inactive in `users`, non-internal role, or service token (humans only) |
| Remote MCP works once then 401 | Google ID token expired (~1h); re-run `npm run auth:token` |
| Remote MCP → 500 after auth | Check Scaleway logs; tool/connectors issue inside MCP handler |
| `/me` → 401 | Token expired; re-login or wait for refresh |
| `/me` → AUTH_INVALID revoked | User has `active=false` in `users` |
| Google shows all accounts | Normal UI; only `@tomcat.eu` Workspace accounts succeed |
| `redirect_uri_mismatch` | Client must be **Desktop**, not Web |

See also: [docs/society.md](./society.md), [DEPLOY.md](../DEPLOY.md), [DATABASE.md](../DATABASE.md).
