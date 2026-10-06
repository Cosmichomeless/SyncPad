#!/bin/sh
# Replays a backup.sh file into an EMPTY database (a new Neon branch or database, or a local one).
#   DATABASE_URL=postgres://… sh scripts/restore.sh backups/syncpad-….sql
# It refuses a database that already has the `syncpad` schema: restoring over live data would
# mix two histories. Create a fresh database, restore, check, then point the service at it.
set -eu

cd "$(dirname "$0")/.."
: "${DATABASE_URL:?DATABASE_URL is required}"
file=${1:?usage: restore.sh <backup-file>}
[ -s "$file" ] || { echo "no such backup: $file" >&2; exit 1; }

present=$(sh scripts/pg.sh psql "$DATABASE_URL" -X -A -t -c "SELECT to_regnamespace('syncpad') IS NOT NULL")
[ "$present" = f ] || { echo "refusing: the target already has a syncpad schema" >&2; exit 1; }

# The dump names `public` (it holds the migration ledger) and so tries to create it; it exists already.
grep -v '^CREATE SCHEMA public;$' "$file" \
  | sh scripts/pg.sh psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 --single-transaction >/dev/null
echo "restored $file"
sh scripts/pg.sh psql "$DATABASE_URL" -X -A -t -c \
  "SELECT (SELECT count(*) FROM syncpad.notes) || ' notes, ' || (SELECT count(*) FROM syncpad.note_updates) || ' updates, ' || (SELECT count(*) FROM syncpad.note_snapshots) || ' snapshots'"
