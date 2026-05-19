# 🔐 Vault AppRole Setup - Quick Start (Windows)

## ⚡ Quick Setup (5 minutes)

### 1️⃣ Start Vault

```powershell
docker-compose -f docker-compose-vault.yml up -d
docker ps  # Verify vault is running
```

### 2️⃣ Run Setup Script

```powershell
# ✅ In PowerShell (as Administrator)
cd c:\Github\ProjectVideoPlatform
.\setup-vault-agent.ps1
```

**Output should show:**
```
Role ID: s.Fz8NuXY7TYtLPY...
Secret ID: s.YJFQ5qxQ...
```

### 3️⃣ Save Credentials

Copy the credentials to `.env`:

```powershell
# Backup your current .env
Copy-Item .\.env .\.env.backup

# Edit .env and add:
# VAULT_ADDR=http://localhost:8200
# VAULT_ROLE_ID=s.Fz8NuXY7TYtLPY...
# VAULT_SECRET_ID=s.YJFQ5qxQ...
```

### 4️⃣ Create Secrets in Vault

```powershell
# Store Elasticsearch API Key
docker exec vault vault kv put secret/elasticsearch/backend `
  api_key="your_api_key_here" `
  host="https://your-es-domain:9200"

# Store Stripe Keys
docker exec vault vault kv put secret/stripe/production `
  secret_key="sk_test_xxxxx" `
  publishable_key="pk_test_xxxxx"

# Store MongoDB URI
docker exec vault vault kv put secret/database/mongodb `
  connection_string="mongodb://localhost:27017/video-platform"

# Store Redis URL
docker exec vault vault kv put secret/redis/main `
  connection_string="redis://localhost:6379"
```

### 5️⃣ Test Connection

```powershell
cd BackEnd
npm run test-vault
```

**Expected output:**
```
🔐 Using AppRole authentication...
✅ AppRole authenticated (TTL: 3600s)
✅ All secrets loaded successfully
```

---

## 📚 Manual Commands (if script fails)

### Enable AppRole
```powershell
docker exec vault vault auth enable approle
```

### Create Policy
```powershell
docker exec vault vault policy write backend - << 'EOF'
path "secret/data/*" {
  capabilities = ["read", "list"]
}
path "auth/token/renew-self" {
  capabilities = ["update"]
}
EOF
```

### Create AppRole
```powershell
docker exec vault vault write auth/approle/role/backend `
  bind_secret_id=true `
  secret_id_ttl=24h `
  token_ttl=1h `
  policies="backend"
```

### Get Credentials
```powershell
# Role ID
docker exec vault vault read -field=role_id auth/approle/role/backend/role-id

# Secret ID
docker exec vault vault write -f -field=secret_id auth/approle/role/backend/secret-id
```

---

## 🔍 Verification

### Check AppRole Exists
```powershell
docker exec vault vault list auth/approle/role
```

### Test Login
```powershell
docker exec vault vault write auth/approle/login `
  role_id="YOUR_ROLE_ID" `
  secret_id="YOUR_SECRET_ID"
```

### View Secrets
```powershell
docker exec vault vault kv list secret
docker exec vault vault kv get secret/elasticsearch/backend
```

---

## ⚙️ Update server.js

Add to **BackEnd/server.js** (near the top):

```javascript
require('dotenv').config();
const vaultService = require('./config/vault');

// Load secrets from Vault before connecting to services
const initializeApp = async () => {
  try {
    // ✅ Load all secrets from Vault
    const secrets = await vaultService.initialize();
    console.log('✅ Secrets loaded from Vault');

    // ✅ Use secrets for Elasticsearch
    const esClient = new Client({
      node: secrets.ELASTICSEARCH_HOST,
      auth: {
        apiKey: secrets.ELASTICSEARCH_API_KEY
      }
    });

    // ✅ Use secrets for MongoDB
    await connectDB(secrets.MONGO_URI);

    // ✅ Use secrets for Redis
    await redisClient.connect(secrets.REDIS_URL);

    // ... rest of your code
    startServer();
  } catch (error) {
    console.error('Failed to initialize app:', error);
    process.exit(1);
  }
};

initializeApp();
```

---

## 🚀 Useful Commands

```powershell
# View Vault UI
Start-Process "http://localhost:8200/ui"

# Check Vault logs
docker logs vault

# Stop Vault
docker-compose -f docker-compose-vault.yml down

# Restart Vault
docker-compose -f docker-compose-vault.yml restart vault

# Inspect secret (requires auth)
docker exec vault vault kv get secret/elasticsearch/backend

# Rotate a secret
docker exec vault vault kv put secret/elasticsearch/backend `
  api_key="new_key_value"
```

---

## 🎯 What's Next?

- ✅ Rotation policy: Automate secret rotation every 90 days
- ✅ Audit logs: Monitor who accesses what secrets
- ✅ HA setup: Deploy Vault in production with high availability
- ✅ PKI: Use Vault for certificate management

---

## 📖 Full Documentation

See `VAULT_SETUP_GUIDE.md` for:
- Advanced configuration
- RBAC setup
- Audit logging
- Production deployment
