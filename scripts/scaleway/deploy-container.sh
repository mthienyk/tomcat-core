#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
STATE_FILE="${STATE_FILE:-$SCRIPT_DIR/.infra-state.env}"
SECRETS_FILE="${SECRETS_FILE:-$ROOT_DIR/.env.secrets}"

REGION="${SCW_DEFAULT_REGION:-fr-par}"
CONTAINER_NS="${CONTAINER_NS:-tomcat-core}"
CONTAINER_NAME="${CONTAINER_NAME:-api}"
IMAGE="${IMAGE:-}"
CORS_ALLOWED_ORIGINS="${CORS_ALLOWED_ORIGINS:-}"

if [[ -z "$IMAGE" || -z "$CORS_ALLOWED_ORIGINS" ]]; then
  echo "Set IMAGE and CORS_ALLOWED_ORIGINS." >&2
  exit 1
fi

if [[ ! -f "$SECRETS_FILE" ]]; then
  echo "Missing $SECRETS_FILE" >&2
  exit 1
fi

python3 - "$ROOT_DIR" "$SECRETS_FILE" "$STATE_FILE" "$REGION" "$CONTAINER_NS" "$CONTAINER_NAME" "$IMAGE" "$CORS_ALLOWED_ORIGINS" <<'PY'
import json
import os
import subprocess
import sys
import time
from pathlib import Path

root, secrets_file, state_file, region, container_ns, container_name, image, cors = sys.argv[1:9]

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
env = read_env(Path(root) / ".env")
scw_secret = env.get("SCALEWAY_SECRET_KEY") or env.get("SCW_SECRET_KEY", "")
if not scw_secret:
    raise SystemExit("Missing SCALEWAY_SECRET_KEY in .env")

drive_json = secrets.get("GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON", "")
if not drive_json:
    drive_file = secrets.get("GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE", "")
    if drive_file:
        p = Path(root) / drive_file
        drive_json = p.read_text() if p.is_file() else Path(drive_file).read_text()

google_oauth_client_id = secrets.get("GOOGLE_OAUTH_CLIENT_ID", "") or env.get("GOOGLE_OAUTH_CLIENT_ID", "")
google_oauth_web_client_id = secrets.get("GOOGLE_OAUTH_WEB_CLIENT_ID", "") or env.get("GOOGLE_OAUTH_WEB_CLIENT_ID", "")
google_oauth_web_client_secret = secrets.get("GOOGLE_OAUTH_WEB_CLIENT_SECRET", "")
if not google_oauth_web_client_secret:
    web_file = secrets.get("GOOGLE_OAUTH_WEB_CLIENT_FILE", "")
    if web_file:
        p = Path(root) / web_file
        if p.is_file():
            raw = json.loads(p.read_text())
            web = raw.get("web") or raw.get("installed") or {}
            google_oauth_web_client_id = google_oauth_web_client_id or web.get("client_id", "")
            google_oauth_web_client_secret = web.get("client_secret", "")

oauth_issuer_url = (
    secrets.get("OAUTH_ISSUER_URL", "")
    or env.get("OAUTH_ISSUER_URL", "")
    or "https://tomcatcore91c5e290-api.functions.fnc.fr-par.scw.cloud"
).rstrip("/")

required = {
    "DATABASE_URL": secrets.get("DATABASE_URL", ""),
    "SERVICE_TOKEN_SECRET": secrets.get("SERVICE_TOKEN_SECRET", ""),
    "ANTHROPIC_API_KEY": secrets.get("ANTHROPIC_API_KEY", ""),
    "OPENAI_API_KEY": secrets.get("OPENAI_API_KEY", ""),
    "HUBSPOT_API_TOKEN": secrets.get("HUBSPOT_API_TOKEN", ""),
    "MONDAY_API_TOKEN": secrets.get("MONDAY_API_TOKEN", ""),
        "GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON": drive_json,
        "GOOGLE_DRIVE_SHARED_DRIVE_ID": secrets.get(
            "GOOGLE_DRIVE_SHARED_DRIVE_ID",
            env.get(
                "GOOGLE_DRIVE_SHARED_DRIVE_ID",
                "0AO2MAh9ncUDNUk9PVA",
            ),
        ),
        "GOOGLE_OAUTH_CLIENT_ID": google_oauth_client_id,
    "GOOGLE_OAUTH_WEB_CLIENT_ID": google_oauth_web_client_id,
    "GOOGLE_OAUTH_WEB_CLIENT_SECRET": google_oauth_web_client_secret,
}
for key, value in required.items():
    if not value:
        raise SystemExit(f"Missing {key} in {secrets_file}")

