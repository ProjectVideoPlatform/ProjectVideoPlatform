# 🔐 Vault AppRole - Complete Setup Summary

## 📦 Files Created

| File | Purpose |
|------|---------|
| `setup-vault-agent.ps1` | PowerShell script to auto-setup AppRole |
| `setup-vault-agent.sh` | Bash script for Linux/Mac |
| `VAULT_QUICKSTART_WINDOWS.md` | Quick start guide for Windows |
| `VAULT_SETUP_GUIDE.md` | Comprehensive setup guide |
| `BackEnd/config/vault.js` | **Updated** - Now supports AppRole auth |
| `BackEnd/test-vault.js` | Test connection script |
| `BackEnd/.env.example` | Environment variables template |
| `BackEnd/package.json` | **Updated** - Added `test-vault` script |

---

## 🚀 Quick Setup Path

### Step 1: Start Vault (1 min)
```powershell
docker-compose -f docker-compose-vault.yml up -d
```

### Step 2: Create AppRole (1 min)
```powershell
.\setup-vault-agent.ps1
```

**📝 Save the output:**
```
VAULT_ROLE_ID=s.xxxxxx
VAULT_SECRET_ID=s.yyyyyy
```

### Step 3: Update .env (1 min)
```powershell
# Edit BackEnd\.env
VAULT_ADDR=http://localhost:8200
VAULT_ROLE_ID=s.xxxxxx      # From step 2
VAULT_SECRET_ID=s.yyyyyy    # From step 2
```

### Step 4: Add Secrets to Vault (2 min)
```powershell
# Add each secret
docker exec vault vault kv put secret/elasticsearch/backend `
  api_key="YOUR_KEY" `
  host="https://your-es.com:9200"

docker exec vault vault kv put secret/stripe/production `
  secret_key="sk_test_..."

docker exec vault vault kv put secret/database/mongodb `
  connection_string="mongodb://..."

docker exec vault vault kv put secret/redis/main `
  connection_string="redis://..."
```

### Step 5: Test Connection (1 min)
```powershell
cd BackEnd
npm install node-vault  # If not installed
npm run test-vault
```

**Expected output:**
```
✅ Vault initialized successfully
✅ All tests passed!
```

---

## 🔐 How It Works (AppRole Auth)

### Traditional (❌ Not Recommended)
```
Backend → Username/Password → Vault
         (exposed credentials!)
```

### AppRole (✅ Recommended)
```
Backend → RoleID + SecretID → Vault
         (rotatable, auditable)
         ↓
       (Login) → Client Token → Access Secrets
