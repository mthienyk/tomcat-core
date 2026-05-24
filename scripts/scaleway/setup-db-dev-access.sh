#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/state.sh
source "$SCRIPT_DIR/lib/state.sh"

REGION="${SCW_DEFAULT_REGION:-fr-par}"
STATE_FILE="${STATE_FILE:-$SCRIPT_DIR/.infra-state.env}"
INSTANCE_ID="${DB_INSTANCE_ID:-$(read_state DB_INSTANCE_ID)}"

if [[ -z "$INSTANCE_ID" ]]; then
  echo "Missing DB_INSTANCE_ID. Run provision-infra.sh first." >&2
  exit 1
fi

detect_admin_ipv4() {
  if [[ -n "${DB_ADMIN_IPS:-}" ]]; then
    echo "$DB_ADMIN_IPS"
    return
  fi
  local ip
  ip="$(curl -4 -sS --max-time 10 https://api.ipify.org || true)"
  if [[ -z "$ip" ]]; then
    echo "Could not detect your public IPv4. Set DB_ADMIN_IPS=1.2.3.4/32" >&2
    exit 1
  fi
  echo "${ip}/32"
}

normalize_acl_ips() {
  python3 - <<'PY' "$@"
import sys

out = []
for raw in sys.argv[1:]:
    for part in raw.replace(",", " ").split():
        part = part.strip()
        if not part:
            continue
        if "/" not in part:
            part = f"{part}/32"
        out.append(part)
print(",".join(dict.fromkeys(out)))
PY
}

require_scw

ACL_IPS="$(normalize_acl_ips "$(detect_admin_ipv4)")"
echo "Whitelisting admin IP(s): $ACL_IPS"

IFS=',' read -r -a ACL_ARRAY <<< "$ACL_IPS"
ACL_ARGS=()
for ip in "${ACL_ARRAY[@]}"; do
  ACL_ARGS+=("$ip")
done

scw rdb acl set "${ACL_ARGS[@]}" \
  instance-id="$INSTANCE_ID" \
  region="$REGION" \
  -w

PUBLIC_ENDPOINT_ID="$(scw rdb instance get "$INSTANCE_ID" region="$REGION" -o json \
  | python3 -c "
import json, sys
data = json.load(sys.stdin)
for ep in data.get('endpoints', []):
    if ep.get('private_network') is None:
        print(ep.get('id', ''))
        break
")"

if [[ -z "$PUBLIC_ENDPOINT_ID" ]]; then
  echo "Creating public load-balancer endpoint (ACL already set)..."
  scw rdb endpoint create "$INSTANCE_ID" load-balancer=true region="$REGION" -w
fi

read -r PUBLIC_HOST PUBLIC_PORT PUBLIC_ENDPOINT_ID <<< "$(scw rdb instance get "$INSTANCE_ID" region="$REGION" -o json \
  | python3 -c "
import json, sys
data = json.load(sys.stdin)
for ep in data.get('endpoints', []):
    if ep.get('private_network') is None:
        print(ep.get('ip', ''), ep.get('port', 5432), ep.get('id', ''))
        break
else:
    sys.exit(1)
")"

CERT_DIR="$SCRIPT_DIR/.certs"
mkdir -p "$CERT_DIR"
scw rdb instance get-certificate "$INSTANCE_ID" region="$REGION" -o json \
  | python3 -c "import json,sys; print(json.load(sys.stdin))" \
  > "$CERT_DIR/rdb-${INSTANCE_ID}.pem"

write_state DB_PUBLIC_HOST "$PUBLIC_HOST"
write_state DB_PUBLIC_PORT "$PUBLIC_PORT"
write_state DB_PUBLIC_ENDPOINT_ID "$PUBLIC_ENDPOINT_ID"
write_state DB_ADMIN_ACL_IPS "$ACL_IPS"

cat <<EOF

Admin DB access enabled (IP-restricted public endpoint).

  Host:     $PUBLIC_HOST
  Port:     $PUBLIC_PORT
  Database: tomcat_core
  User:     tomcat_admin
  TLS cert: $CERT_DIR/rdb-${INSTANCE_ID}.pem
  ACL:      $ACL_IPS

Connect:
  ./scripts/scaleway/db-psql.sh

Or manually (password from .env.secrets DATABASE_URL):
  psql "postgresql://tomcat_admin@$PUBLIC_HOST:$PUBLIC_PORT/tomcat_core?sslmode=require"

Teardown when done:
  ./scripts/scaleway/teardown-db-dev-access.sh

EOF
