#!/usr/bin/env bash
set -euo pipefail

# Seeds Scaleway Secret Manager from a local gitignored file.
# Copy .env.secrets.example → .env.secrets and fill values before running.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SECRETS_FILE="${SECRETS_FILE:-$ROOT_DIR/.env.secrets}"
STATE_FILE="${STATE_FILE:-$SCRIPT_DIR/.infra-state.env}"
REGION="${SCW_DEFAULT_REGION:-fr-par}"
PROJECT_ID="${SCW_DEFAULT_PROJECT_ID:-e0af5962-2c29-45f5-8921-b5a8f9976f4d}"

read_env_var() {
  local file="$1"
  local key="$2"
  python3 - "$file" "$key" <<'PY'
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

write_state() {
  local key="$1"
  local value="$2"
  touch "$STATE_FILE"
  python3 - "$STATE_FILE" "$key" "$value" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
key = sys.argv[2]
value = sys.argv[3]
lines = path.read_text().splitlines() if path.is_file() else []
out, replaced = [], False
for line in lines:
    if line.startswith(f"{key}="):
        out.append(f"{key}={value}")
        replaced = True
    else:
        out.append(line)
if not replaced:
    out.append(f"{key}={value}")
path.write_text("\n".join(out) + "\n")
PY
}

ensure_secret() {
  local name="$1"
  local data="$2"
  local existing_id
  existing_id="$(scw secret secret list region="$REGION" -o json \
    | python3 -c "import json,sys; ss=[s for s in json.load(sys.stdin) if s.get('name')=='$name']; print(ss[0]['id'] if ss else '')")"

  if [[ -z "$existing_id" ]]; then
    existing_id="$(scw secret secret create name="$name" region="$REGION" project-id="$PROJECT_ID" -o json \
      | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")"
  fi

  scw secret version create secret-id="$existing_id" data="$data" region="$REGION" disable-previous=true >/dev/null
  echo "$existing_id"
}

if [[ ! -f "$SECRETS_FILE" ]]; then
  echo "Missing $SECRETS_FILE — copy .env.secrets.example and fill values." >&2
  exit 1
fi

if ! scw info >/dev/null 2>&1; then
  echo "Run scripts/scaleway/init-cli.sh first." >&2
  exit 1
fi

DATABASE_URL="${DATABASE_URL:-$(read_env_var "$SECRETS_FILE" DATABASE_URL)}"
if [[ -n "$DATABASE_URL" ]]; then
  DATABASE_URL="$(python3 - <<'PY' "$DATABASE_URL"
import sys
from urllib.parse import urlsplit, urlunsplit, quote

raw = sys.argv[1]
parts = urlsplit(raw)
if parts.password is None and "@" in parts.netloc:
    userinfo, hostport = parts.netloc.rsplit("@", 1)
    if ":" in userinfo:
        user, password = userinfo.split(":", 1)
        netloc = f"{quote(user, safe='')}:{quote(password, safe='')}@{hostport}"
        print(urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment)))
    else:
        print(raw)
else:
    user = parts.username or ""
    password = parts.password or ""
    host = parts.hostname or ""
    port = f":{parts.port}" if parts.port else ""
    netloc = f"{quote(user, safe='')}:{quote(password, safe='')}@{host}{port}"
    print(urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment)))
PY
)"
fi
SERVICE_TOKEN_SECRET="${SERVICE_TOKEN_SECRET:-$(read_env_var "$SECRETS_FILE" SERVICE_TOKEN_SECRET)}"
SERVICE_TOKEN_SECRET="${SERVICE_TOKEN_SECRET:-$(openssl rand -hex 32)}"
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-$(read_env_var "$SECRETS_FILE" ANTHROPIC_API_KEY)}"
OPENAI_API_KEY="${OPENAI_API_KEY:-$(read_env_var "$SECRETS_FILE" OPENAI_API_KEY)}"
HUBSPOT_API_TOKEN="${HUBSPOT_API_TOKEN:-$(read_env_var "$SECRETS_FILE" HUBSPOT_API_TOKEN)}"
MONDAY_API_TOKEN="${MONDAY_API_TOKEN:-$(read_env_var "$SECRETS_FILE" MONDAY_API_TOKEN)}"
DRIVE_JSON="${GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON:-$(read_env_var "$SECRETS_FILE" GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON)}"
DRIVE_FILE="${GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE:-$(read_env_var "$SECRETS_FILE" GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE)}"
GOOGLE_OAUTH_WEB_CLIENT_ID="${GOOGLE_OAUTH_WEB_CLIENT_ID:-$(read_env_var "$SECRETS_FILE" GOOGLE_OAUTH_WEB_CLIENT_ID)}"
GOOGLE_OAUTH_WEB_CLIENT_SECRET="${GOOGLE_OAUTH_WEB_CLIENT_SECRET:-$(read_env_var "$SECRETS_FILE" GOOGLE_OAUTH_WEB_CLIENT_SECRET)}"
WEB_FILE="${GOOGLE_OAUTH_WEB_CLIENT_FILE:-$(read_env_var "$SECRETS_FILE" GOOGLE_OAUTH_WEB_CLIENT_FILE)}"