hubspot_webhook_secret = secrets.get(
    "HUBSPOT_WEBHOOK_CLIENT_SECRET",
    env.get("HUBSPOT_WEBHOOK_CLIENT_SECRET", ""),
)
if hubspot_webhook_secret:
    required["HUBSPOT_WEBHOOK_CLIENT_SECRET"] = hubspot_webhook_secret

state = read_env(Path(state_file))
pn_id = state.get("PRIVATE_NETWORK_ID", "")

ns_json = subprocess.check_output(
    ["scw", "container", "namespace", "list", f"region={region}", "-o", "json"],
    text=True,
)
ns_id = next(n["id"] for n in json.loads(ns_json) if n.get("name") == container_ns)

existing = subprocess.check_output(
    ["scw", "container", "container", "list", f"namespace-id={ns_id}", f"region={region}", "-o", "json"],
    text=True,
)
for c in json.loads(existing):
    if c.get("name") == container_name:
        subprocess.run(
            ["scw", "container", "container", "delete", c["id"], f"region={region}"],
            check=True,
        )
        time.sleep(8)

payload = {
    "name": container_name,
    "namespace_id": ns_id,
    "registry_image": image,
    "port": 8080,
    "protocol": "http1",
    "privacy": "public",
    "private_network_id": pn_id,
    "min_scale": int(os.environ.get("MIN_SCALE", "1")),
    "max_scale": int(os.environ.get("MAX_SCALE", "4")),
    "memory_limit": int(os.environ.get("MEMORY_MB", "2048")),
    "cpu_limit": int(os.environ.get("MVCPU", "1000")),
    "timeout": "300s",
    "environment_variables": {
        "NODE_ENV": "production",
        "LOG_LEVEL": "info",
        "SIGNAL_STORE_DRIVER": "postgres",
        "SIGNAL_HUB_ENABLED": "false",
        "ALLOW_MOCK_AUTH": "false",
        "CORS_ALLOWED_ORIGINS": cors,
        "SERVICE_CLIENTS": "society:society.read|society.write,team-mcp:ai.query|briefs.write",
        "ALLOWED_GOOGLE_DOMAINS": "tomcat.eu",
        "OAUTH_ISSUER_URL": oauth_issuer_url,
        "OAUTH_ALLOWED_REDIRECT_URI_PREFIXES": secrets.get(
            "OAUTH_ALLOWED_REDIRECT_URI_PREFIXES",
            env.get(
                "OAUTH_ALLOWED_REDIRECT_URI_PREFIXES",
                "cursor://,https://www.cursor.com/,http://localhost:",
            ),
        ),
        "SYNC_OVERLAP_GRACE_MINUTES": secrets.get(
            "SYNC_OVERLAP_GRACE_MINUTES",
            env.get("SYNC_OVERLAP_GRACE_MINUTES", "20"),
        ),
        "HUBSPOT_MAX_REQUESTS_PER_10S": secrets.get(
            "HUBSPOT_MAX_REQUESTS_PER_10S",
            env.get("HUBSPOT_MAX_REQUESTS_PER_10S", "90"),
        ),
        "SYNC_QUEUE_POLL_INTERVAL_MS": secrets.get(
            "SYNC_QUEUE_POLL_INTERVAL_MS",
            env.get("SYNC_QUEUE_POLL_INTERVAL_MS", "5000"),
        ),
        "SYNC_QUEUE_BATCH_SIZE": secrets.get(
            "SYNC_QUEUE_BATCH_SIZE",
            env.get("SYNC_QUEUE_BATCH_SIZE", "3"),
        ),
        "SYNC_QUEUE_STALE_JOB_MS": secrets.get(
            "SYNC_QUEUE_STALE_JOB_MS",
            env.get("SYNC_QUEUE_STALE_JOB_MS", "600000"),
        ),
        "SYNC_QUEUE_RETRY_DELAY_MS": secrets.get(
            "SYNC_QUEUE_RETRY_DELAY_MS",
            env.get("SYNC_QUEUE_RETRY_DELAY_MS", "60000"),
        ),
        "SYNC_RECONCILE_INTERVAL_MS": secrets.get(
            "SYNC_RECONCILE_INTERVAL_MS",
            env.get("SYNC_RECONCILE_INTERVAL_MS", "21600000"),
        ),
        "SYNC_RECONCILE_LOOKBACK_MS": secrets.get(
            "SYNC_RECONCILE_LOOKBACK_MS",
            env.get("SYNC_RECONCILE_LOOKBACK_MS", "300000"),
        ),
        "HUBSPOT_WEBHOOK_PUBLIC_URL": secrets.get(
            "HUBSPOT_WEBHOOK_PUBLIC_URL",
            env.get(
                "HUBSPOT_WEBHOOK_PUBLIC_URL",
                f"{oauth_issuer_url}/webhooks/hubspot",
            ),
        ),
        "CRM_MEMORY_INDEX_ENABLED": secrets.get(
            "CRM_MEMORY_INDEX_ENABLED",
            env.get("CRM_MEMORY_INDEX_ENABLED", "true"),
        ),
        "CRM_MEMORY_INDEX_BATCH_SIZE": secrets.get(
            "CRM_MEMORY_INDEX_BATCH_SIZE",
            env.get("CRM_MEMORY_INDEX_BATCH_SIZE", "20"),
        ),
        "CRM_MEMORY_INDEX_CONCURRENCY": secrets.get(
            "CRM_MEMORY_INDEX_CONCURRENCY",
            env.get("CRM_MEMORY_INDEX_CONCURRENCY", "20"),
        ),
        "CRM_MEMORY_INDEX_INTERVAL_MS": secrets.get(
            "CRM_MEMORY_INDEX_INTERVAL_MS",
            env.get("CRM_MEMORY_INDEX_INTERVAL_MS", "30000"),
        ),
        "CRM_MEMORY_SEMANTIC_PROVIDER": secrets.get(
            "CRM_MEMORY_SEMANTIC_PROVIDER",
            env.get("CRM_MEMORY_SEMANTIC_PROVIDER", "openai"),
        ),
        "CRM_MEMORY_SEMANTIC_MODEL": secrets.get(
            "CRM_MEMORY_SEMANTIC_MODEL",
            env.get("CRM_MEMORY_SEMANTIC_MODEL", "gpt-5-mini"),
        ),
        "CRM_MEMORY_REASONING_EFFORT": secrets.get(
            "CRM_MEMORY_REASONING_EFFORT",
            env.get("CRM_MEMORY_REASONING_EFFORT", "minimal"),
        ),
    },
    "secret_environment_variables": [
        {"key": key, "value": value} for key, value in required.items()
    ],
    "startup_probe": {
        "http": {"path": "/health"},
        "failure_threshold": 12,
        "interval": "5s",
        "timeout": "3s",
    },
    "liveness_probe": {
        "http": {"path": "/health"},
        "failure_threshold": 3,
        "interval": "30s",
        "timeout": "3s",
    },
}

