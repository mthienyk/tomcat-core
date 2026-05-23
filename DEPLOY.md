# Deploy Tomcat Core on Scaleway

## Secrets GitHub (Settings → Secrets and variables → Actions)

| Secret | Value |
|---|---|
| `SCW_ACCESS_KEY` | Access Key IAM (`SCW...`) |
| `SCW_SECRET_KEY` | Secret Key IAM |
| `SCW_DEFAULT_PROJECT_ID` | `e0af5962-2c29-45f5-8921-b5a8f9976f4d` |
| `SCW_DEFAULT_REGION` | `fr-par` |
| `SCW_CONTAINER_ID` | Output of `deploy-container.sh` (`CONTAINER_ID=...`) |

Application secrets are injected as encrypted container env vars at deploy time. Keep a local `.env.secrets` (gitignored); `deploy-container.sh` reads it directly. `seed-secrets.sh` mirrors the same values into Scaleway Secret Manager for backup/reference.

## Redéploiement manuel

```bash
./scripts/scaleway/init-cli.sh
./scripts/scaleway/build-push.sh
IMAGE=rg.fr-par.scw.cloud/tomcat-core/api:<tag> \
CORS_ALLOWED_ORIGINS=https://society.tomcat.eu \
./scripts/scaleway/deploy-container.sh
curl "$(grep HTTPS_URL scripts/scaleway/.infra-state.env | cut -d= -f2-)/health"
```

Push sur `main` déclenche aussi le workflow `.github/workflows/deploy.yml` (build → deploy → smoke).

## Logs

Scaleway Console → **Cockpit** → **Logs** → filtrer sur le container namespace `tomcat-core`.

Les logs applicatifs sont du JSON structuré (pino) sur stdout.
