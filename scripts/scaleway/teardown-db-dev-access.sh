#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/state.sh
source "$SCRIPT_DIR/lib/state.sh"

REGION="${SCW_DEFAULT_REGION:-fr-par}"
STATE_FILE="${STATE_FILE:-$SCRIPT_DIR/.infra-state.env}"
INSTANCE_ID="${DB_INSTANCE_ID:-$(read_state DB_INSTANCE_ID)}"
ENDPOINT_ID="${DB_PUBLIC_ENDPOINT_ID:-$(read_state DB_PUBLIC_ENDPOINT_ID)}"

if [[ -z "$INSTANCE_ID" ]]; then
  echo "Missing DB_INSTANCE_ID." >&2
  exit 1
fi

require_scw

if [[ -n "$ENDPOINT_ID" ]]; then
  echo "Removing public endpoint $ENDPOINT_ID..."
  scw rdb endpoint delete "$ENDPOINT_ID" region="$REGION" -w || true
fi

echo "Clearing ACL rules..."
scw rdb acl set instance-id="$INSTANCE_ID" region="$REGION" -w 2>/dev/null || true

python3 - "$STATE_FILE" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
if not path.is_file():
    sys.exit(0)
keys = {"DB_PUBLIC_HOST", "DB_PUBLIC_PORT", "DB_PUBLIC_ENDPOINT_ID", "DB_ADMIN_ACL_IPS"}
lines = [line for line in path.read_text().splitlines() if line.split("=", 1)[0] not in keys]
path.write_text("\n".join(lines) + ("\n" if lines else ""))
PY

echo "Public admin access removed. Postgres remains reachable on the Private Network only."
