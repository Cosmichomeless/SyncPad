#!/bin/sh
set -eu

if [ ! -f .env ]; then
  printf '%s\n' 'Missing .env. Copy .env.example to .env first.' >&2
  exit 1
fi

set -a
. ./.env
set +a

docker compose up -d --wait postgres
npm --prefix backend run migrate
exec npm --prefix backend run dev