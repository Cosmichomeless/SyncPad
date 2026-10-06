#!/bin/sh
# Local multi-client smoke test: brings the stack up, then checks that two clients sync a note.
#
#   sh scripts/smoke.sh                      PostgreSQL (Compose) + migrations + backend + journey
#   SMOKE_API_URL=http://host:port sh ...    journey only, against a stack that is already running
#
# Variables (all optional):
#   DATABASE_URL   use this PostgreSQL and do not touch Compose (default: .env, else the Compose one)
#   SMOKE_PORT     port for the backend this script starts (default 3101, kept apart from `npm run dev`)
#   SMOKE_ORIGIN   CORS origin the backend allows and the clients send (default http://127.0.0.1:3000)
set -eu

if [ -z "${SMOKE_API_URL:-}" ]; then
  if [ -z "${DATABASE_URL:-}" ]; then
    if [ -f .env ]; then
      set -a
      . ./.env
      set +a
    fi
    DATABASE_URL="${DATABASE_URL:-postgres://syncpad:syncpad@127.0.0.1:5432/syncpad}"
    docker compose up -d --wait postgres
  fi
  SMOKE_PORT="${SMOKE_PORT:-3101}"
  SMOKE_ORIGIN="${SMOKE_ORIGIN:-http://127.0.0.1:3000}"
  SMOKE_API_URL="http://127.0.0.1:${SMOKE_PORT}"
  export DATABASE_URL SMOKE_ORIGIN SMOKE_API_URL

  npm --prefix backend run migrate

  backend_log="$(mktemp)"
  (
    cd backend
    HOST=127.0.0.1 PORT="$SMOKE_PORT" CORS_ORIGIN="$SMOKE_ORIGIN" COOKIE_SECURE=false \
      exec ./node_modules/.bin/tsx src/index.ts
  ) >"$backend_log" 2>&1 &
  backend_pid=$!
  trap 'kill "$backend_pid" 2>/dev/null || true; wait "$backend_pid" 2>/dev/null || true; rm -f "$backend_log"' EXIT INT TERM
fi

status=0
npm --prefix backend run smoke:journey || status=$?
if [ "$status" -ne 0 ] && [ -n "${backend_log:-}" ]; then
  printf '%s\n' '--- backend log (last 40 lines) ---' >&2
  tail -n 40 "$backend_log" >&2
fi
exit "$status"
