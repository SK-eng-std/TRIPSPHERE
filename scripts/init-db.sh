#!/bin/bash
# Create the local D1 schema and load the reference dataset.
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

W=("$NODE" node_modules/wrangler/bin/wrangler.js)

"${W[@]}" d1 execute tripsphere-db --local --file=db/schema.sql
for file in db/seed-1-destinations.sql db/seed-2-attractions.sql db/seed-3-attractions-2.sql db/seed-4-hotels.sql db/seed-5-restaurants.sql db/seed-6-guides.sql; do
  "${W[@]}" d1 execute tripsphere-db --local --file="$file"
done
echo "Local D1 database ready."
