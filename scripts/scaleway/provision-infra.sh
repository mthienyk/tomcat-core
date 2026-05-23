#!/usr/bin/env bash
set -euo pipefail

# Idempotent Scaleway provisioning for tomcat-core.
# Requires: ./scripts/scaleway/init-cli.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_FILE="${STATE_FILE:-$SCRIPT_DIR/.infra-state.env}"

REGION="${SCW_DEFAULT_REGION:-fr-par}"
ZONE="${SCW_DEFAULT_ZONE:-fr-par-1}"
PROJECT_ID="${SCW_DEFAULT_PROJECT_ID:-e0af5962-2c29-45f5-8921-b5a8f9976f4d}"
REGISTRY_NAME="${REGISTRY_NAME:-tomcat-core}"
CONTAINER_NS="${CONTAINER_NS:-tomcat-core}"
VPC_NAME="${VPC_NAME:-tomcat-core-vpc}"
PRIVATE_NETWORK_NAME="${PRIVATE_NETWORK_NAME:-tomcat-core-pn}"
DB_NAME="${DB_NAME:-tomcat-core-db}"
DB_USER="${DB_USER:-tomcat_admin}"
DB_DATABASE="${DB_DATABASE:-tomcat_core}"
DB_ENGINE="${DB_ENGINE:-PostgreSQL-16}"
DB_NODE="${DB_NODE:-DB-DEV-S}"

write_state() {
  local key="$1"
  local value="$2"
  touch "$STATE_FILE"
  if grep -q "^${key}=" "$STATE_FILE" 2>/dev/null; then
    python3 - "$STATE_FILE" "$key" "$value" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
key = sys.argv[2]
value = sys.argv[3]
lines = path.read_text().splitlines()
out = []
replaced = False
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
  else
    echo "${key}=${value}" >> "$STATE_FILE"
  fi
}

read_state() {
  local key="$1"
  if [[ ! -f "$STATE_FILE" ]]; then
    return 0
  fi
  python3 - "$STATE_FILE" "$key" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
key = sys.argv[2]
if not path.is_file():
    sys.exit(0)
for raw in path.read_text().splitlines():
    if raw.startswith(f"{key}="):
        print(raw.split("=", 1)[1])
        break
PY
}

json_field() {
  python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get(sys.argv[1],''))" "$1"
}

require_scw() {
  if ! scw info >/dev/null 2>&1; then
    echo "Run scripts/scaleway/init-cli.sh first." >&2
    exit 1
  fi
}

ensure_registry() {
  local existing
  existing="$(scw registry namespace list region="$REGION" -o json \
    | python3 -c "import json,sys; ns=[n for n in json.load(sys.stdin) if n.get('name')=='$REGISTRY_NAME']; print(ns[0]['id'] if ns else '')")"
  if [[ -n "$existing" ]]; then
    echo "Registry namespace '$REGISTRY_NAME' already exists ($existing)"
    return
  fi
  scw registry namespace create \
    name="$REGISTRY_NAME" \
    region="$REGION" \
    project-id="$PROJECT_ID" \
    is-public=false
}

ensure_container_namespace() {
  local existing
  existing="$(scw container namespace list region="$REGION" -o json \
    | python3 -c "import json,sys; ns=[n for n in json.load(sys.stdin) if n.get('name')=='$CONTAINER_NS']; print(ns[0]['id'] if ns else '')")"
  if [[ -n "$existing" ]]; then
    echo "Container namespace '$CONTAINER_NS' already exists ($existing)"
    write_state CONTAINER_NAMESPACE_ID "$existing"
    return
  fi
  local created
  created="$(scw container namespace create \
    name="$CONTAINER_NS" \
    region="$REGION" \
    project-id="$PROJECT_ID" \
    description="Tomcat Core API" \
    -o json)"
  write_state CONTAINER_NAMESPACE_ID "$(echo "$created" | json_field id)"
}

ensure_private_network() {
  local pn_id="${PRIVATE_NETWORK_ID:-$(read_state PRIVATE_NETWORK_ID)}"
  if [[ -n "$pn_id" ]]; then
    echo "Using Private Network $pn_id"
    write_state PRIVATE_NETWORK_ID "$pn_id"
    return
  fi

  pn_id="$(scw vpc private-network list region="$REGION" -o json \
    | python3 -c "import json,sys; pns=[n for n in json.load(sys.stdin) if n.get('name')=='$PRIVATE_NETWORK_NAME']; print(pns[0]['id'] if pns else '')")"
  if [[ -n "$pn_id" ]]; then
    echo "Private Network '$PRIVATE_NETWORK_NAME' already exists ($pn_id)"
    write_state PRIVATE_NETWORK_ID "$pn_id"
    return
  fi

  local vpc_id
  vpc_id="$(scw vpc vpc list region="$REGION" -o json \
    | python3 -c "import json,sys; vpcs=[v for v in json.load(sys.stdin) if v.get('name')=='$VPC_NAME']; print(vpcs[0]['id'] if vpcs else '')")"
  if [[ -z "$vpc_id" ]]; then
    echo "Creating VPC '$VPC_NAME'..."
    if ! vpc_json="$(scw vpc vpc create name="$VPC_NAME" region="$REGION" project-id="$PROJECT_ID" -o json 2>&1)"; then
      echo "$vpc_json" >&2
      echo "Could not create VPC. Set PRIVATE_NETWORK_ID in $STATE_FILE if one already exists in the console." >&2
      exit 1
    fi
    vpc_id="$(echo "$vpc_json" | json_field id)"
  fi

  echo "Creating Private Network '$PRIVATE_NETWORK_NAME'..."
  if ! pn_json="$(scw vpc private-network create \
    name="$PRIVATE_NETWORK_NAME" \
    region="$REGION" \
    project-id="$PROJECT_ID" \
    vpc-id="$vpc_id" \
    -o json 2>&1)"; then
    echo "$pn_json" >&2
    echo "Could not create Private Network (quota?). Create one in the console and set PRIVATE_NETWORK_ID in $STATE_FILE." >&2
    exit 1
  fi
  pn_id="$(echo "$pn_json" | json_field id)"
  write_state PRIVATE_NETWORK_ID "$pn_id"
  write_state VPC_ID "$vpc_id"
}

