#!/bin/bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PROJECT_ROOT=$(dirname "$SCRIPT_DIR")
cd "$PROJECT_ROOT"

VAULT_CONTAINER="vault"
ROLE_NAME="backend-role"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# อ่าน token จาก ~/.vault-token ที่ vault login เก็บไว้
VAULT_DEPLOY_TOKEN=$(cat ~/.vault-token 2>/dev/null || echo "")

if [ -z "$VAULT_DEPLOY_TOKEN" ]; then
  echo -e "${RED}[ERROR] Not logged in to Vault${NC}"
  echo "        Run: vault login -method=github token=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>"
  exit 1
fi

# ตรวจ token ยังใช้ได้อยู่ไหม
echo -e "${YELLOW}[*] Verifying token...${NC}"
docker exec \
  -e VAULT_ADDR=http://127.0.0.1:8200 \
  -e VAULT_TOKEN="$VAULT_DEPLOY_TOKEN" \
  "$VAULT_CONTAINER" \
  vault token lookup > /dev/null 2>&1 || {
    echo -e "${RED}[ERROR] Token expired${NC}"
    echo "        Run: vault login -method=github token=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"
    exit 1
  }

echo -e "${YELLOW}[*] Fetching Role ID...${NC}"
VAULT_ROLE_ID=$(docker exec \
  -e VAULT_ADDR=http://127.0.0.1:8200 \
  -e VAULT_TOKEN="$VAULT_DEPLOY_TOKEN" \
  "$VAULT_CONTAINER" \
  vault read -field=role_id auth/approle/role/${ROLE_NAME}/role-id)

echo -e "${YELLOW}[*] Generating one-shot Secret ID...${NC}"
VAULT_SECRET_ID=$(docker exec \
  -e VAULT_ADDR=http://127.0.0.1:8200 \
  -e VAULT_TOKEN="$VAULT_DEPLOY_TOKEN" \
  "$VAULT_CONTAINER" \
  vault write -field=secret_id -f auth/approle/role/${ROLE_NAME}/secret-id)

if [ -z "$VAULT_ROLE_ID" ] || [ -z "$VAULT_SECRET_ID" ]; then
  echo -e "${RED}[ERROR] Failed to fetch credentials${NC}"
  exit 1
fi

echo -e "${YELLOW}[*] Starting vault-agent...${NC}"
VAULT_ROLE_ID="$VAULT_ROLE_ID" \
VAULT_SECRET_ID="$VAULT_SECRET_ID" \
docker-compose -f docker-compose-vault.yml up -d --force-recreate vault-agent

unset VAULT_ROLE_ID
unset VAULT_SECRET_ID
unset VAULT_DEPLOY_TOKEN

echo -e "${GREEN}[*] Done — credentials cleared from shell${NC}"
echo "[*] Check logs: docker logs vault-agent -f"