#!/bin/sh
set -e

# รับจาก env var ที่ inject มาตอน docker-compose up
ROLE_ID="${VAULT_ROLE_ID}"
SECRET_ID="${VAULT_SECRET_ID}"

# ตรวจสอบว่ามีค่าจริง
if [ -z "$ROLE_ID" ] || [ -z "$SECRET_ID" ]; then
  echo "[ERROR] VAULT_ROLE_ID or VAULT_SECRET_ID is not set!"
  exit 1
fi

echo "[*] Writing ephemeral credentials to tmpfs..."

# เขียนลง RAM (/tmp = tmpfs ใน container) ไม่แตะ disk
mkdir -p /tmp/vault-auth
echo "$ROLE_ID"   > /tmp/vault-auth/role_id
echo "$SECRET_ID" > /tmp/vault-auth/secret_id
chmod 600 /tmp/vault-auth/role_id
chmod 600 /tmp/vault-auth/secret_id

# ล้าง env var ออกจาก process นี้ก่อนส่งต่อ
unset VAULT_ROLE_ID
unset VAULT_SECRET_ID

echo "[*] Credentials written — starting vault agent..."

# exec แทน sh process นี้เลย (ไม่ fork ใหม่)
exec vault agent -config=/vault/config/agent.hcl