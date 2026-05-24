# Google Auth & MCP

How Tomcat Core authenticates humans (`@tomcat.eu`) for the HTTP API and the local MCP server.

## Overview

| Surface | Auth | Role source |
| --- | --- | --- |
| Core HTTP API (prod) | `Authorization: Bearer <google-id-token>` | Postgres `users` (fail closed) |
| Core HTTP API (service) | `X-Service-Token` JWT | Registered clients + optional `act_as` |
| MCP stdio (local) | Google session in `.secrets/` | DB if `DATABASE_URL` set, else dev placeholder |
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

# Start MCP (requires valid session when GOOGLE_OAUTH_CLIENT_ID is set)
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

```json
{
  "mcpServers": {
    "tomcat-core": {
      "command": "npm",
      "args": ["run", "mcp:stdio"],
      "cwd": "/absolute/path/to/tomcat-core"
    }
  }
}
```

Before first use: `npm run auth:google`.

## Security model

**Enforced today**

- Google ID token verified cryptographically (`aud`, `email_verified`, `hd=tomcat.eu`)
- Prod + Postgres: user must exist in `users` with `active=true` (no silent `internal_team` fallback)
- MCP re-resolves identity before **each tool call** (token refresh + role lookup)
- Approval-required MCP tools blocked over stdio
- Mock auth forbidden in production

**Known limits (local MCP stdio)**

- MCP reads connectors from local `.env` (HubSpot, Monday, Drive), not only through Core HTTP. Treat as **team dev tooling**, not a hardened remote endpoint.
- Long-lived Cursor MCP process: restart after role changes or run `auth:logout` + `auth:google`.
- Single `GOOGLE_OAUTH_CLIENT_ID` today; add comma-separated audiences before Society Web client.

**Revoke access**

```sql
UPDATE users SET active = false, updated_at = now()::text WHERE email = 'user@tomcat.eu';
```

## Admin: add a team member

```bash
./scripts/scaleway/db-psql.sh
```

```sql
INSERT INTO users (email, role, team, active, created_at, updated_at)
VALUES ('name@tomcat.eu', 'internal_team', NULL, true, now()::text, now()::text)
ON CONFLICT (email) DO UPDATE SET active = true, role = EXCLUDED.role, updated_at = now()::text;
```

Or `POST /internal/users` as an existing admin.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| MCP fails at start | `npm run auth:status` then `npm run auth:google` |
| `/me` → 401 | Token expired; re-login or wait for refresh |
| `/me` → AUTH_INVALID user record | Add user in `users` table |
| Google shows all accounts | Normal UI; only `@tomcat.eu` Workspace accounts succeed |
| `redirect_uri_mismatch` | Client must be **Desktop**, not Web |

See also: [docs/society.md](./society.md), [DEPLOY.md](../DEPLOY.md), [DATABASE.md](../DATABASE.md).
