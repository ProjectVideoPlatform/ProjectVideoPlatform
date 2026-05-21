#!/bin/sh
set -e

ROLE_ID="${VAULT_ROLE_ID}"
SECRET_ID="${VAULT_SECRET_ID}"

if [ -z "$ROLE_ID" ] || [ -z "$SECRET_ID" ]; then
  echo "[ERROR] VAULT_ROLE_ID or VAULT_SECRET_ID is not set!"
  exit 1
fi

echo "[*] Writing ephemeral credentials to tmpfs..."
mkdir -p /tmp/vault-auth
printf '%s' "$ROLE_ID"   > /tmp/vault-auth/role_id
printf '%s' "$SECRET_ID" > /tmp/vault-auth/secret_id
chmod 600 /tmp/vault-auth/role_id /tmp/vault-auth/secret_id

unset VAULT_ROLE_ID VAULT_SECRET_ID

echo "[*] Credentials written — starting vault agent..."
exec vault agent -config=/vault/config/agent.hcl