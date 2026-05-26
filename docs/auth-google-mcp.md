# Google Auth & MCP

How Tomcat Core authenticates humans (`@tomcat.eu`) for the HTTP API and the local MCP server.

## Overview

| Surface | Auth | Role source |
| --- | --- | --- |
| Core HTTP API (prod) | `Authorization: Bearer <google-id-token>` | Postgres `users` (auto-provision `@tomcat.eu`) |
| **MCP HTTP remote (prod)** | **MCP OAuth** (Cursor, Claude) or Bearer Google manuel | Postgres `users` + tokens opaques MCP OAuth |
| Core HTTP API (service) | `X-Service-Token` JWT | Registered clients + optional `act_as` |
| MCP stdio (local dev) | Google session in `.secrets/` | DB if `DATABASE_URL` set, else dev placeholder |
| Dev only | `X-Mock-Identity` header | Disabled when `NODE_ENV=production` |

Google OAuth uses two clients:

| Client | Usage |
| --- | --- |
| **Desktop** | CLI (`npm run auth:google`), stdio MCP, vérification Bearer Google manuel |
| **Web** | MCP OAuth proxy (`/oauth/*`) pour Cursor et Claude remote |

## One-time GCP setup

### Desktop client (CLI + stdio)

1. OAuth consent screen: **Internal**, domain `tomcat.eu`
2. Credentials → **Desktop app** → note Client ID
3. Set `GOOGLE_OAUTH_CLIENT_ID` in `.env` and `.env.secrets`
4. Download client JSON → `.secrets/google-oauth-desktop.json` (gitignored)

### Web client (MCP OAuth remote)

1. Credentials → **Web application**
2. Authorized redirect URIs: include `{OAUTH_ISSUER_URL}/oauth/callback/google`
3. Set `GOOGLE_OAUTH_WEB_CLIENT_ID` + secret in `.env.secrets`
4. Set `OAUTH_ISSUER_URL` to the public API base (ex. Scaleway HTTPS URL)

Prod deploy injects both client IDs, `OAUTH_ISSUER_URL`, and `ALLOWED_GOOGLE_DOMAINS` via `deploy-container.sh`.

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

### Remote OAuth (recommended)

Cursor gère login + refresh. **Ne pas** ajouter de header `Authorization` statique dans `mcp.json` (un vieux token peut prendre le dessus sur OAuth).

```json
{
  "mcpServers": {
    "tomcat-core": {
      "url": "https://tomcatcore91c5e290-api.functions.fnc.fr-par.scw.cloud/mcp"
    }
  }
}
```

Au premier connect : login Google `@tomcat.eu` via le flow MCP OAuth intégré.

Découverte : `GET /.well-known/oauth-protected-resource` et `GET /.well-known/oauth-authorization-server`.

### Remote Bearer manuel (fallback)

Utile pour debug ou clients sans OAuth MCP.

```bash
npm run auth:google
npm run auth:token
```

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

## Claude MCP config

Claude (web, Desktop, Cowork) se connecte via **Settings → Connectors → Add custom connector**.
Pas de token en query string ni de header statique dans l’URL (refusé par Anthropic).

1. URL MCP : `https://tomcatcore91c5e290-api.functions.fnc.fr-par.scw.cloud/mcp`
2. **Add**, puis **Connect**
3. Login Google `@tomcat.eu`

Team / Enterprise : un Owner ajoute d’abord le connecteur dans **Admin settings → Connectors** ;
les membres cliquent ensuite **Connect**.

Redirect URIs autorisées côté Tomcat (`POST /oauth/register`) :

- `https://claude.ai/api/mcp/auth_callback`
- `https://claude.com/api/mcp/auth_callback`

Réf. Anthropic : [Custom connectors with remote MCP](https://claude.com/docs/connectors/custom/remote-mcp),
[Authentication for connectors](https://claude.com/docs/connectors/building/authentication).

## Security model

**Enforced today**

- MCP remote `/mcp` accepts opaque OAuth tokens (broker) or Google ID tokens (manual Bearer)
- MCP OAuth resolver runs before Google JWT resolver (opaque tokens are not JWTs)
- Prod + Postgres: first `@tomcat.eu` login auto-provisions `internal_team` in `users`; revoked users stay blocked (`active=false`)
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
| **HTTP remote OAuth** | Tokens opaques émis par `/oauth/token` | Access **4h** ; refresh **90j** (sliding à chaque refresh). Usage régulier → pas de reconnexion manuelle. Inactivité >90j → Disconnect / Connect. |
| **HTTP remote Bearer** | Static `Authorization` header in `mcp.json` | Manual: `npm run auth:token` (~1h) |

First `@tomcat.eu` Google login auto-creates `internal_team` in Postgres. Re-login does **not** restore access after `active=false`.

**Remote MCP expired token:** HTTP 401 with `reason: invalid_token` → re-run `npm run auth:token`.

**Revoked user:** HTTP 401 with `reason: access_revoked` → contact admin; `auth:google` will not help.

**Revoke access**

```sql
UPDATE users SET active = false, updated_at = now()::text WHERE email = 'user@tomcat.eu';
```

Effet **immédiat** sur le prochain appel MCP ou refresh OAuth :
- `resolveRole` bloque (`access_revoked`, HTTP 401)
- refresh token rejeté et sessions OAuth purgées en base
- via `POST /internal/users` avec `active: false` → purge OAuth automatique


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
| OAuth OK in UI but `/mcp` → 401 | Retirer `headers.Authorization` stale de `mcp.json` |
| MCP fails at start (stdio) | `npm run auth:status` then `npm run auth:google` |
| Remote MCP → 401 (Bearer mode) | Re-run `npm run auth:token` and update Cursor headers |
| Remote MCP → 401 (OAuth mode) | Connector should refresh automatically; if not, **Disconnect → Connect** in Claude/Cursor |
| Remote MCP → 401 `invalid_token` | Session expired: **Disconnect → Connect** (server returns `WWW-Authenticate: error="invalid_token"`) |
| Remote MCP → 403 | User inactive in `users`, non-internal role, or service token (humans only) |
| Remote MCP works once then 401 | Google ID token expired (~1h); re-run `npm run auth:token` |
| Remote MCP → 500 after auth | Check Scaleway logs; tool/connectors issue inside MCP handler |
| `/me` → 401 | Token expired; re-login or wait for refresh |
| `/me` → AUTH_INVALID revoked | User has `active=false` in `users` |
| Google shows all accounts | Normal UI; only `@tomcat.eu` Workspace accounts succeed |
| `redirect_uri_mismatch` | Client must be **Desktop**, not Web |
| Claude « Not connected » / OAuth ne démarre pas | Vérifier `OAUTH_ALLOWED_REDIRECT_URI_PREFIXES` inclut `https://claude.ai/` et `https://claude.com/` ; redeploy ; Disconnect → Connect |
| Claude « Couldn't reach the MCP server » | Bug connu Anthropic (proxy `mcp-proxy.anthropic.com`) ; voir [claude-ai-mcp#217](https://github.com/anthropics/claude-ai-mcp/issues/217) |

See also: [docs/society.md](./society.md), [DEPLOY.md](../DEPLOY.md), [DATABASE.md](../DATABASE.md).
