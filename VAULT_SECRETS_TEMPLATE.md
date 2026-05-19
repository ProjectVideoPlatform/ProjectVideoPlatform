# 🔐 Vault Secrets Template - All Services

## ✅ Store These Secrets in Vault

Run these commands to populate all secrets:

```bash
# ===== DATABASE/MONGODB =====
docker exec vault vault kv put secret/database/mongodb \
  MONGO_URI="mongodb://admin:password@mongodb1:27017,mongodb2:27017,mongodb3:27017/secure-video?replicaSet=rs0&authSource=admin" \
  MONGO_REPLICA_SET="rs0" \
  MONGO_DB="secure-video"

# ===== REDIS =====
docker exec vault vault kv put secret/redis/main \
  REDIS_URL="redis://:redispassword123@redis:6379" \
  REDIS_HOST="redis" \
  REDIS_PORT="6379" \
  REDIS_PASSWORD="redispassword123"

# ===== STRIPE =====
docker exec vault vault kv put secret/stripe/production \
  STRIPE_SECRET_KEY="sk_test_xxxxxxxxxxxxx" \
  STRIPE_WEBHOOK_SECRET="whsec_xxxxxxxxxxxxx"

# ===== ELASTICSEARCH =====
docker exec vault vault kv put secret/elasticsearch/backend \
  ELASTICSEARCH_URL="https://your-elasticsearch:9200" \
  ELASTICSEARCH_API_KEY="base64_encoded_key:here" \
  ELASTIC_CLOUD_ID="your_cloud_id:xxxxx" \
  ELASTIC_PASSWORD="your_elasticsearch_password" \
  ELASTIC_APM_SERVER_URL="http://apm-server:8200" \
  ELASTIC_APM_SECRET_TOKEN="your_apm_token"

# ===== AWS (Optional - if using AWS services) =====
docker exec vault vault kv put secret/aws/production \
  AWS_REGION="ap-southeast-1" \
  AWS_ACCESS_KEY_ID="AKIA..." \
  AWS_SECRET_ACCESS_KEY="xxx..." \
  AWS_UPLOADS_BUCKET="your-uploads-bucket" \
  AWS_HLS_OUTPUT_BUCKET="your-hls-bucket" \
  AWS_MEDIACONVERT_ENDPOINT="https://mediaconvert.us-east-1.amazonaws.com" \
  AWS_MEDIACONVERT_ROLE="arn:aws:iam::account:role/MediaConvertRole" \
  AWS_MEDIACONVERT_QUEUE_ARN="arn:aws:mediaconvert:region:account:queues/Default"

# ===== CLICKHOUSE (Optional - if using ClickHouse) =====
docker exec vault vault kv put secret/clickhouse/main \
  CLICKHOUSE_URL="http://clickhouse:8123" \
  CLICKHOUSE_USER="app_user" \
  CLICKHOUSE_PASSWORD="strong_password" \
  CLICKHOUSE_DB="app_db"
```

---

## 📋 Verify Secrets

```bash
# List all secrets
docker exec vault vault kv list secret

# View a specific secret
docker exec vault vault kv get secret/database/mongodb
docker exec vault vault kv get secret/redis/main
docker exec vault vault kv get secret/stripe/production
docker exec vault vault kv get secret/elasticsearch/backend
```

---

## 🔄 Update .env (Development Only)

For development, you can still use `.env` but these values should match Vault:

```env
# Vault Configuration
VAULT_ADDR=http://localhost:8200
VAULT_ROLE_ID=s.xxxxx
VAULT_SECRET_ID=s.yyyyy

# Non-sensitive defaults (can override Vault)
PORT=3000
NODE_ENV=development
JWT_SECRET=your_jwt_secret
JWT_EXPIRES_IN=1d
CLOUDFRONT_DOMAIN=cdn.toteja.co
CLOUDFRONT_KEY_PAIR_ID=KMXXXXXX
CLOUDFRONT_PRIVATE_KEY_PATH=/app/keys/cloudfront-private-key.pem
```

