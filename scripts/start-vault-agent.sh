#!/bin/bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PROJECT_ROOT=$(dirname "$SCRIPT_DIR")

[ -d "$PROJECT_ROOT" ] || { echo "[ERROR] PROJECT_ROOT not found: $PROJECT_ROOT"; exit 1; }
cd "$PROJECT_ROOT"

# ✅ เปลี่ยนเป็น HTTPS สำหรับ Vault container
VAULT_ADDR="https://127.0.0.1:8200"
VAULT_SKIP_VERIFY="true"  # ข้าม cert check (development only)
VAULT_CONTAINER="vault"
ROLE_NAME="backend-role"

# ✅ ฟังก์ชัน vault_exec ที่สมบูรณ์
vault_exec() {
  docker exec \
    -e VAULT_ADDR="$VAULT_ADDR" \
    -e VAULT_SKIP_VERIFY="$VAULT_SKIP_VERIFY" \
    -e VAULT_TOKEN="${VAULT_TOKEN:-}" \
    "$VAULT_CONTAINER" vault "$@"
}

# -------------------------------------------------------------
# STEP 1: รับ VAULT_TOKEN
# -------------------------------------------------------------
echo "[*] Checking Vault token..."

if [ -z "${VAULT_TOKEN:-}" ]; then
  if [ -f "$HOME/.vault-token" ]; then
    VAULT_TOKEN=$(cat "$HOME/.vault-token")
    echo "[*] Using token from ~/.vault-token"
  else
    echo "[*] No token found."
    echo "    Please login first (choose one):"
    echo ""
    echo "    Option 1 - Login with GitHub PAT:"
    echo "      export GITHUB_PAT=ghp_xxxxx"
    echo "      vault login -method=github token=\$GITHUB_PAT"
    echo ""
    echo "    Option 2 - Paste token from Vault UI:"
    echo "      (User Menu → Copy token)"
    echo ""
    IFS= read -rs -p "Paste Vault token (or press Enter to login with GitHub): " VAULT_TOKEN
    echo ""
    
    # ถ้าไม่ได้ paste token ให้ลอง login ด้วย GitHub
    if [ -z "$VAULT_TOKEN" ]; then
      echo "[*] Please login with GitHub:"
      read -s -p "GitHub PAT: " GITHUB_PAT
      echo ""
      
      LOGIN_OUTPUT=$(docker exec \
        -e VAULT_ADDR="$VAULT_ADDR" \
        -e VAULT_SKIP_VERIFY="$VAULT_SKIP_VERIFY" \
        "$VAULT_CONTAINER" vault login -method=github token="$GITHUB_PAT" 2>&1)
      
      if echo "$LOGIN_OUTPUT" | grep -q "Success!"; then
        VAULT_TOKEN=$(echo "$LOGIN_OUTPUT" | grep -A 1 "^token" | tail -1 | tr -d '[:space:]')
        echo "[*] Login successful, token obtained"
        unset GITHUB_PAT
      else
        echo "[ERROR] GitHub login failed"
        echo "$LOGIN_OUTPUT"
        exit 1
      fi
    fi
  fi
fi

# ตรวจสอบว่าได้ token หรือยัง
if [ -z "${VAULT_TOKEN:-}" ]; then
  echo "[ERROR] No token available"
  exit 1
fi

export VAULT_TOKEN

# -------------------------------------------------------------
# STEP 2: Validate token + ตรวจสอบ GitHub auth
# -------------------------------------------------------------
echo "[*] Validating token..."

TOKEN_JSON=$(vault_exec token lookup -format=json 2>&1) || {
  echo "[ERROR] Invalid or expired token: $TOKEN_JSON"
  echo "        Please login again: vault login -method=github"
  exit 1
}

# ตรวจสอบ metadata (GitHub auth จะมี org)
AUTH_ORG=$(printf '%s' "$TOKEN_JSON" | docker exec -i "$VAULT_CONTAINER" \
  jq -r '.data.meta.org // empty' 2>/dev/null || echo "")

if [ -z "$AUTH_ORG" ]; then
  echo "[WARNING] Token is not from GitHub auth (no org metadata)"
  echo "         Continuing anyway, but this might be a root token"
fi

IDENTITY=$(printf '%s' "$TOKEN_JSON" | docker exec -i "$VAULT_CONTAINER" \
  jq -r '.data.meta.username // .data.display_name // "unknown"' 2>/dev/null || echo "unknown")

echo "[*] Authenticated as: $IDENTITY"

# -------------------------------------------------------------
# STEP 3: ดึง Role ID
# -------------------------------------------------------------
echo "[*] Fetching Role ID for: $ROLE_NAME"
VAULT_ROLE_ID=$(vault_exec read -field=role_id "auth/approle/role/${ROLE_NAME}/role-id" 2>&1) || {
  echo "[ERROR] Failed to fetch Role ID"
  echo "        Check if role exists: vault_exec list auth/approle/role"
  exit 1
}

# -------------------------------------------------------------
# STEP 4: Generate Secret ID
# -------------------------------------------------------------
echo "[*] Generating Secret ID..."
VAULT_SECRET_ID=$(vault_exec write -field=secret_id -f "auth/approle/role/${ROLE_NAME}/secret-id" 2>&1) || {
  echo "[ERROR] Failed to generate Secret ID"
  exit 1
}

if [ -z "$VAULT_ROLE_ID" ] || [ -z "$VAULT_SECRET_ID" ]; then
  echo "[ERROR] Empty Role ID or Secret ID"
  exit 1
fi

echo "[✓] Credentials obtained successfully"

# -------------------------------------------------------------
# STEP 5: ส่ง credentials เข้า vault-agent
# -------------------------------------------------------------
echo "[*] Injecting credentials and starting vault-agent..."

# ตรวจสอบ docker-compose file
if [ ! -f "docker-compose-vault.yml" ]; then
  echo "[ERROR] docker-compose-vault.yml not found"
  exit 1
fi

# ใช้ env variables แทนการส่งผ่าน CLI (ปลอดภัยกว่า)
export VAULT_ROLE_ID
export VAULT_SECRET_ID

docker compose -f docker-compose-vault.yml up -d --force-recreate vault-agent

# Clear sensitive variables
unset VAULT_TOKEN VAULT_ROLE_ID VAULT_SECRET_ID

echo "[✓] Done — vault-agent started"
echo "[✓] Authenticated as: $IDENTITY"
echo ""
echo "Useful commands:"
echo "  View logs: docker compose -f docker-compose-vault.yml logs vault-agent"
echo "  Stop:      docker compose -f docker-compose-vault.yml down"