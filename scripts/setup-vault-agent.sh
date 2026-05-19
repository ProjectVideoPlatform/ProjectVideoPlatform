#!/bin/bash

# ===== VAULT AppRole SETUP SCRIPT =====

VAULT_ADDR="http://127.0.0.1:8200"
VAULT_TOKEN="root"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}Vault AppRole Setup${NC}"
echo -e "${BLUE}================================${NC}\n"

# 1. Enable AppRole auth method
echo -e "${YELLOW}Step 1: Enable AppRole auth method${NC}"
docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault vault auth enable approle 2>/dev/null || echo "AppRole already enabled"
echo -e "${GREEN}✅ AppRole enabled\n${NC}"

# 2. Create backend policy
echo -e "${YELLOW}Step 2: Create backend policy${NC}"
docker exec -i vault sh -c 'cat << EOF > /tmp/backend-policy.hcl
path "secret/data/database/mongodb" {
  capabilities = ["read"]
}
path "secret/data/redis/main" {
  capabilities = ["read"]
}
path "secret/data/aws/main" {
  capabilities = ["read"]
}
path "secret/data/jwt/main" {
  capabilities = ["read"]
}
path "secret/data/stripe/production" {
  capabilities = ["read"]
}
path "secret/data/cloudfront/keys" {
  capabilities = ["read"]
}
path "secret/data/email/gmail" {
  capabilities = ["read"]
}
path "secret/data/pinecone/main" {
  capabilities = ["read"]
}
path "secret/data/elasticsearch/backend" {
  capabilities = ["read"]
}
path "secret/metadata/*" {
  capabilities = ["list"]
}
path "auth/token/renew-self" {
  capabilities = ["update"]
}
path "auth/token/lookup-self" {
  capabilities = ["read"]
}
EOF'

docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault vault policy write backend /tmp/backend-policy.hcl
echo -e "${GREEN}✅ Backend policy created\n${NC}"

# 3. Create AppRole
echo -e "${YELLOW}Step 3: Create AppRole for backend${NC}"
docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault vault write auth/approle/role/backend \
  bind_secret_id=true \
  secret_id_ttl=24h \
  secret_id_num_uses=0 \
  token_ttl=1h \
  token_max_ttl=24h \
  policies="backend"
echo -e "${GREEN}✅ AppRole created\n${NC}"

# 4. Get RoleID
echo -e "${YELLOW}Step 4: Get RoleID${NC}"
ROLE_ID=$(docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault vault read auth/approle/role/backend/role-id | grep -E '^role_id[[:space:]]+' | awk '{print $2}')
echo -e "${GREEN}Role ID: ${ROLE_ID}\n${NC}"

# 5. Create SecretID
echo -e "${YELLOW}Step 5: Create SecretID${NC}"
SECRET_ID=$(docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault vault write -field=secret_id -f auth/approle/role/backend/secret-id)
echo -e "${GREEN}Secret ID: ${SECRET_ID}\n${NC}"

# 6. Save to files
echo -e "${YELLOW}Step 6: Save credentials to BackEnd/keys/${NC}"
mkdir -p ./BackEnd/keys

printf '%s' "$ROLE_ID"   > ./BackEnd/keys/role_id
printf '%s' "$SECRET_ID" > ./BackEnd/keys/secret_id

chmod 600 ./BackEnd/keys/role_id
chmod 600 ./BackEnd/keys/secret_id

echo -e "${GREEN}✅ Saved to ./BackEnd/keys/role_id${NC}"
echo -e "${GREEN}✅ Saved to ./BackEnd/keys/secret_id\n${NC}"

# Verify files
echo -e "${YELLOW}Verify files:${NC}"
echo "role_id   : $(cat ./BackEnd/keys/role_id)"
echo "secret_id : $(cat ./BackEnd/keys/secret_id)"
echo ""

# 7. Test login
echo -e "${YELLOW}Step 7: Test AppRole login${NC}"
docker exec -e VAULT_ADDR="$VAULT_ADDR" vault vault write auth/approle/login \
  role_id="$ROLE_ID" \
  secret_id="$SECRET_ID" > /tmp/vault_test.json

if grep -q "client_token" /tmp/vault_test.json; then
  echo -e "${GREEN}✅ AppRole login successful\n${NC}"
else
  echo -e "${YELLOW}⚠️  Check login result\n${NC}"
fi

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}Setup Complete!${NC}"
echo -e "${BLUE}================================${NC}"
echo -e "${YELLOW}Next steps:${NC}"
echo "1. ✅ role_id / secret_id ถูกบันทึกที่ ./BackEnd/keys/ แล้ว"
echo "2. รัน: docker compose up vault-agent -d"
echo "3. ตรวจสอบ: docker exec vault-agent cat /vault/secrets/app.env"
echo ""