---

## 📚 Service Configuration Mapping

| Service | Vault Path | Config Helper |
|---------|-----------|---------|
| MongoDB | `secret/database/mongodb` | `vaultService.getMongoConfig()` |
| Redis | `secret/redis/main` | `vaultService.getRedisConfig()` |
| Elasticsearch | `secret/elasticsearch/backend` | `vaultService.getElasticsearchConfig()` |
| Stripe | `secret/stripe/production` | `vaultService.getStripeConfig()` |
| AWS | (Multiple paths) | `vaultService.getAWSConfig()` |
| ClickHouse | `secret/clickhouse/main` | `vaultService.getClickHouseConfig()` |
| JWT | `.env` | `vaultService.getJWTConfig()` |
| CloudFront | `.env` | `vaultService.getCloudfrontConfig()` |

---

## 🚀 Using Vault in Application Code

### Direct Secret Access
```javascript
const vaultService = require('./config/vault');

await vaultService.initialize();

// Direct access
const apiKey = vaultService.get('ELASTICSEARCH_API_KEY');
const mongoUri = vaultService.get('MONGO_URI');
```

### Using Helper Methods
```javascript
// MongoDB config
const mongoConfig = vaultService.getMongoConfig();
// Returns: { uri, replicaSet, database }

// Redis config
const redisConfig = vaultService.getRedisConfig();
// Returns: { host, port, password, url }

// Elasticsearch config
const esConfig = vaultService.getElasticsearchConfig();
// Returns: { node, auth: { apiKey } }

// AWS config
const awsConfig = vaultService.getAWSConfig();
// Returns: { region, credentials, uploadsBucket, ... }

// Stripe config
const stripeConfig = vaultService.getStripeConfig();
// Returns: { secretKey, webhookSecret }

// ClickHouse config
const chConfig = vaultService.getClickHouseConfig();
// Returns: { url, username, password, database }
```

---

## 🔐 Production Deployment

1. **Create AppRole for production:**
   ```bash
   docker exec vault vault write auth/approle/role/backend-prod \
     bind_secret_id=true \
     secret_id_ttl=30d \
     token_ttl=24h \
     policies="backend"
   ```

2. **Rotate secrets regularly:**
   ```bash
   # Update MongoDB password in Vault
   docker exec vault vault kv put secret/database/mongodb \
     MONGO_URI="mongodb://admin:NEW_PASSWORD@..." \
     # ...other fields...

   # Restart backend service
   docker-compose restart backend
   ```

3. **Monitor secret access:**
   ```bash
   docker exec vault vault audit list
   docker logs vault | grep audit
   ```

---

## ⚠️ Security Best Practices

✅ **DO:**
- Store ALL sensitive data in Vault
- Rotate secrets regularly
- Use AppRole (not root token) in production
- Enable audit logging
- Use different credentials per environment

❌ **DON'T:**
- Commit `.env` with real secrets
- Use root token in production
- Expose VAULT_ROLE_ID and VAULT_SECRET_ID
- Store secrets in code or comments
- Use the same credentials across environments

---

## 🧪 Testing

```bash
# Test Vault connection
npm run test-vault

# Expected output:
# 🔐 Using AppRole authentication...
# ✅ AppRole authenticated (TTL: 3600s)
# ✅ All secrets loaded successfully
```

---

## 📞 Troubleshooting

### Secret not found?
```bash
# Check secret exists
docker exec vault vault kv list secret
docker exec vault vault kv get secret/your/path
```

### AppRole authentication failed?
```bash
# Verify AppRole
docker exec vault vault list auth/approle/role
docker exec vault vault read auth/approle/role/backend

# Test login
docker exec vault vault write auth/approle/login \
  role_id="YOUR_ROLE_ID" \
  secret_id="YOUR_SECRET_ID"
```

### Permission denied?
```bash
# Check policy
docker exec vault vault policy read backend

# Verify policy grants access to secret paths
# Should have:
# path "secret/data/*" { capabilities = ["read"] }
```
