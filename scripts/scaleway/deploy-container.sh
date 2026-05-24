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

required = {
    "DATABASE_URL": secrets.get("DATABASE_URL", ""),
    "SERVICE_TOKEN_SECRET": secrets.get("SERVICE_TOKEN_SECRET", ""),
    "ANTHROPIC_API_KEY": secrets.get("ANTHROPIC_API_KEY", ""),
    "OPENAI_API_KEY": secrets.get("OPENAI_API_KEY", ""),
    "HUBSPOT_API_TOKEN": secrets.get("HUBSPOT_API_TOKEN", ""),
    "MONDAY_API_TOKEN": secrets.get("MONDAY_API_TOKEN", ""),
    "GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON": drive_json,
    "GOOGLE_OAUTH_CLIENT_ID": google_oauth_client_id,
}
for key, value in required.items():
    if not value:
        raise SystemExit(f"Missing {key} in {secrets_file}")

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
        "ALLOW_MOCK_AUTH": "false",
        "CORS_ALLOWED_ORIGINS": cors,
        "SERVICE_CLIENTS": "society:society.read|society.write,team-mcp:ai.query|briefs.write",
        "ALLOWED_GOOGLE_DOMAINS": "tomcat.eu",
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
