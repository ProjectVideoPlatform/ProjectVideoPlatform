#!/bin/bash

# ===== VAULT PUT SECRETS SCRIPT =====

VAULT_ADDR="http://127.0.0.1:8200"
VAULT_TOKEN="root"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}Vault Put Secrets${NC}"
echo -e "${BLUE}================================${NC}\n"

# Enable KV v2
echo -e "${YELLOW}Enable KV v2 secrets engine...${NC}"
docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault \
  vault secrets enable -path=secret kv-v2 2>/dev/null || echo "KV already enabled"
echo -e "${GREEN}✅ KV v2 ready\n${NC}"

# ─────────────────────────────────────────
# 1. MongoDB
# ─────────────────────────────────────────
echo -e "${YELLOW}Putting MongoDB secrets...${NC}"
docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault \
  vault kv put secret/database/mongodb \
    MONGO_URI="mongodb://mongodb1:27017,mongodb2:27017,mongodb3:27017/secure-video?replicaSet=rs0" \
    MONGO_REPLICA_SET="rs0" \
    MONGO_DB="secure-video"
echo -e "${GREEN}✅ MongoDB secrets stored\n${NC}"

# ─────────────────────────────────────────
# 2. Redis
# ─────────────────────────────────────────
echo -e "${YELLOW}Putting Redis secrets...${NC}"
docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault \
  vault kv put secret/redis/main \
    REDIS_URL="redis://:redispassword123@redis:6379" \
    REDIS_HOST="redis" \
    REDIS_PORT="6379" \
    REDIS_PASSWORD="redispassword123"
echo -e "${GREEN}✅ Redis secrets stored\n${NC}"

# ─────────────────────────────────────────
# 3. AWS
# ─────────────────────────────────────────
echo -e "${YELLOW}Putting AWS secrets...${NC}"
docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault \
  vault kv put secret/aws/main \
    AWS_ACCESS_KEY_ID="AKIA2YICAB367PRDE4VV" \
    AWS_SECRET_ACCESS_KEY="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" \
    AWS_REGION="ap-southeast-1" \
    MEDIACONVERT_ROLE="arn:aws:iam::739275443965:role/MediaConvertRole" \
    MEDIACONVERT_QUEUE_ARN="arn:aws:mediaconvert:us-east-1:739275443965:queues/Default"
echo -e "${GREEN}✅ AWS secrets stored\n${NC}"

# ─────────────────────────────────────────
# 4. JWT
# ─────────────────────────────────────────
echo -e "${YELLOW}Putting JWT secrets...${NC}"
docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault \
  vault kv put secret/jwt/main \
    JWT_SECRET="your_jwt_secret_key" \
    JWT_REFRESH_SECRET="your_jwt_refresh_secret_key"
echo -e "${GREEN}✅ JWT secrets stored\n${NC}"

# ─────────────────────────────────────────
# 5. Stripe
# ─────────────────────────────────────────
echo -e "${YELLOW}Putting Stripe secrets...${NC}"
docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault \
  vault kv put secret/stripe/production \
    STRIPE_SECRET_KEY="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" \
    STRIPE_WEBHOOK_SECRET="whsec_Vwtt36ITWVrVbvaUuYnhzg6KfzLhWzy6"
echo -e "${GREEN}✅ Stripe secrets stored\n${NC}"

# ─────────────────────────────────────────
# 6. CloudFront
# ─────────────────────────────────────────
echo -e "${YELLOW}Putting CloudFront secrets...${NC}"

# copy key file เข้า container แล้วใช้ @ อ่านไฟล์
docker cp ./BackEnd/keys/cloudfront-private-key.pem vault:/tmp/cloudfront.pem

docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault \
  sh -c 'vault kv put secret/cloudfront/keys \
    CLOUDFRONT_KEY_PAIR_ID="KM18YXD93MX5V" \
    CLOUDFRONT_PRIVATE_KEY="$(cat /tmp/cloudfront.pem)"'

docker exec vault rm /tmp/cloudfront.pem
echo -e "${GREEN}✅ CloudFront secrets stored\n${NC}"

# ─────────────────────────────────────────
# 7. Email
# ─────────────────────────────────────────
echo -e "${YELLOW}Putting Email secrets...${NC}"
docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault \
  vault kv put secret/email/gmail \
    EMAIL_USER="ttpho5874@gmail.com" \
    EMAIL_APP_PASSWORD="ncgg hshk uugh kvcu"