ensure_database() {
  local pn_id="${PRIVATE_NETWORK_ID:-$(read_state PRIVATE_NETWORK_ID)}"
  if [[ -z "$pn_id" ]]; then
    echo "Private Network ID missing. Run ensure_private_network first." >&2
    exit 1
  fi

  local existing
  existing="$(scw rdb instance list region="$REGION" -o json \
    | python3 -c "import json,sys; dbs=[d for d in json.load(sys.stdin) if d.get('name')=='$DB_NAME']; print(dbs[0]['id'] if dbs else '')")"
  if [[ -n "$existing" ]]; then
    echo "Database '$DB_NAME' already exists ($existing)"
    write_state DB_INSTANCE_ID "$existing"
    scw rdb instance get "$existing" region="$REGION" -o human
    print_db_connection_hint "$existing"
    return
  fi

  echo "Creating PostgreSQL '$DB_NAME' on Private Network only (~5 min)..."
  scw rdb instance create \
    name="$DB_NAME" \
    engine="$DB_ENGINE" \
    user-name="$DB_USER" \
    generate-password=true \
    node-type="$DB_NODE" \
    region="$REGION" \
    project-id="$PROJECT_ID" \
    init-endpoints.0.private-network.private-network-id="$pn_id" \
    init-endpoints.0.private-network.enable-ipam=true \
    -w

  local instance_id
  instance_id="$(scw rdb instance list region="$REGION" -o json \
    | python3 -c "import json,sys; dbs=[d for d in json.load(sys.stdin) if d.get('name')=='$DB_NAME']; print(dbs[0]['id'] if dbs else '')")"
  if [[ -z "$instance_id" ]]; then
    echo "Database '$DB_NAME' not found after create." >&2
    exit 1
  fi
  write_state DB_INSTANCE_ID "$instance_id"

  echo "Creating logical database '$DB_DATABASE'..."
  scw rdb database create instance-id="$instance_id" name="$DB_DATABASE" region="$REGION" || true

  echo "Granting privileges to $DB_USER on $DB_DATABASE..."
  scw rdb privilege set \
    instance-id="$instance_id" \
    database-name="$DB_DATABASE" \
    user-name="$DB_USER" \
    permission=all \
    region="$REGION"

  print_db_connection_hint "$instance_id"
}

print_db_connection_hint() {
  local instance_id="$1"
  local ip port
  read -r ip port <<< "$(scw rdb instance get "$instance_id" region="$REGION" -o json \
    | python3 -c "
import json, sys
data = json.load(sys.stdin)
for ep in data.get('endpoints', []):
    pn = ep.get('private_network')
    if pn:
        print(ep.get('ip', ''), ep.get('port', 5432))
        break
else:
    sys.exit(1)
" 2>/dev/null || echo "")"

  if [[ -z "$ip" ]]; then
    echo "No private-network endpoint found on instance $instance_id." >&2
    echo "Do not use a public DATABASE_URL. Fix PN attachment before deploying." >&2
    return 1
  fi

  write_state DB_PRIVATE_HOST "$ip"
  write_state DB_PRIVATE_PORT "${port:-5432}"
  echo
  echo "Private endpoint only: ${ip}:${port:-5432}"
  echo "Build Secret Manager database-url from the private endpoint:"
  echo "  scw rdb user get-url instance-id=$instance_id user-name=$DB_USER db=$DB_DATABASE region=$REGION"
  echo "Verify the returned host matches ${ip} before storing the secret."
}

print_next_steps() {
  cat <<EOF

--- Next steps ---

State saved in: $STATE_FILE

1. Registry: rg.${REGION}.scw.cloud/${REGISTRY_NAME}

2. Secret Manager (sensitive only — not CORS):
   - database-url
   - service-token-secret
   - anthropic-api-key, openai-api-key
   - hubspot-api-token, monday-api-token
   - google-drive-service-account-json

3. Static env var on container (not a secret):
   - CORS_ALLOWED_ORIGINS=https://society.tomcat.eu

4. From a machine on the Private Network (or Scaleway console SQL), enable pgvector:
   CREATE EXTENSION IF NOT EXISTS vector;

5. Build, push, deploy:
   ./scripts/scaleway/build-push.sh
   CORS_ALLOWED_ORIGINS=https://society.tomcat.eu IMAGE=... ./scripts/scaleway/deploy-container.sh

EOF
}

require_scw
ensure_registry
ensure_private_network
ensure_container_namespace
ensure_database
print_next_steps
