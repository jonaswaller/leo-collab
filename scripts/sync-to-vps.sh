#!/usr/bin/env bash
set -euo pipefail

VPS_HOST="${VPS_HOST:-root@70.34.207.138}"
REMOTE_DIR="/root/leo-collab"

cd "$(dirname "$0")/.."

echo "→ Rsyncing to ${VPS_HOST}:${REMOTE_DIR}..."
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude '*.log' \
  --exclude '.DS_Store' \
  --exclude 'logs/' \
  ./ "${VPS_HOST}:${REMOTE_DIR}/"

echo "→ Installing deps, (re)loading systemd, restarting service..."
ssh "${VPS_HOST}" bash -s <<'REMOTE'
set -euo pipefail
cd /root/leo-collab

if ! command -v node >/dev/null 2>&1; then
  echo "  Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

npm ci

cp deploy/leo-collab.service /etc/systemd/system/leo-collab.service
systemctl daemon-reload
systemctl enable leo-collab
systemctl restart leo-collab

sleep 2
systemctl --no-pager status leo-collab | head -n 15
REMOTE

echo ""
echo "✓ Deployed. Tail logs:"
echo "    ssh ${VPS_HOST} journalctl -u leo-collab -f"
