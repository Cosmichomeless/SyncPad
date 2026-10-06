#!/bin/sh
# Runs a PostgreSQL client tool from a container, so nothing needs installing locally. The image
# matches the SERVER's major version (pg_dump refuses an older one and a newer one writes settings
# an older server rejects); set PG_IMAGE to skip the lookup. Used by backup.sh and restore.sh.
#   sh scripts/pg.sh pg_dump|psql DATABASE_URL [tool arguments…]
set -eu

tool=$1
url=$2
shift 2

# The tool runs inside a container: the host's loopback is host.docker.internal from there.
case "$url" in
  *@127.0.0.1[:/]*|*@localhost[:/]*)
    url=$(printf '%s' "$url" | sed -e 's#@127\.0\.0\.1#@host.docker.internal#' -e 's#@localhost#@host.docker.internal#') ;;
esac

in_container() {
  image=$1; shift
  docker run --rm -i --add-host=host.docker.internal:host-gateway \
    -e PGCONNECT_TIMEOUT=15 -e "PGURL=$url" "$image" \
    sh -c 'tool=$1; shift; exec "$tool" "$@" "$PGURL"' sh "$@"
}

if [ -z "${PG_IMAGE:-}" ]; then
  # The newest psql can talk to any server; ask it which major version to use.
  number=$(in_container postgres:alpine psql -X -A -t -c 'SHOW server_version_num' </dev/null)  # not stdin: restore pipes a dump through here
  PG_IMAGE="postgres:$((number / 10000))-alpine"
fi

in_container "$PG_IMAGE" "$tool" "$@"