```

---

## 📂 Architecture

```
Vault Container
├── Policy: "backend"
│   └── Access to secrets/*
├── AppRole: "backend"
│   ├── RoleID (static)
│   └── SecretID (rotatable)
└── Secrets (KV v2)
    ├── secret/elasticsearch/backend
    ├── secret/stripe/production
    ├── secret/database/mongodb
    └── secret/redis/main
```

---

## 🔄 Token Renewal (Auto-Handled)

```javascript
// vault.js automatically:
// 1. Login with AppRole credentials
// 2. Get 1-hour token
// 3. Renew at 50% TTL (every 30 mins)
// 4. Re-authenticate if renewal fails
```

---

## 🛡️ Security Features

| Feature | Benefit |
|---------|---------|
| **AppRole Auth** | No hardcoded passwords |
| **TTL (1 hour)** | Short-lived tokens |
| **Auto Renewal** | No service interruption |
| **Audit Logs** | Who accessed what |
| **SecretID Rotation** | Compromised key = limited damage |
| **Policy-Based** | Least privilege access |

---

## ⚙️ Environment Variables

```env
# Required for AppRole
VAULT_ADDR=http://localhost:8200
VAULT_ROLE_ID=s.xxxxxx
VAULT_SECRET_ID=s.yyyyyy

# Other services (can come from Vault or .env)
NODE_ENV=development
PORT=3000
MONGO_URI=mongodb://...  # or from Vault
REDIS_URL=redis://...    # or from Vault
```

---

## 📚 Integration with Backend

### Before (❌ Insecure)
```javascript
const { Client } = require('@elastic/elasticsearch');

const client = new Client({
  node: process.env.ELASTICSEARCH_HOST,
  auth: {
    username: process.env.ES_USERNAME,  // ❌ Exposed!
    password: process.env.ES_PASSWORD   // ❌ Exposed!
  }
});
```

### After (✅ Secure)
```javascript
const vaultService = require('./config/vault');

const startServer = async () => {
  // ✅ Load secrets from Vault
  const secrets = await vaultService.initialize();

  const client = new Client({
    node: secrets.ELASTICSEARCH_HOST,
    auth: {
      apiKey: secrets.ELASTICSEARCH_API_KEY  // ✅ From Vault
    }
  });
};
```

---

## 🧪 Testing

### Run the test script
```powershell
npm run test-vault
```

### Manual verification
```powershell
# Check AppRole exists
docker exec vault vault list auth/approle/role

# Test login
docker exec vault vault write auth/approle/login `
  role_id="YOUR_ROLE_ID" `
  secret_id="YOUR_SECRET_ID"

# View secrets
docker exec vault vault kv list secret
docker exec vault vault kv get secret/elasticsearch/backend
```

---

## 🔀 Rotating SecretID

When you rotate SecretID, the old one becomes invalid:

```powershell
# Generate new SecretID
docker exec vault vault write -f `
  -field=secret_id `
  auth/approle/role/backend/secret-id

# Update .env with new SECRET_ID
# Restart backend service
```

---

## 📊 Monitoring & Logging

```powershell
# View audit logs
docker logs vault | grep audit

# Check token renewal
docker logs vault | grep "token"

# Monitor AppRole usage
docker exec vault vault auth list
docker exec vault vault list auth/approle/role
```

---

## 🎯 Production Best Practices

1. **Never commit `.env`** - Use `.env.example` instead
2. **Rotate SecretID regularly** - Every 90 days
3. **Enable audit logging** - Track all access
4. **Use HTTPS** - In production, enable TLS
5. **Monitor tokens** - Alert on failed auth
6. **Separate credentials** - Different role IDs per service
7. **Automate rotation** - Use Vault's rotation policies

---

## 🆘 Troubleshooting

### ❌ `VAULT_ROLE_ID is not set`
**Solution:**
```powershell
.\setup-vault-agent.ps1  # Re-run setup
# Copy credentials to .env
```

### ❌ `AppRole already enabled`
**Solution:** This is normal, script continues

### ❌ `connection refused`
**Solution:**
```powershell
docker-compose -f docker-compose-vault.yml ps
# Should show vault as "running"
```

### ❌ `secret_id_num_uses exceeded`
**Solution:**
```powershell
# Generate new SecretID
docker exec vault vault write -f auth/approle/role/backend/secret-id
```

---

## 📖 Full Documentation

See these files for more details:
- `VAULT_QUICKSTART_WINDOWS.md` - Quick reference
- `VAULT_SETUP_GUIDE.md` - Comprehensive guide
- [HashiCorp Vault Docs](https://www.vaultproject.io/docs)

---

## ✅ Verification Checklist

- [ ] Vault running: `docker ps | grep vault`
- [ ] Setup script completed: credentials saved
- [ ] `.env` updated with VAULT_ROLE_ID and VAULT_SECRET_ID
- [ ] Secrets created in Vault (elasticsearch, stripe, database, redis)
- [ ] `npm install node-vault` completed
- [ ] `npm run test-vault` passed
- [ ] Server logs show "🔐 Using AppRole authentication..."
- [ ] Elasticsearch connection successful
- [ ] Redis connection successful

---

**Status: ✅ AppRole Ready for Use**

Your backend is now using enterprise-grade secrets management! 🎉
