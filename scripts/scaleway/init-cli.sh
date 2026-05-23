#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
CONFIG_PATH="${SCW_CONFIG_PATH:-$HOME/.config/scw/config.yaml}"

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

ACCESS_KEY="${SCW_ACCESS_KEY:-$(read_env_var SCW_ACCESS_KEY)}"
ACCESS_KEY="${ACCESS_KEY:-$(read_env_var SCALEWAY_ACCESS_KEY)}"
ACCESS_KEY="${ACCESS_KEY:-$(read_env_var SCALEWAY_ACCESS_KEY_ID)}"
SECRET_KEY="${SCW_SECRET_KEY:-$(read_env_var SCW_SECRET_KEY)}"
SECRET_KEY="${SECRET_KEY:-$(read_env_var SCALEWAY_SECRET_KEY)}"
PROJECT_ID="${SCW_DEFAULT_PROJECT_ID:-$(read_env_var SCW_DEFAULT_PROJECT_ID)}"
PROJECT_ID="${PROJECT_ID:-e0af5962-2c29-45f5-8921-b5a8f9976f4d}"
REGION="${SCW_DEFAULT_REGION:-$(read_env_var SCW_DEFAULT_REGION)}"
REGION="${REGION:-fr-par}"
ZONE="${SCW_DEFAULT_ZONE:-$(read_env_var SCW_DEFAULT_ZONE)}"
ZONE="${ZONE:-fr-par-1}"

if [[ -z "$ACCESS_KEY" || ! "$ACCESS_KEY" =~ ^SCW ]]; then
  echo "Invalid or missing access key." >&2
  echo "Set SCALEWAY_ACCESS_KEY_ID (format SCWXXXXXXXXXXXXXXXXX) in .env." >&2
  echo "SCALEWAY_API_KEY is the key resource UUID, not the access key." >&2
  exit 1
fi

if [[ -z "$SECRET_KEY" ]]; then
  echo "Missing secret key. Set SCALEWAY_SECRET_KEY in .env." >&2
  exit 1
fi

ORG_ID="$(curl -sS -H "X-Auth-Token: $SECRET_KEY" \
  "https://api.scaleway.com/account/v3/projects/${PROJECT_ID}" \
  | python3 -c "import json,sys; print(json.load(sys.stdin).get('organization_id',''))")"

if [[ -z "$ORG_ID" ]]; then
  echo "Could not resolve organization_id for project $PROJECT_ID." >&2
  echo "Check SCALEWAY_SECRET_KEY and project access." >&2
  exit 1
fi

mkdir -p "$(dirname "$CONFIG_PATH")"
python3 - "$CONFIG_PATH" <<PY
from pathlib import Path

Path("$CONFIG_PATH").write_text(
    "\n".join(
        [
            "access_key: $ACCESS_KEY",
            "secret_key: $SECRET_KEY",
            "default_organization_id: $ORG_ID",
            "default_project_id: $PROJECT_ID",
            "default_region: $REGION",
            "default_zone: $ZONE",
            "",
        ]
    )
)
PY

echo "Wrote $CONFIG_PATH"
echo
scw info
echo
scw account project get "project-id=$PROJECT_ID" -o human
echo
echo "CLI ready for project $PROJECT_ID ($REGION / $ZONE)."
