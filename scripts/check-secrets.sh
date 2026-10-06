#!/bin/sh
# Fails when a secret could have reached Git or a container image.
#   sh scripts/check-secrets.sh                 # tracked files
#   sh scripts/check-secrets.sh IMAGE [IMAGE…]  # also each built image (needs Docker)
# Real values live only in the hosting dashboard; the repository carries names and local defaults.
set -eu

cd "$(dirname "$0")/.."
failed=0
fail() { echo "FAIL: $1" >&2; failed=1; }

# 1. No environment file is tracked except the documented templates.
for file in $(git ls-files | grep -E '(^|/)\.env([.-]|$)' | grep -Ev '\.example$' || true); do
  fail "tracked environment file: $file"
done

# 2. No tracked file embeds a credential-looking value. Local defaults (syncpad:syncpad,
#    127.0.0.1, localhost, a compose service name) and placeholders (<...>, ${...}) are allowed.
files=$(git ls-files | grep -Ev '(^|/)(package-lock\.json|.*\.(png|ico|woff2?))$' | grep -Ev '^scripts/check-secrets\.sh$')
urls=$(echo "$files" | xargs grep -nEH 'postgres(ql)?://[^[:space:]:/@]+:[^[:space:]@]+@[^[:space:]/]+' 2>/dev/null \
  | grep -Ev '(@|//)(127\.0\.0\.1|localhost|postgres|db)[:/ ]|:\$\{|:<|@<|@\$\{|syncpad:syncpad@|user:password@|USER:PASSWORD@|usuario:clave@|\$\{POSTGRES_PASSWORD' || true)
[ -z "$urls" ] || fail "a database URL with a password and a remote host:
$urls"
keys=$(echo "$files" | xargs grep -nEH -e '-----BEGIN [A-Z ]*PRIVATE KEY-----' -e 'ghp_[A-Za-z0-9]{30,}' -e 'AKIA[0-9A-Z]{16}' -e 'npg_[A-Za-z0-9]{10,}' 2>/dev/null || true)
[ -z "$keys" ] || fail "something that looks like a private key or token:
$keys"
tokens=$(echo "$files" | xargs grep -nEH '^[[:space:]]*(METRICS_TOKEN|SESSION_SECRET|POSTGRES_PASSWORD)=[^[:space:]$<]+' 2>/dev/null \
  | grep -Ev 'POSTGRES_PASSWORD=syncpad$|check-secrets' || true)
[ -z "$tokens" ] || fail "a secret variable with a literal value:
$tokens"

# 3. Images carry no environment file and no baked-in credentials.
for image in "$@"; do
  baked=$(docker image inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$image" \
    | grep -E '^(DATABASE_URL|METRICS_TOKEN|POSTGRES_PASSWORD)=.+' || true)
  [ -z "$baked" ] || fail "$image bakes secrets into ENV (names only shown): $(echo "$baked" | cut -d= -f1 | tr '\n' ' ')"
  files_in_image=$(docker run --rm --entrypoint sh "$image" -c 'find /app -name ".env*" -not -path "*/node_modules/*" 2>/dev/null' || true)
  [ -z "$files_in_image" ] || fail "$image contains environment files: $files_in_image"
  history=$(docker history --no-trunc --format '{{.CreatedBy}}' "$image" | grep -E 'postgres(ql)?://[^ ]+:[^ ]+@' || true)
  [ -z "$history" ] || fail "$image layer history mentions a credentialed database URL"
done

[ "$failed" = 0 ] && echo "ok: no secrets found in tracked files${1:+ or images}"
exit "$failed"
