#!/bin/bash
# Start TRIPSPHERE locally on Cloudflare workerd (Wrangler needs Node.js, not Bun).
set -euo pipefail
cd "$(dirname "$0")/.."

if command -v node >/dev/null 2>&1; then
  NODE="node"
elif [ -x ".tools/node/bin/node" ]; then
  NODE=".tools/node/bin/node"
else
  echo "Node.js 20+ is required to run Wrangler. Install it from https://nodejs.org or place a copy in .tools/node."
  exit 1
fi

if [ ! -f "dist/index.html" ] || [ ! -f "dist-worker/index.js" ]; then
  echo "Build output missing. Run: ./scripts/build.sh"
  exit 1
fi

exec "$NODE" node_modules/wrangler/bin/wrangler.js dev --port "${PORT:-8787}" --ip 127.0.0.1
