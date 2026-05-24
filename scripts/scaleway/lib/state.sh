#!/usr/bin/env bash
# Shared helpers for scripts/scaleway/*.sh

read_state() {
  local key="$1"
  local file="${STATE_FILE:-$SCRIPT_DIR/.infra-state.env}"
  if [[ ! -f "$file" ]]; then
    return 0
  fi
  python3 - "$file" "$key" <<'PY'
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

write_state() {
  local key="$1"
  local value="$2"
  local file="${STATE_FILE:-$SCRIPT_DIR/.infra-state.env}"
  touch "$file"
  python3 - "$file" "$key" "$value" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
key = sys.argv[2]
value = sys.argv[3]
lines = path.read_text().splitlines() if path.is_file() else []
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
}

read_env_var() {
  local file="$1"
  local key="$2"
  if [[ ! -f "$file" ]]; then
    return 0
  fi
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

require_scw() {
  if ! scw info >/dev/null 2>&1; then
    echo "Run scripts/scaleway/init-cli.sh first." >&2
    exit 1
  fi
}
