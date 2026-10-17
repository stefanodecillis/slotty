#!/usr/bin/env bash
# Source + synthetic test deployments ONLY. Never reads production env or data.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.bun/bin:$PATH"
export SLOTTY_TEST_IMAGE="${SLOTTY_TEST_IMAGE:-slotty:private-admin-origin-candidate}"
export SLOTTY_TEST_ADMIN_PORT="${SLOTTY_TEST_ADMIN_PORT:-33322}"
export SLOTTY_TEST_PUBLIC_PORT="${SLOTTY_TEST_PUBLIC_PORT:-33321}"
export SLOTTY_TEST_ADMIN_ORIGIN="https://localhost:$SLOTTY_TEST_ADMIN_PORT"
export SLOTTY_TEST_PUBLIC_ORIGIN="http://localhost:$SLOTTY_TEST_PUBLIC_PORT"
export SLOTTY_TEST_DATA_DIR="$PWD/.verification/private-admin/data"
export SLOTTY_TEST_CADDYFILE="$PWD/tests/private-admin/Caddyfile"
compose=(docker compose -p "slotty-private-admin-test" -f tests/private-admin/compose.yml)
"${compose[@]}" down --volumes
if [[ "${1:-}" == --build ]]; then
  docker build -f docker/Dockerfile -t "$SLOTTY_TEST_IMAGE" .
fi
mkdir -p "$SLOTTY_TEST_DATA_DIR"
# Synthetic SQLite fixtures: host seed and image UID100 need journal-file access.
chmod 777 "$SLOTTY_TEST_DATA_DIR"
SLOTTY_E2E_PORT="$SLOTTY_TEST_PUBLIC_PORT" SLOTTY_E2E_DATABASE_URL="file:$SLOTTY_TEST_DATA_DIR/slotty.db" bun run tests/e2e/seed.ts
chmod 666 "$SLOTTY_TEST_DATA_DIR/slotty.db"
trap 'if [[ "${SLOTTY_TEST_KEEP:-0}" != 1 ]]; then "${compose[@]}" down --volumes; fi' EXIT
"${compose[@]}" up -d
python3 - "$SLOTTY_TEST_ADMIN_ORIGIN/api/health" <<'PY'
import subprocess, sys, time
for _ in range(60):
    if subprocess.run(['curl', '-skf', '--max-time', '2', sys.argv[1]], capture_output=True).returncode == 0:
        print('Isolated image/proxy health: OK')
        break
    time.sleep(1)
else:
    raise SystemExit('Isolated image/proxy failed health check')
PY
bunx playwright test -c tests/private-admin/playwright.config.ts
