#!/usr/bin/env bash
set -euo pipefail

VPS_HOST="${VPS_HOST:-root@70.34.207.138}"
SINCE="${1:-24 hours ago}"

cd "$(dirname "$0")/.."
mkdir -p logs/vps

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="logs/vps/leo-collab-${STAMP}.log"

echo "→ Pulling journalctl logs since '${SINCE}'..."
ssh "${VPS_HOST}" "journalctl -u leo-collab --since '${SINCE}' --no-pager" > "${OUT}"

echo "✓ Saved to ${OUT}"
echo "  tail -f ${OUT}"
