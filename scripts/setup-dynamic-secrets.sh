#!/bin/bash

VAULT_ADDR="http://127.0.0.1:8200"
VAULT_TOKEN="root"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}Setup MongoDB Dynamic Secrets${NC}"
echo -e "${BLUE}================================${NC}\n"

# 1. Enable database secrets engine
echo -e "${YELLOW}Step 1: Enable database secrets engine${NC}"
docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault \
  vault secrets enable database 2>/dev/null || echo "database engine already enabled"
echo -e "${GREEN}✅ Database engine ready\n${NC}"

# 2. Configure MongoDB connection
echo -e "${YELLOW}Step 2: Configure MongoDB connection${NC}"
docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault \
  vault write database/config/mongodb \
    plugin_name=mongodb-database-plugin \
    allowed_roles="backend-role,readonly-role" \
    connection_url="mongodb://{{username}}:{{password}}@mongodb1:27017,mongodb2:27017,mongodb3:27017/admin?replicaSet=rs0" \
    username="admin" \
    password="adminpassword"
echo -e "${GREEN}✅ MongoDB connection configured\n${NC}"

# 3. Create backend role (read/write)
echo -e "${YELLOW}Step 3: Create backend-role (read/write, TTL 1h)${NC}"
docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault \
  vault write database/roles/backend-role \
    db_name=mongodb \
    creation_statements='{"db":"secure-video","roles":[{"role":"readWrite"}]}' \
    default_ttl="1h" \
    max_ttl="24h"
echo -e "${GREEN}✅ backend-role created\n${NC}"

# 4. Create readonly role
echo -e "${YELLOW}Step 4: Create readonly-role (TTL 30m)${NC}"
docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault \
  vault write database/roles/readonly-role \
    db_name=mongodb \
    creation_statements='{"db":"secure-video","roles":[{"role":"read"}]}' \
    default_ttl="30m" \
    max_ttl="1h"
echo -e "${GREEN}✅ readonly-role created\n${NC}"

# 5. Update policy ให้ app ขอ dynamic credentials ได้
echo -e "${YELLOW}Step 5: Update backend policy${NC}"
docker exec -i vault sh -c 'cat << EOF > /tmp/backend-policy.hcl
# Static secrets (เดิม)
path "secret/data/redis/main"            { capabilities = ["read"] }
path "secret/data/aws/main"              { capabilities = ["read"] }
path "secret/data/jwt/main"              { capabilities = ["read"] }
path "secret/data/stripe/production"     { capabilities = ["read"] }
path "secret/data/cloudfront/keys"       { capabilities = ["read"] }
path "secret/data/email/gmail"           { capabilities = ["read"] }
path "secret/data/pinecone/main"         { capabilities = ["read"] }
path "secret/data/elasticsearch/backend" { capabilities = ["read"] }
path "secret/metadata/*"                 { capabilities = ["list"] }
path "auth/token/renew-self"             { capabilities = ["update"] }
path "auth/token/lookup-self"            { capabilities = ["read"] }

# Dynamic secrets (ใหม่)
path "database/creds/backend-role"  { capabilities = ["read"] }
path "database/creds/readonly-role" { capabilities = ["read"] }
EOF'

docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault \
  vault policy write backend /tmp/backend-policy.hcl
echo -e "${GREEN}✅ Policy updated\n${NC}"

# 6. Test
echo -e "${YELLOW}Step 6: Test — generate credentials${NC}"
docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault \
  vault read database/creds/backend-role

echo -e "\n${BLUE}================================${NC}"
echo -e "${BLUE}Dynamic Secrets Ready!${NC}"
echo -e "${BLUE}================================${NC}"