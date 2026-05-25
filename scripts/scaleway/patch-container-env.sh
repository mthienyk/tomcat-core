#!/usr/bin/env bash
# Merge Scaleway Serverless Container env vars from .env + .env.secrets (no image rebuild).
# Preserves existing container env keys — never replaces the full map with a partial patch.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
STATE_FILE="${STATE_FILE:-$SCRIPT_DIR/.infra-state.env}"
SECRETS_FILE="${SECRETS_FILE:-$ROOT_DIR/.env.secrets}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
REGION="${SCW_DEFAULT_REGION:-fr-par}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

export SCW_ACCESS_KEY="${SCW_ACCESS_KEY:-$(grep '^SCALEWAY_ACCESS_KEY_ID=' "$ENV_FILE" | cut -d= -f2-)}"
export SCW_SECRET_KEY="${SCW_SECRET_KEY:-$(grep '^SCALEWAY_SECRET_KEY=' "$ENV_FILE" | cut -d= -f2-)}"
export SCW_DEFAULT_REGION="$REGION"

CONTAINER_ID="${CONTAINER_ID:-$(grep '^SCW_CONTAINER_ID=' "$ENV_FILE" | cut -d= -f2-)}"
if [[ -z "$CONTAINER_ID" && -f "$STATE_FILE" ]]; then
  CONTAINER_ID="$(grep '^CONTAINER_ID=' "$STATE_FILE" | cut -d= -f2-)"
fi
if [[ -z "$CONTAINER_ID" ]]; then
  echo "Set SCW_CONTAINER_ID in .env or CONTAINER_ID in $STATE_FILE" >&2
  exit 1
fi

echo "Merging env on container $CONTAINER_ID (region=$REGION)..."

python3 - "$ROOT_DIR" "$SECRETS_FILE" "$ENV_FILE" "$CONTAINER_ID" "$REGION" <<'PY'
import json
import subprocess
import sys
from pathlib import Path

root, secrets_file, env_file, container_id, region = sys.argv[1:6]

def read_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip()
    return out

secrets = read_env(Path(secrets_file))
env = read_env(Path(env_file))

def pick(key: str, default: str = "") -> str:
    return secrets.get(key) or env.get(key) or default

current = json.loads(
    subprocess.check_output(
        [
            "scw", "container", "container", "get", container_id,
            f"region={region}", "-o", "json",
        ],
        text=True,
    )
)

public_env = dict(current.get("environment_variables") or {})
secret_env = dict(current.get("secret_environment_variables") or {})

# Baseline prod public env (restore if a previous partial patch wiped them)
defaults = {
    "NODE_ENV": "production",
    "LOG_LEVEL": "info",
    "SIGNAL_STORE_DRIVER": "postgres",
    "SIGNAL_HUB_ENABLED": pick("SIGNAL_HUB_ENABLED", "false"),
    "ALLOW_MOCK_AUTH": "false",
    "CORS_ALLOWED_ORIGINS": pick(
        "CORS_ALLOWED_ORIGINS",
        "https://society.tomcat.eu,https://www.tomcat.eu",
    ),
    "SERVICE_CLIENTS": pick(
        "SERVICE_CLIENTS",
        "society:society.read|society.write,team-mcp:ai.query|briefs.write",
    ),
    "ALLOWED_GOOGLE_DOMAINS": pick("ALLOWED_GOOGLE_DOMAINS", "tomcat.eu"),
    "OAUTH_ISSUER_URL": pick(
        "OAUTH_ISSUER_URL",
        "https://tomcatcore91c5e290-api.functions.fnc.fr-par.scw.cloud",
    ),
    "OAUTH_ALLOWED_REDIRECT_URI_PREFIXES": pick(
        "OAUTH_ALLOWED_REDIRECT_URI_PREFIXES",
        "cursor://,https://www.cursor.com/,http://localhost:,https://claude.ai/,https://claude.com/",
    ),
}

for key, value in defaults.items():
    if not public_env.get(key):
        public_env[key] = value

