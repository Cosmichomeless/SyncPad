#!/bin/sh
# Logical backup of every note, account and update: the `syncpad` schema plus the migration ledger
# (`public.schema_migrations`), as plain SQL that restore.sh replays into an empty database.
#   DATABASE_URL=postgres://… sh scripts/backup.sh [output-file]
# The file holds personal data and password hashes: keep it out of Git and out of images
# (backups/ is ignored). Run before any deploy that migrates, and weekly while the demo is up.
set -eu

cd "$(dirname "$0")/.."
: "${DATABASE_URL:?DATABASE_URL is required}"
mkdir -p backups
output=${1:-backups/syncpad-$(date -u +%Y%m%dT%H%M%SZ).sql}

umask 077
sh scripts/pg.sh pg_dump "$DATABASE_URL" --no-owner --no-privileges --schema=syncpad --schema=public > "$output.partial"
# A dump that does not end with the completion marker was cut short and must not be trusted.
tail -n 5 "$output.partial" | grep -q 'PostgreSQL database dump complete' || { rm -f "$output.partial"; echo "backup incomplete" >&2; exit 1; }
mv "$output.partial" "$output"
echo "backup written to $output ($(wc -c < "$output" | tr -d ' ') bytes)"
