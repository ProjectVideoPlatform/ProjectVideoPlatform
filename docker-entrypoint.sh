#!/bin/sh
set -e

echo "🚀 Starting server..."

# ===== Load Vault Secrets =====
VAULT_SECRETS_FILE="/vault/secrets/app.env"

if [ -f "$VAULT_SECRETS_FILE" ]; then
  WAIT=0
  until [ -s "$VAULT_SECRETS_FILE" ]; do
    if [ $WAIT -ge 60 ]; then
      echo "❌ Timeout: Vault secrets not ready"
      exit 1
    fi
    echo "⏳ Waiting for Vault secrets... ($WAIT s)"
    sleep 2
    WAIT=$((WAIT + 2))
  done
  echo "✅ Loaded secrets from Vault"
  set -a
  . "$VAULT_SECRETS_FILE"
  set +a
else
  echo "⚠️  No Vault secrets, using environment fallback"
fi

echo "🎯 Starting Node.js server..."
exec "$@"