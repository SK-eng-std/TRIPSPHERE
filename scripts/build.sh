#!/bin/bash
# Build the React client and bundle the Worker API.
set -euo pipefail
cd "$(dirname "$0")/.."

if command -v node >/dev/null 2>&1; then
  NODE="node"
elif [ -x ".tools/node/bin/node" ]; then
  NODE=".tools/node/bin/node"
else
  echo "Node.js 20+ is required."
  exit 1
fi

"$NODE" node_modules/vite/bin/vite.js build
"$NODE" scripts/build-worker.mjs
