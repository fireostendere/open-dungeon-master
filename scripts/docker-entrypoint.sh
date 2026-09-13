#!/bin/sh
# Credentials belong in the persistent state / runtime environment, never in logs.
set -e
umask 077
mkdir -p /app/data /app/public/uploads /app/public/generated /app/public/generated-audio /app/logs
KEY_FILE=/app/data/.db-key
if [ -z "${DB_ENCRYPTION_KEY:-}" ]; then
  if [ -L "$KEY_FILE" ]; then
    echo 'Refusing a symbolic-link database key file' >&2; exit 1
  fi
  if [ -f "$KEY_FILE" ]; then
    DB_ENCRYPTION_KEY=$(cat "$KEY_FILE")
  else
    DB_ENCRYPTION_KEY=$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")
    printf '%s' "$DB_ENCRYPTION_KEY" > "$KEY_FILE"
    chmod 600 "$KEY_FILE"
    echo 'A database key was generated in /app/data/.db-key. Back up this file securely; its value is not logged.'
  fi
  export DB_ENCRYPTION_KEY
fi
exec "$@"
