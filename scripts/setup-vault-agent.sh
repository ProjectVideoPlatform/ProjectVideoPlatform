#!/bin/bash
set -e # 🧙 คาถาเด็ด: บรรทัดไหนพังให้หยุดทำงานทันที ไม่หลอกตาว่า Ready!

VAULT_ADDR="http://127.0.0.1:8200"
VAULT_TOKEN="root"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}==================================================${NC}"
echo -e "${BLUE}  Vault Cluster Setup: MongoDB Dynamic + AppRole   ${NC}"
echo -e "${BLUE}==================================================${NC}\n"

# -------------------------------------------------------------
# PHASE 1: MONGODB ENGINE & ROLES
# -------------------------------------------------------------
echo -e "${YELLOW}[PHASE 1] Configuring MongoDB Database Engine...${NC}"

# สเต็ป 1: เปิดใช้งาน Database Secrets Engine
docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault \
  vault secrets enable database 2>/dev/null || echo "-> Database engine already enabled"

# สเต็ป 2: เชื่อมต่อเข้า Cluster MongoDB
docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault \
  vault write database/config/mongodb \
    plugin_name=mongodb-database-plugin \
    allowed_roles="backend-role,readonly-role" \
    connection_url="mongodb://{{username}}:{{password}}@mongodb1:27017,mongodb2:27017,mongodb3:27017/admin?replicaSet=rs0&authSource=admin" \
    username="admin" \
    password="adminpassword" \
    root_rotation_statements='{"db":"admin"}'

# สเต็ป 3: สร้าง Role สำหรับแอป (ดึงรหัสผ่านแอปสิทธิ์เขียนอ่าน)
docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault \
  vault write database/roles/backend-role \
    db_name=mongodb \
    creation_statements='{"db":"admin","roles":[{"role":"readWrite","db":"secure-video"}]}' \
    revocation_statements='{"db":"admin"}' \
    default_ttl="1h" \
    max_ttl="24h"

echo -e "${GREEN}✅ Phase 1: Database Engine Ready\n${NC}"

# -------------------------------------------------------------
# PHASE 2: UNIFIED POLICY (รวมนโยบายเป็นหนึ่งเดียว)
# -------------------------------------------------------------
echo -e "${YELLOW}[PHASE 2] Creating Unified Backend Policy...${NC}"

# ยุบรวม Policy เหลือชื่อเดียวคือ "backend-policy" เปิดสิทธิ์ทั้ง Static และ Dynamic ครบถ้วน
docker exec -i vault sh -c 'cat << EOF > /tmp/backend-policy.hcl
# 💾 MongoDB Dynamic Secrets Authorization
path "database/creds/backend-role"  { capabilities = ["read"] }
path "database/creds/readonly-role" { capabilities = ["read"] }

# 🟢 Static Secrets ทั้งหมดของระบบ
path "secret/data/database/mongodb" { capabilities = ["read"] }
path "secret/data/redis/main"        { capabilities = ["read"] }
path "secret/data/aws/main"          { capabilities = ["read"] }
path "secret/data/jwt/main"          { capabilities = ["read"] }
path "secret/data/stripe/production" { capabilities = ["read"] }
path "secret/data/cloudfront/keys"   { capabilities = ["read"] }
path "secret/data/email/gmail"       { capabilities = ["read"] }
path "secret/data/pinecone/main"     { capabilities = ["read"] }
path "secret/data/elasticsearch/backend" { capabilities = ["read"] }
path "secret/metadata/*"             { capabilities = ["list"] }
path "auth/token/renew-self"         { capabilities = ["update"] }
path "auth/token/lookup-self"        { capabilities = ["read"] }
EOF'

docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault \
  vault policy write backend-policy /tmp/backend-policy.hcl

echo -e "${GREEN}✅ Phase 2: Policy Configured (backend-policy)\n${NC}"

# -------------------------------------------------------------
# PHASE 3: APPROLE CONFIGURATION & KEYS EXPORT
# -------------------------------------------------------------
echo -e "${YELLOW}[PHASE 3] Set Up AppRole & Export Keys for Agent...${NC}"

# สเต็ป 1: เปิดระบบ AppRole
docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault \
  vault auth enable approle 2>/dev/null || echo "-> AppRole already enabled"

# สเต็ป 2: สร้างบทบาท AppRole ผูกเข้ากับ backend-policy ที่เราเพิ่งทำเสร็จ
docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault \
  vault write auth/approle/role/backend-role \
    bind_secret_id=true \
    secret_id_ttl=24h \
    secret_id_num_uses=0 \
    token_ttl=1h \
    token_max_ttl=24h \
    policies="backend-policy"

# สเต็ป 3: ดึงกุญแจทอง RoleID และ SecretID ออกมาจากตู้ Vault หลัก
ROLE_ID=$(docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault vault read auth/approle/role/backend-role/role-id | grep -E '^role_id[[:space:]]+' | awk '{print $2}')
SECRET_ID=$(docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault vault write -field=secret_id -f auth/approle/role/backend-role/secret-id)

# สเต็ป 4: ลำเลียงกุญแจไปส่งให้ตู้ vault-agent 
# ⚠️ สังเกตตรงนี้: ตรวจสอบพาร์ทที่ผูกกับ volume ใน docker-compose ให้ตรงกันนะครับ
mkdir -p ./BackEnd/keys
printf '%s' "$ROLE_ID"   > ./BackEnd/keys/role_id
printf '%s' "$SECRET_ID" > ./BackEnd/keys/secret_id
chmod 600 ./BackEnd/keys/role_id ./BackEnd/keys/secret_id

echo -e "${GREEN}✅ Keys dispatched to ./BackEnd/keys/\n${NC}"

# -------------------------------------------------------------
# PHASE 4: THE ULTIMATE MOMENT (สั่งเปลี่ยนรหัส Root และรีสตาร์ทเพื่อเทสผล)
# -------------------------------------------------------------
echo -e "${YELLOW}[PHASE 4] Running Root Rotation & Initializing Agent...${NC}"

echo -e "${RED}⚠️  Executing Rotate Root... (Vault will take over MongoDB master credentials)${NC}"
docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault \
  vault write -f database/rotate-root/mongodb

echo -e "${YELLOW}Restarting vault-agent to deploy the new tokens...${NC}"
docker compose restart vault-agent

# ปล่อยให้ระบบขยับกุญแจและเขียนไฟล์ซักครู่หนึ่ง
sleep 3

echo -e "\n${BLUE}==================================================${NC}"
echo -e "${BLUE}       🎉 SYSTEM DEPLOYMENT COMPLETE 🎉            ${NC}"
echo -e "${BLUE}==================================================${NC}"