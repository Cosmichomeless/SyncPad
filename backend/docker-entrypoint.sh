#!/bin/sh
# Container entrypoint: apply pending migrations, then replace this shell with the server
# so Node is PID 1 and receives SIGTERM from `docker stop` directly.
set -eu

if [ "${SYNCPAD_RUN_MIGRATIONS:-true}" = "true" ]; then
  node dist/migrate.js
fi

exec node --conditions=syncpad-built dist/index.js
