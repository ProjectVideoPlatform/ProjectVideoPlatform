# ══════════════════════════════════════
# STEP 1 — สร้าง keyfile
# ══════════════════════════════════════
openssl rand -base64 756 > ./BackEnd/mongo-keyfile

# ══════════════════════════════════════
# STEP 2 — Backup ข้อมูล MongoDB เดิม
# ══════════════════════════════════════
docker exec secure-video-mongodb1 mongodump \
  --host mongodb1:27017 \
  --out /tmp/backup

docker cp secure-video-mongodb1:/tmp/backup ./mongo-backup
echo "✅ Backup done — $(ls ./mongo-backup)"

# ══════════════════════════════════════
# STEP 3 — ลบ volumes MongoDB เก่า
# ══════════════════════════════════════
docker compose stop mongodb1 mongodb2 mongodb3 mongo-init
docker volume rm projectvideoplatform_mongodb_data \
                projectvideoplatform_mongodb2_data \
                projectvideoplatform_mongodb3_data

# ══════════════════════════════════════
# STEP 4 — Start Vault ก่อน
# ══════════════════════════════════════
docker compose -f docker-compose.vault.yml up vault -d

# รอ healthy
until docker exec vault wget -q --spider http://127.0.0.1:8200/v1/sys/health 2>/dev/null; do
  echo "Waiting for Vault..."; sleep 3
done
echo "✅ Vault ready"

# ══════════════════════════════════════
# STEP 5 — Put secrets และ setup AppRole
# ══════════════════════════════════════
bash scripts/put-secrets.sh
bash scripts/setup-approle.sh

# ══════════════════════════════════════
# STEP 6 — Start MongoDB ใหม่
# ══════════════════════════════════════
docker compose up mongo-keyfile-init
docker compose up mongodb1 mongodb2 mongodb3 -d

# รอ mongodb1 healthy
until docker exec secure-video-mongodb1 mongosh \
  -u admin -p adminpassword \
  --authenticationDatabase admin \
  --eval "db.adminCommand('ping')" &>/dev/null; do
  echo "Waiting for MongoDB..."; sleep 5
done
echo "✅ MongoDB ready"

# Init replica set
docker compose up mongo-init

# ══════════════════════════════════════
# STEP 7 — Restore ข้อมูล
# ══════════════════════════════════════
docker cp ./mongo-backup secure-video-mongodb1:/tmp/backup

docker exec secure-video-mongodb1 mongorestore \
  -u admin -p adminpassword \
  --authenticationDatabase admin \
  --drop \
  /tmp/backup
echo "✅ Restore done"

# ══════════════════════════════════════
# STEP 8 — สร้าง Vault user ใน MongoDB
# ══════════════════════════════════════
docker exec -i secure-video-mongodb1 mongosh \
  -u admin -p adminpassword \
  --authenticationDatabase admin << 'EOF'
use admin
db.createUser({
  user: "vault",
  pwd: "vaultpassword",
  roles: [
    { role: "userAdminAnyDatabase", db: "admin" },
    { role: "readWriteAnyDatabase", db: "admin" }
  ]
})
print("✅ Vault user created")
EOF

# ══════════════════════════════════════
# STEP 9 — Setup Dynamic Secrets
# ══════════════════════════════════════
bash scripts/setup-dynamic-secrets.sh

# ══════════════════════════════════════
# STEP 10 — Start Vault Agent
# ══════════════════════════════════════
docker compose -f docker-compose.vault.yml up vault-secrets-init vault-agent -d

# ตรวจสอบ app.env ถูก render แล้ว
sleep 10
docker exec vault-agent cat /vault/secrets/app.env

# ══════════════════════════════════════
# STEP 11 — Start services ที่เหลือ
# ══════════════════════════════════════
docker compose up -d

echo "🎉 All done!"