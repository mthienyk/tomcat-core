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
| `GOOGLE_OAUTH_CLIENT_ID` | Google `@tomcat.eu` human auth (Desktop client id) |
| Connector / LLM keys | See `.env.secrets.example` |

Human auth: [docs/auth-google-mcp.md](./docs/auth-google-mcp.md). After deploy, add team members to the `users` table before they can call protected routes with Google tokens.

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

Push sur `main` déclenche aussi le workflow `.github/workflows/deploy.yml` (build → deploy → smoke).

## Logs

Scaleway Console → **Cockpit** → **Logs** → filtrer sur le container namespace `tomcat-core`.

Les logs applicatifs sont du JSON structuré (pino) sur stdout.

## Postgres (requêtes admin)

Voir [DATABASE.md](./DATABASE.md) : accès `psql` depuis ton Mac via endpoint IP-restreint ou bastion SSH.
