#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=lib/state.sh
source "$SCRIPT_DIR/lib/state.sh"

STATE_FILE="${STATE_FILE:-$SCRIPT_DIR/.infra-state.env}"
SECRETS_FILE="${SECRETS_FILE:-$ROOT_DIR/.env.secrets}"
REGION="${SCW_DEFAULT_REGION:-fr-par}"
INSTANCE_ID="${DB_INSTANCE_ID:-$(read_state DB_INSTANCE_ID)}"

PUBLIC_HOST="${DB_PUBLIC_HOST:-$(read_state DB_PUBLIC_HOST)}"
PUBLIC_PORT="${DB_PUBLIC_PORT:-$(read_state DB_PUBLIC_PORT)}"

if [[ -z "$PUBLIC_HOST" ]]; then
  echo "No public DB endpoint configured." >&2
  echo "Run: ./scripts/scaleway/setup-db-dev-access.sh" >&2
  exit 1
fi

if [[ ! -f "$SECRETS_FILE" ]]; then
  echo "Missing $SECRETS_FILE" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  if [[ -x /opt/homebrew/opt/libpq/bin/psql ]]; then
    export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
  elif [[ -x /usr/local/opt/libpq/bin/psql ]]; then
    export PATH="/usr/local/opt/libpq/bin:$PATH"
  else
    echo "psql not found. Install with: brew install libpq && brew link --force libpq" >&2
    exit 1
  fi
fi

eval "$(python3 - "$SECRETS_FILE" "$PUBLIC_HOST" "$PUBLIC_PORT" <<'PY'
import sys
from pathlib import Path
from urllib.parse import quote, unquote, urlparse

secrets = {}
for raw in Path(sys.argv[1]).read_text().splitlines():
    line = raw.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    secrets[k.strip()] = v.strip()

db_url = secrets.get("DATABASE_URL", "")
if not db_url:
    raise SystemExit("DATABASE_URL missing in .env.secrets")

parsed = urlparse(db_url)
user = parsed.username or "tomcat_admin"
password = unquote(parsed.password or "")
dbname = (parsed.path or "/tomcat_core").lstrip("/") or "tomcat_core"
host = sys.argv[2]
port = sys.argv[3]

print(f"export PGPASSWORD={password!r}")
print(f"export PGUSER={user!r}")
print(f"export PGDATABASE={dbname!r}")
print(f"export PGHOST={host!r}")
print(f"export PGPORT={port!r}")
print("export PGSSLMODE=require")
PY
)"

CERT_FILE="$SCRIPT_DIR/.certs/rdb-${INSTANCE_ID}.pem"
if [[ -f "$CERT_FILE" ]]; then
  export PGSSLROOTCERT="$CERT_FILE"
fi

if [[ $# -gt 0 ]]; then
  psql -c "$*"
else
  psql
fi
