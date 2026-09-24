#!/usr/bin/env bash
# Run on the Oracle VM inside infra/oracle-vm/ to deploy the latest code.
set -euo pipefail

cd "$(dirname "$0")"

git -C ../.. pull --ff-only
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d

# Run pending Alembic migrations against the now-running Postgres container.
docker compose -f docker-compose.prod.yml exec -T api alembic upgrade head

docker compose -f docker-compose.prod.yml ps