echo -e "${GREEN}✅ Email secrets stored\n${NC}"

# ─────────────────────────────────────────
# 8. Pinecone
# ─────────────────────────────────────────
echo -e "${YELLOW}Putting Pinecone secrets...${NC}"
docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault \
  vault kv put secret/pinecone/main \
    PINECONE_API_KEY="pcsk_hXfG6_G1g4A4Qfke8LyjeVVjMs3jvqskJW2XiUPVSevjkKLCD9gWSqyj8Dc7reVQaDzQX" \
    PINECONE_ENVIRONMENT="gcp-starter"
echo -e "${GREEN}✅ Pinecone secrets stored\n${NC}"

# ─────────────────────────────────────────
# 9. Elasticsearch
# ─────────────────────────────────────────
echo -e "${YELLOW}Putting Elasticsearch secrets...${NC}"
docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault \
  vault kv put secret/elasticsearch/backend \
    ELASTICSEARCH_URL="http://elasticsearch:9200" \
    ELASTIC_PASSWORD="changeme" \
    ELASTIC_CLOUD_ID="besstty:YXAtc291dGhlYXN0LTEuYXdzLmZvdW5kLmlvOjQ0MyQ1Y2U4MzcwN2ZkNGQ0YmMwYmYxODYzNTcyYTI5ZTNmOCQzZjM3ZjMwYzEzMWQ0ZTM4YWM2YjAxYjIyOTM3NDNkMw==" \
    ELASTICSEARCH_API_KEY="RWE4MlBwNEJ0aC1CZjZTazh2RnA6bnBCWTJMb1pFbkRYaVVua1VMUzJEZw==" \
    ELASTIC_APM_SERVER_URL="https://b329e4682f5a4731bb28e4719291303e.apm.ap-southeast-1.aws.cloud.es.io:443" \
    ELASTIC_APM_SECRET_TOKEN="daKOcKJAjufYfSQLz2" \
    SECRET_TOKEN="HlHQQB8tIWZjl472"
echo -e "${GREEN}✅ Elasticsearch secrets stored\n${NC}"

# ─────────────────────────────────────────
# Policy update — เพิ่ม paths ที่เพิ่งสร้าง
# ─────────────────────────────────────────
echo -e "${YELLOW}Updating backend policy...${NC}"
docker exec -i vault sh -c "cat << 'EOF' > /tmp/backend-policy.hcl
path \"secret/data/database/mongodb\"      { capabilities = [\"read\"] }
path \"secret/data/redis/main\"            { capabilities = [\"read\"] }
path \"secret/data/aws/main\"              { capabilities = [\"read\"] }
path \"secret/data/jwt/main\"              { capabilities = [\"read\"] }
path \"secret/data/stripe/production\"     { capabilities = [\"read\"] }
path \"secret/data/cloudfront/keys\"       { capabilities = [\"read\"] }
path \"secret/data/email/gmail\"           { capabilities = [\"read\"] }
path \"secret/data/pinecone/main\"         { capabilities = [\"read\"] }
path \"secret/data/elasticsearch/backend\" { capabilities = [\"read\"] }
path \"secret/metadata/*\"                 { capabilities = [\"list\"] }
path \"auth/token/renew-self\"             { capabilities = [\"update\"] }
path \"auth/token/lookup-self\"            { capabilities = [\"read\"] }
EOF"

docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault \
  vault policy write backend /tmp/backend-policy.hcl
echo -e "${GREEN}✅ Policy updated\n${NC}"

# ─────────────────────────────────────────
# Verify
# ─────────────────────────────────────────
echo -e "${BLUE}================================${NC}"
echo -e "${YELLOW}Verifying stored secrets...${NC}"
for path in database/mongodb redis/main aws/main jwt/main stripe/production cloudfront/keys email/gmail pinecone/main elasticsearch/backend; do
  RESULT=$(docker exec -e VAULT_ADDR="$VAULT_ADDR" -e VAULT_TOKEN="$VAULT_TOKEN" vault \
    vault kv get -format=json secret/$path 2>/dev/null | grep -c "data")
  if [ "$RESULT" -gt 0 ]; then
    echo -e "${GREEN}✅ secret/$path${NC}"
  else
    echo -e "${RED}❌ secret/$path — ไม่พบข้อมูล${NC}"
  fi
done

echo -e "\n${BLUE}Done! ตอนนี้ Vault มี secrets พร้อมให้ Vault Agent ดึงแล้ว${NC}"