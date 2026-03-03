# 1. ดึง private key จาก controller ปัจจุบัน
kubectl get secret -n sealed-secrets sealed-secrets-key -o yaml > sealed-secrets-key-backup.yaml

# 2. ดึง public key
kubeseal --fetch-cert > public-key-cert.pem

# 3. เวลาสร้าง cluster ใหม่
kubectl apply -f sealed-secrets-key-backup.yaml  # restore private key ก่อน
kubectl apply -f controller.yaml                  # แล้วค่อยติดตั้ง controller