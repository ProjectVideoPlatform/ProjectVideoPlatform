#!/bin/bash
set -euo pipefail

# ไปที่ root project เสมอ ไม่ว่าจะรันจากไหน
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PROJECT_ROOT=$(dirname "$SCRIPT_DIR")
cd "$PROJECT_ROOT"

VAULT_CONTAINER="vault"
ROLE_NAME="backend-role"

echo "[*] Fetching Role ID..."
VAULT_ROLE_ID=$(docker exec \
  -e VAULT_ADDR=http://127.0.0.1:8200 \
  -e VAULT_TOKEN=root \
  "$VAULT_CONTAINER" \
  vault read -field=role_id auth/approle/role/${ROLE_NAME}/role-id)

echo "[*] Generating one-shot Secret ID..."
VAULT_SECRET_ID=$(docker exec \
  -e VAULT_ADDR=http://127.0.0.1:8200 \
  -e VAULT_TOKEN=root \
  "$VAULT_CONTAINER" \
  vault write -field=secret_id -f auth/approle/role/${ROLE_NAME}/secret-id)

if [ -z "$VAULT_ROLE_ID" ] || [ -z "$VAULT_SECRET_ID" ]; then
  echo "[ERROR] Failed to fetch credentials from Vault"
  exit 1
fi

echo "[*] Injecting and starting vault-agent..."
VAULT_ROLE_ID="$VAULT_ROLE_ID" \
VAULT_SECRET_ID="$VAULT_SECRET_ID" \
docker-compose -f docker-compose-vault.yml up -d --force-recreate vault-agent

# ล้างออกจาก shell memory
unset VAULT_ROLE_ID
unset VAULT_SECRET_ID

echo "[*] Done — credentials cleared from shell"
echo "[*] Check logs: docker logs vault-agent -f"