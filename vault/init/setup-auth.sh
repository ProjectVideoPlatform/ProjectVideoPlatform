#!/bin/bash
set -e

VAULT_ADDR="http://127.0.0.1:8200"
VAULT_TOKEN="${VAULT_TOKEN:?ERROR: VAULT_TOKEN not set}"

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

docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault \
  vault secrets enable database 2>/dev/null || echo "-> Database engine already enabled"

docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault \
  vault write database/config/mongodb \
    plugin_name=mongodb-database-plugin \
    allowed_roles="backend-role,readonly-role" \
    connection_url="mongodb://{{username}}:{{password}}@mongodb1:27017,mongodb2:27017,mongodb3:27017/admin?replicaSet=rs0&authSource=admin" \
    username="admin" \
    password="adminpassword" \
    root_rotation_statements='{"db":"admin"}'

docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault \
  vault write database/roles/backend-role \
    db_name=mongodb \
    creation_statements='{"db":"admin","roles":[{"role":"readWrite","db":"secure-video"}]}' \
    revocation_statements='{"db":"admin"}' \
    default_ttl="1h" \
    max_ttl="24h"

echo -e "${GREEN}✅ Phase 1: Database Engine Ready\n${NC}"

# -------------------------------------------------------------
# PHASE 2: UNIFIED POLICY
# -------------------------------------------------------------
echo -e "${YELLOW}[PHASE 2] Creating Unified Backend Policy...${NC}"

docker exec -i vault sh -c 'cat << EOF > /tmp/backend-policy.hcl
path "database/creds/backend-role"       { capabilities = ["read"] }
path "database/creds/readonly-role"      { capabilities = ["read"] }
path "secret/data/database/mongodb"      { capabilities = ["read"] }
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
EOF'

docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault \
  vault policy write backend-policy /tmp/backend-policy.hcl

echo -e "${GREEN}✅ Phase 2: Policy Configured\n${NC}"

# -------------------------------------------------------------
# PHASE 3: APPROLE + GITHUB AUTH
# -------------------------------------------------------------
echo -e "${YELLOW}[PHASE 3] Configuring AppRole & GitHub Auth...${NC}"

docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault \
  vault auth enable approle 2>/dev/null || echo "-> AppRole already enabled"

docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault \
  vault auth enable github 2>/dev/null || echo "-> GitHub already enabled"

# AppRole: secret_id_num_uses=1 ใช้ครั้งเดียวทิ้ง
docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault \
  vault write auth/approle/role/backend-role \
    bind_secret_id=true \
    secret_id_ttl=5m \
    secret_id_num_uses=1 \
    token_ttl=1h \
    token_max_ttl=24h \
    policies="backend-policy"

# GitHub org + developer policy
docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault \
  vault write auth/github/config organization=ProjectVideoPlatform

docker exec -i vault sh -c 'cat << EOF > /tmp/developer-policy.hcl
# generate secret-id เพื่อ start vault-agent เท่านั้น
path "auth/approle/role/backend-role/secret-id" {
  capabilities = ["update"]
}
path "auth/approle/role/backend-role/role-id" {
  capabilities = ["read"]
}
EOF'

docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault \
  vault policy write developer-policy /tmp/developer-policy.hcl

docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault \
  vault write auth/github/map/teams/backend value=developer-policy

echo -e "${GREEN}✅ Phase 3: AppRole & GitHub Auth Ready\n${NC}"

# -------------------------------------------------------------
# PHASE 4: ROTATE ROOT
# -------------------------------------------------------------
echo -e "${YELLOW}[PHASE 4] Rotating MongoDB Root Credentials...${NC}"

echo -e "${RED}⚠️  Executing Rotate Root...${NC}"
docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault \
  vault write -f database/rotate-root/mongodb

echo -e "${GREEN}✅ Phase 4: Root Rotated\n${NC}"

echo -e "${BLUE}==================================================${NC}"
echo -e "${BLUE}       ✅ SETUP COMPLETE                           ${NC}"
echo -e "${BLUE}==================================================${NC}"
echo ""
echo -e "${YELLOW}Next steps for each developer:${NC}"
echo "  1. vault login -method=github token=<your-github-pat>"
echo "  2. ./scripts/start-vault-agent.sh"