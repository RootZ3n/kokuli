#!/usr/bin/env bash
set -euo pipefail

cd /hogwarts/AI/krakzen
export NODE_ENV=production

if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

exec npm run web
