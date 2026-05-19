# 📚 Vault Setup & Usage Guide

## 🚀 Step 1: เริ่มต้น Vault

```bash
# Start Vault
docker-compose -f docker-compose-vault.yml up -d

# Check status
docker-compose -f docker-compose-vault.yml ps
```

## 🔓 Step 2: Unseal Vault (ครั้งแรก)

```bash
# Initialize Vault (สร้าง unseal keys + root token)
docker exec vault vault operator init \
  -key-shares=1 \
  -key-threshold=1

# Output จะได้ประมาณนี้:
# Unseal Key 1: xxxxxxxxxxxxx
# Root Token:   hvs.xxxxxx

# Unseal Vault (ป้อน unseal key)
docker exec vault vault operator unseal xxxxxxxxxxxxx
```

## 🔐 Step 3: Store Secrets ใน Vault

### 3.1 เก็บ Elasticsearch API Key

```bash
# Login ก่อน
docker exec vault vault login -method=token token=root

# เก็บ Elasticsearch API Key
docker exec vault vault kv put secret/elasticsearch/backend \
  api_key="base64_encoded_key:here" \
  host="https://your-es-domain:9200"

# ตรวจสอบ
docker exec vault vault kv get secret/elasticsearch/backend
```

### 3.2 เก็บ Stripe Key

```bash
docker exec vault vault kv put secret/stripe/production \
  secret_key="sk_live_xxxxx" \
  publishable_key="pk_live_xxxxx" \
  webhook_secret="whsec_xxxxx"
```

### 3.3 เก็บ Database Credentials

```bash
docker exec vault vault kv put secret/database/mongodb \
  connection_string="mongodb://user:pass@host:27017/dbname" \
  username="db_user" \
  password="db_password"
```

### 3.4 เก็บ Redis Credentials

```bash
docker exec vault vault kv put secret/redis/main \
  connection_string="redis://user:pass@redis:6379" \
  password="redis_password"
```

## 🌐 Step 4: Vault Web UI

```
URL: http://localhost:8200/ui
Token: root
```

**Navigation:**
- Secrets → secret (KV v2)
  - elasticsearch/backend
  - stripe/production
  - database/mongodb
  - redis/main

## 📝 Step 5: Update Node.js Backend

### 5.1 Install Vault Client

```bash
npm install node-vault
```

### 5.2 สร้าง `config/vault.js`

```javascript
const vault = require('node-vault')({
  endpoint: process.env.VAULT_ADDR || 'http://localhost:8200',
  token: process.env.VAULT_TOKEN || 'root'
});

async function getSecret(path) {
  try {
    const secret = await vault.read(path);
    return secret.data.data;  // KV v2 ต้องใช้ .data.data
  } catch (error) {
    console.error(`Error reading secret from ${path}:`, error);
    throw error;
  }
}

// ตัวอย่าง
async function loadSecrets() {
  const esSecret = await getSecret('secret/elasticsearch/backend');
  const stripeSecret = await getSecret('secret/stripe/production');
  const dbSecret = await getSecret('secret/database/mongodb');
  const redisSecret = await getSecret('secret/redis/main');

  return {
    elasticsearch: esSecret,
    stripe: stripeSecret,
    database: dbSecret,
    redis: redisSecret
  };
}

module.exports = { getSecret, loadSecrets };
```

### 5.3 Update `server.js`

```javascript
const { loadSecrets } = require('./config/vault');

// ใน startServer function
const startServer = async () => {
  try {
    // ✅ โหลด secrets จาก Vault
    const secrets = await loadSecrets();

    // ✅ ใช้ secrets แทน environment variables
    const esClient = new Client({
      node: secrets.elasticsearch.host,
      auth: {
        apiKey: secrets.elasticsearch.api_key
      }
    });

    const mongoUrl = secrets.database.connection_string;
    const redisClient = createClient({
      url: secrets.redis.connection_string
    });

    // ✅ เชื่อมต่อ services
    await connectDB(mongoUrl);
    await redisClient.connect();

    // ... rest of code
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};
```

### 5.4 Update `.env`

