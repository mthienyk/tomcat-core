#!/usr/bin/env bash
# MCP stdio launcher for Cursor / Claude Desktop.
# Self-resolving: works regardless of caller cwd or PATH.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_DIR}"

# Load nvm node if available, otherwise rely on system node.
if [ -s "${HOME}/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "${HOME}/.nvm/nvm.sh" >/dev/null 2>&1
fi

NODE_BIN="$(command -v node || true)"
if [ -z "${NODE_BIN}" ]; then
  echo "mcp-launch: node not found on PATH" >&2
  exit 127
fi

TSX_CLI="${REPO_DIR}/node_modules/tsx/dist/cli.mjs"
if [ ! -f "${TSX_CLI}" ]; then
  echo "mcp-launch: ${TSX_CLI} missing. Run 'npm install' in ${REPO_DIR}." >&2
  exit 127
fi

exec "${NODE_BIN}" "${TSX_CLI}" "${REPO_DIR}/scripts/mcpServer.ts"
