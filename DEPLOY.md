# Deploy Tomcat Core on Scaleway

## Secrets GitHub (Settings → Secrets and variables → Actions)

| Secret | Value |
|---|---|
| `SCW_ACCESS_KEY` | Access Key IAM (`SCW...`) |
| `SCW_SECRET_KEY` | Secret Key IAM |
| `SCW_DEFAULT_PROJECT_ID` | `e0af5962-2c29-45f5-8921-b5a8f9976f4d` |
| `SCW_DEFAULT_REGION` | `fr-par` |
| `SCW_CONTAINER_ID` | Optional fallback if name lookup fails (`tomcat-core` / `api`). Prefer `scripts/scaleway/.infra-state.env` after manual deploy. |

Application secrets are injected as encrypted container env vars at deploy time. Keep a local `.env.secrets` (gitignored); `deploy-container.sh` reads it directly. `seed-secrets.sh` mirrors the same values into Scaleway Secret Manager for backup/reference.

Required in `.env.secrets` for deploy:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres read model |
| `SERVICE_TOKEN_SECRET` | Service JWT signing |
| `GOOGLE_OAUTH_CLIENT_ID` | Google Desktop client id (CLI + ID token verification) |
| `GOOGLE_OAUTH_WEB_CLIENT_ID` | Google Web client id (MCP OAuth proxy) |
| `GOOGLE_OAUTH_WEB_CLIENT_SECRET` | Google Web client secret (MCP OAuth proxy) |
| `HUBSPOT_WEBHOOK_CLIENT_SECRET` | Optional — HubSpot app client secret for `/webhooks/hubspot` |
| `SIGNAL_HUB_ENABLED` | Optional override (`false` default in deploy script) |

Sync engine tunables (`HUBSPOT_MAX_REQUESTS_PER_10S`, `SYNC_QUEUE_*`, `SYNC_RECONCILE_*`) can live in `.env` or `.env.secrets`; deploy reads both. See [docs/hubspot-sync-engine.md](./docs/hubspot-sync-engine.md).

Human auth: [docs/auth-google-mcp.md](./docs/auth-google-mcp.md). After deploy, add team members to the `users` table before they can call protected routes with Google tokens.

**MCP remote:** Cursor can use the built-in OAuth flow (no static Bearer header). Set `OAUTH_ISSUER_URL` to the Scaleway API base URL. Flip `SIGNAL_HUB_ENABLED=true` when LinkedIn ingest goes live.

## Redéploiement manuel

```bash
./scripts/scaleway/init-cli.sh
./scripts/scaleway/build-push.sh
IMAGE=rg.fr-par.scw.cloud/tomcat-core/api:<tag> \
CORS_ALLOWED_ORIGINS=https://www.tomcat.eu \
./scripts/scaleway/deploy-container.sh
curl "$(grep HTTPS_URL scripts/scaleway/.infra-state.env | cut -d= -f2-)/health"
npm run auth:status   # local session check
```

**Sync env only** (new config keys, no image rebuild):

```bash
chmod +x scripts/scaleway/patch-container-env.sh
./scripts/scaleway/patch-container-env.sh
```

Push sur `main` déclenche aussi le workflow `.github/workflows/deploy.yml` (build → deploy → smoke).

## Logs

Scaleway Console → **Cockpit** → **Logs** → filtrer sur le container namespace `tomcat-core`.

Les logs applicatifs sont du JSON structuré (pino) sur stdout.

## Postgres (requêtes admin)

Voir [DATABASE.md](./DATABASE.md) : accès `psql` depuis ton Mac via endpoint IP-restreint ou bastion SSH.