sync_keys = {
    "SYNC_OVERLAP_GRACE_MINUTES": pick("SYNC_OVERLAP_GRACE_MINUTES", "20"),
    "HUBSPOT_MAX_REQUESTS_PER_10S": pick("HUBSPOT_MAX_REQUESTS_PER_10S", "90"),
    "SYNC_QUEUE_POLL_INTERVAL_MS": pick("SYNC_QUEUE_POLL_INTERVAL_MS", "5000"),
    "SYNC_QUEUE_BATCH_SIZE": pick("SYNC_QUEUE_BATCH_SIZE", "3"),
    "SYNC_QUEUE_STALE_JOB_MS": pick("SYNC_QUEUE_STALE_JOB_MS", "600000"),
    "SYNC_QUEUE_RETRY_DELAY_MS": pick("SYNC_QUEUE_RETRY_DELAY_MS", "60000"),
    "SYNC_RECONCILE_INTERVAL_MS": pick("SYNC_RECONCILE_INTERVAL_MS", "21600000"),
    "SYNC_RECONCILE_LOOKBACK_MS": pick("SYNC_RECONCILE_LOOKBACK_MS", "300000"),
    "HUBSPOT_WEBHOOK_PUBLIC_URL": pick(
        "HUBSPOT_WEBHOOK_PUBLIC_URL",
        f"{public_env['OAUTH_ISSUER_URL'].rstrip('/')}/webhooks/hubspot",
    ),
    "CRM_MEMORY_INDEX_ENABLED": pick("CRM_MEMORY_INDEX_ENABLED", "true"),
    "CRM_MEMORY_INDEX_BATCH_SIZE": pick("CRM_MEMORY_INDEX_BATCH_SIZE", "20"),
    "CRM_MEMORY_INDEX_CONCURRENCY": pick("CRM_MEMORY_INDEX_CONCURRENCY", "20"),
    "CRM_MEMORY_INDEX_INTERVAL_MS": pick("CRM_MEMORY_INDEX_INTERVAL_MS", "30000"),
    "CRM_MEMORY_SEMANTIC_PROVIDER": pick("CRM_MEMORY_SEMANTIC_PROVIDER", "openai"),
    "CRM_MEMORY_SEMANTIC_MODEL": pick("CRM_MEMORY_SEMANTIC_MODEL", "gpt-5-mini"),
    "CRM_MEMORY_REASONING_EFFORT": pick("CRM_MEMORY_REASONING_EFFORT", "minimal"),
    "OAUTH_ALLOWED_REDIRECT_URI_PREFIXES": pick(
        "OAUTH_ALLOWED_REDIRECT_URI_PREFIXES",
        "cursor://,https://www.cursor.com/,http://localhost:,https://claude.ai/,https://claude.com/",
    ),
}
public_env.update(sync_keys)

webhook_secret = pick("HUBSPOT_WEBHOOK_CLIENT_SECRET")
if webhook_secret:
    secret_env["HUBSPOT_WEBHOOK_CLIENT_SECRET"] = webhook_secret

args = [f"region={region}"]
for key, value in sorted(public_env.items()):
    args.append(f"environment-variables.{key}={value}")
for key, value in sorted(secret_env.items()):
    args.append(f"secret-environment-variables.{key}={value}")

subprocess.check_call(["scw", "container", "container", "update", container_id, *args])
print(f"Updated {len(public_env)} public and {len(secret_env)} secret env vars")
PY

for i in $(seq 1 36); do
  STATUS="$(scw container container get "$CONTAINER_ID" region="$REGION" -o json \
    | python3 -c "import json,sys; print(json.load(sys.stdin).get('status',''))")"
  if [[ "$STATUS" == "ready" || "$STATUS" == "error" ]]; then
    break
  fi
  sleep 5
done

echo "Redeploying container..."
scw container container redeploy "$CONTAINER_ID" region="$REGION" >/dev/null

for i in $(seq 1 36); do
  STATUS="$(scw container container get "$CONTAINER_ID" region="$REGION" -o json \
    | python3 -c "import json,sys; print(json.load(sys.stdin).get('status',''))")"
  echo "poll $i: $STATUS"
  if [[ "$STATUS" == "ready" ]]; then
    echo "Container env synced."
    exit 0
  fi
  if [[ "$STATUS" == "error" ]]; then
    scw container container get "$CONTAINER_ID" region="$REGION" -o json \
      | python3 -c "import json,sys; c=json.load(sys.stdin); print(c.get('error_message',''))"
    exit 1
  fi
  sleep 5
done

echo "Timed out waiting for ready status." >&2
exit 1