```env
# Vault Configuration
VAULT_ADDR=http://localhost:8200
VAULT_TOKEN=root

# Development (ใช้ Vault แทน hardcoded secrets)
NODE_ENV=development
PORT=3000
```

## 🔐 Step 6: Role-Based Access Control (RBAC)

### 6.1 สร้าง Policy สำหรับ Backend

```bash
# สร้างไฟล์ backend-policy.hcl
cat > backend-policy.hcl << 'EOF'
path "secret/data/elasticsearch/backend" {
  capabilities = ["read", "list"]
}

path "secret/data/stripe/production" {
  capabilities = ["read", "list"]
}

path "secret/data/database/mongodb" {
  capabilities = ["read", "list"]
}

path "secret/data/redis/main" {
  capabilities = ["read", "list"]
}

path "secret/metadata/*" {
  capabilities = ["list"]
}
EOF

# นำเข้า policy
docker exec vault vault policy write backend-policy /vault/backend-policy.hcl
```

### 6.2 สร้าง AppRole สำหรับ Backend

```bash
# Enable AppRole auth method
docker exec vault vault auth enable approle

# สร้าง AppRole
docker exec vault vault write auth/approle/role/backend-role \
  bind_secret_id=true \
  secret_id_ttl=1h \
  token_ttl=1h \
  token_max_ttl=24h \
  policies="backend-policy"

# สร้าง RoleID
docker exec vault vault read auth/approle/role/backend-role/role-id

# สร้าง SecretID
docker exec vault vault write -f auth/approle/role/backend-role/secret-id

# Output จะได้:
# secret_id: xxxxx
# role_id: yyyyy
```

### 6.3 Update Vault Config ใน Backend

```javascript
const vault = require('node-vault')({
  endpoint: process.env.VAULT_ADDR,
  role_id: process.env.VAULT_ROLE_ID,
  secret_id: process.env.VAULT_SECRET_ID
});

// Login ผ่าน AppRole แทนใช้ root token
vault.auth.approle()
  .then(result => {
    vault.token = result.auth.client_token;
    console.log('✅ Authenticated with Vault');
  })
  .catch(error => console.error('❌ Vault auth failed:', error));
```

### 6.4 Update `.env` (Production)

```env
VAULT_ADDR=https://vault.production.example.com
VAULT_ROLE_ID=xxxx-xxxx-xxxx
VAULT_SECRET_ID=yyyy-yyyy-yyyy
```

## 📊 Step 7: Monitoring & Audit

### ดู Audit Logs

```bash
docker exec vault vault audit list

# ดู audit logs
docker logs vault | grep audit
```

### ดู Secret Access History

```bash
# Enable audit backend
docker exec vault vault audit enable file file_path=/vault/logs/audit.log

# ดู logs
docker exec vault tail -f /vault/logs/audit.log
```

## ⚠️ Production Best Practices

```bash
# 1. ใช้ real token authentication (ไม่ใช่ root)
docker exec vault vault token create \
  -policy=backend-policy \
  -ttl=24h

# 2. Enable HTTPS/TLS
# 3. ใช้ AppRole แทน root token
# 4. ตั้ง secret rotation policy
# 5. Monitor all access
# 6. ใช้ Vault HA (High Availability)
```

## 🧪 Test Commands

```bash
# Login
docker exec vault vault login -method=token token=root

# List secrets
docker exec vault vault kv list secret

# Read secret
docker exec vault vault kv get secret/elasticsearch/backend

# Update secret
docker exec vault vault kv put secret/elasticsearch/backend \
  api_key="new_key_value"

# Delete secret
docker exec vault vault kv delete secret/elasticsearch/backend

# Rotate secrets
docker exec vault vault kv delete secret/stripe/production
docker exec vault vault kv put secret/stripe/production \
  secret_key="new_sk_live_xxxxx"
```

## 🔗 Resources

- [HashiCorp Vault Docs](https://www.vaultproject.io/docs)
- [node-vault NPM](https://www.npmjs.com/package/node-vault)
- [Vault API Reference](https://www.vaultproject.io/api-docs)

---

**Summary:**
- Vault = central secrets management
- ✅ ปลอดภัย, centralized, auditable
- ✅ rotate secrets ได้ง่าย
- ✅ สำหรับ production-grade apps
