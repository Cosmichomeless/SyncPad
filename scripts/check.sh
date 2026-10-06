#!/bin/sh
set -eu

npm --prefix backend test
npm --prefix backend run lint
npm --prefix backend run typecheck
npm --prefix backend run build
(cd backend && npx tsx --test ../shared/src/*.test.ts)
npm --prefix frontend test
npm --prefix frontend run lint
npm --prefix frontend run typecheck