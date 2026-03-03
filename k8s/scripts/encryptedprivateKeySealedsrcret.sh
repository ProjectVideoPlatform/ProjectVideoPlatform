#!/bin/bash
# backup-sealed-secrets-keys.sh

BACKUP_DATE=$(date +%Y%m%d)
BACKUP_FILE="sealed-secrets-key-${BACKUP_DATE}.tar.gz"

# 1. ดึง key
kubectl get secret -n sealed-secrets sealed-secrets-key \
  -o yaml > temp-key.yaml

# 2. บีบอัด
tar -czf ${BACKUP_FILE} temp-key.yaml

# 3. เข้ารหัสด้วย AES (ใช้ openssl)
openssl enc -aes-256-cbc \
  -salt \
  -in ${BACKUP_FILE} \
  -out ${BACKUP_FILE}.enc \
  -k ${BACKUP_PASSPHRASE}  # ควรใช้ env variable

# 4. อัพโหลดไป S3 (private bucket!)
aws s3 cp ${BACKUP_FILE}.enc s3://my-secure-backups/

# 5. ลบไฟล์ชั่วคราว
rm temp-key.yaml ${BACKUP_FILE} ${BACKUP_FILE}.enc

echo "✅ Backup completed: s3://my-secure-backups/${BACKUP_FILE}.enc"