def api(method: str, path: str, body: dict | None = None) -> dict:
    cmd = [
        "curl", "-sS", "-X", method,
        "-H", f"X-Auth-Token: {scw_secret}",
        "-H", "Content-Type: application/json",
    ]
    if body is not None:
        cmd += ["-d", json.dumps(body)]
    cmd.append(f"https://api.scaleway.com/containers/v1beta1/regions/{region}{path}")
    result = subprocess.check_output(cmd, text=True)
    return json.loads(result)

created = api("POST", "/containers", payload)
container_id = created["id"]
api("POST", f"/containers/{container_id}/deploy", {})

domain = ""
ready = False
for i in range(1, 61):
    current = api("GET", f"/containers/{container_id}")
    status = current.get("status")
    domain = current.get("domain_name") or current.get("public_endpoint", "")
    print(f"poll {i}: {status}")
    if status == "ready":
        ready = True
        break
    if status == "error":
        print(json.dumps(current, indent=2), file=sys.stderr)
        raise SystemExit(1)
    time.sleep(5)

if not ready:
    raise SystemExit("Container not ready after 5 minutes")

lines = Path(state_file).read_text().splitlines() if Path(state_file).is_file() else []
kv = dict(line.split("=", 1) for line in lines if "=" in line)
kv["CONTAINER_ID"] = container_id
kv["CONTAINER_HTTPS_URL"] = f"https://{domain.removeprefix('https://')}"
Path(state_file).write_text("\n".join(f"{k}={v}" for k, v in kv.items()) + "\n")

print()
print(f"CONTAINER_ID={container_id}")
print(f"HTTPS_URL=https://{domain.removeprefix('https://')}")
print(f"curl https://{domain.removeprefix('https://')}/health")
print(f"curl https://{domain.removeprefix('https://')}/health/readiness")
PY