if [[ -z "$GOOGLE_OAUTH_WEB_CLIENT_SECRET" && -n "$WEB_FILE" ]]; then
  WEB_PATH="${WEB_FILE/#/$ROOT_DIR/}"
  if [[ -f "$WEB_PATH" ]]; then
    GOOGLE_OAUTH_WEB_CLIENT_SECRET="$(python3 - "$WEB_PATH" <<'PY'
import json, sys
from pathlib import Path
raw = json.loads(Path(sys.argv[1]).read_text())
web = raw.get("web") or raw.get("installed") or {}
print(web.get("client_secret", ""))
PY
)"
    if [[ -z "$GOOGLE_OAUTH_WEB_CLIENT_ID" ]]; then
      GOOGLE_OAUTH_WEB_CLIENT_ID="$(python3 - "$WEB_PATH" <<'PY'
import json, sys
from pathlib import Path
raw = json.loads(Path(sys.argv[1]).read_text())
web = raw.get("web") or raw.get("installed") or {}
print(web.get("client_id", ""))
PY
)"
    fi
  fi
fi

if [[ -z "$DRIVE_JSON" && -n "$DRIVE_FILE" ]]; then
  if [[ ! -f "$ROOT_DIR/$DRIVE_FILE" && ! -f "$DRIVE_FILE" ]]; then
    echo "Drive service account file not found: $DRIVE_FILE" >&2
    exit 1
  fi
  DRIVE_JSON="$(cat "${DRIVE_FILE/#/$ROOT_DIR/}" 2>/dev/null || cat "$DRIVE_FILE")"
fi

for required in DATABASE_URL ANTHROPIC_API_KEY OPENAI_API_KEY HUBSPOT_API_TOKEN MONDAY_API_TOKEN; do
  if [[ -z "${!required}" ]]; then
    echo "Missing $required in $SECRETS_FILE" >&2
    exit 1
  fi
done

if [[ -z "$DRIVE_JSON" ]]; then
  echo "Missing GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON or GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE" >&2
  exit 1
fi

echo "Creating/updating Secret Manager entries..."
DB_SECRET_ID="$(ensure_secret database-url "$DATABASE_URL")"
TOKEN_SECRET_ID="$(ensure_secret service-token-secret "$SERVICE_TOKEN_SECRET")"
ANTHROPIC_SECRET_ID="$(ensure_secret anthropic-api-key "$ANTHROPIC_API_KEY")"
OPENAI_SECRET_ID="$(ensure_secret openai-api-key "$OPENAI_API_KEY")"
HUBSPOT_SECRET_ID="$(ensure_secret hubspot-api-token "$HUBSPOT_API_TOKEN")"
MONDAY_SECRET_ID="$(ensure_secret monday-api-token "$MONDAY_API_TOKEN")"
DRIVE_SECRET_ID="$(ensure_secret google-drive-service-account-json "$DRIVE_JSON")"
if [[ -n "$GOOGLE_OAUTH_WEB_CLIENT_SECRET" ]]; then
  WEB_OAUTH_SECRET_ID="$(ensure_secret google-oauth-web-client-secret "$GOOGLE_OAUTH_WEB_CLIENT_SECRET")"
  write_state SECRET_ID_GOOGLE_OAUTH_WEB_CLIENT_SECRET "$WEB_OAUTH_SECRET_ID"
fi

write_state SECRET_ID_DATABASE_URL "$DB_SECRET_ID"
write_state SECRET_ID_SERVICE_TOKEN_SECRET "$TOKEN_SECRET_ID"
write_state SECRET_ID_ANTHROPIC_API_KEY "$ANTHROPIC_SECRET_ID"
write_state SECRET_ID_OPENAI_API_KEY "$OPENAI_SECRET_ID"
write_state SECRET_ID_HUBSPOT_API_TOKEN "$HUBSPOT_SECRET_ID"
write_state SECRET_ID_MONDAY_API_TOKEN "$MONDAY_SECRET_ID"
write_state SECRET_ID_GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON "$DRIVE_SECRET_ID"

echo
echo "Secrets seeded. IDs saved in $STATE_FILE"
echo "SERVICE_TOKEN_SECRET (store locally): ${SERVICE_TOKEN_SECRET:0:8}..."
