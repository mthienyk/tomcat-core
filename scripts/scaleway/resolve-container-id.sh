#!/usr/bin/env bash
# Resolve Scaleway Serverless Container ID by namespace + container name.
# Used by GitHub Actions deploy and local troubleshooting.
set -euo pipefail

REGION="${SCW_DEFAULT_REGION:-fr-par}"
NAMESPACE="${CONTAINER_NAMESPACE:-tomcat-core}"
NAME="${CONTAINER_NAME:-api}"
FALLBACK_ID="${SCW_CONTAINER_ID:-}"

require_scw() {
  if ! command -v scw >/dev/null 2>&1; then
    echo "scw CLI not found. Run scripts/scaleway/init-cli.sh first." >&2
    exit 1
  fi
}

resolve_by_name() {
  local ns_id container_id
  ns_id="$(scw container namespace list "region=${REGION}" -o json \
    | python3 -c "import json,sys; ns=[n for n in json.load(sys.stdin) if n.get('name')=='${NAMESPACE}']; print(ns[0]['id'] if ns else '')")"
  if [[ -z "$ns_id" ]]; then
    echo "Namespace ${NAMESPACE} not found in region ${REGION}." >&2
    return 1
  fi

  container_id="$(scw container container list "namespace-id=${ns_id}" "region=${REGION}" -o json \
    | python3 -c "import json,sys; cs=[c for c in json.load(sys.stdin) if c.get('name')=='${NAME}']; print(cs[0]['id'] if cs else '')")"
  if [[ -n "$container_id" ]]; then
    echo "$container_id"
    return 0
  fi
  return 1
}

main() {
  require_scw

  if resolve_by_name; then
    return 0
  fi

  if [[ -n "$FALLBACK_ID" ]]; then
    echo "Container ${NAME} not found; falling back to SCW_CONTAINER_ID." >&2
    echo "$FALLBACK_ID"
    return 0
  fi

  echo "Container ${NAME} not found in namespace ${NAMESPACE}." >&2
  exit 1
}

main "$@"
