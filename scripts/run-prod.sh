#!/usr/bin/env bash
set -euo pipefail

cd /mnt/ai/Verum
export NODE_ENV=production

if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

exec npm run web
