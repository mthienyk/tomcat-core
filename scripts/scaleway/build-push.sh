#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"

read_env_var() {
  local key="$1"
  if [[ ! -f "$ENV_FILE" ]]; then
    return 0
  fi
  python3 - "$ENV_FILE" "$key" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
key = sys.argv[2]
if not path.is_file():
    sys.exit(0)

for raw in path.read_text().splitlines():
    line = raw.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    name, value = line.split("=", 1)
    if name.strip() == key:
        print(value.strip().strip('"').strip("'"))
        break
PY
}

REGION="${SCW_DEFAULT_REGION:-$(read_env_var SCW_DEFAULT_REGION)}"
REGION="${REGION:-fr-par}"
REGISTRY_NAME="${REGISTRY_NAME:-tomcat-core}"
IMAGE_NAME="${IMAGE_NAME:-api}"
TAG="${TAG:-$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo v0.1.0)}"
IMAGE="rg.${REGION}.scw.cloud/${REGISTRY_NAME}/${IMAGE_NAME}:${TAG}"

SECRET_KEY="${SCW_SECRET_KEY:-$(read_env_var SCW_SECRET_KEY)}"
SECRET_KEY="${SECRET_KEY:-$(read_env_var SCALEWAY_SECRET_KEY)}"

if [[ -z "$SECRET_KEY" ]]; then
  echo "Set SCALEWAY_SECRET_KEY in .env for docker login." >&2
  exit 1
fi

echo "Building $IMAGE (linux/amd64)..."
docker build --platform linux/amd64 -t "$IMAGE" "$ROOT_DIR"

echo "Logging into Scaleway registry..."
echo "$SECRET_KEY" | docker login "rg.${REGION}.scw.cloud" -u nologin --password-stdin

echo "Pushing $IMAGE..."
docker push "$IMAGE"

echo
echo "IMAGE=$IMAGE"
