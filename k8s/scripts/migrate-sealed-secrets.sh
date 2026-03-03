#!/bin/bash
# migrate-sealed-secrets.sh

set -e  # หยุดถ้า error

OLD_CLUSTER="old-cluster-context"
NEW_CLUSTER="new-cluster-context"
BACKUP_FILE="sealed-secrets-key-backup.yaml"

echo "🔐 ขั้นตอนที่ 1: Backup key จาก cluster เก่า"
kubectl config use-context $OLD_CLUSTER
kubectl get secret -n sealed-secrets sealed-secrets-key -o yaml \
  --kubeconfig kubeconfig-old.yaml > $BACKUP_FILE

echo "✅ Backup เสร็จสิ้น: $BACKUP_FILE"

echo "🚀 ขั้นตอนที่ 2: สร้าง namespace ใน cluster ใหม่"
kubectl config use-context $NEW_CLUSTER
kubectl create namespace sealed-secrets --dry-run=client -o yaml | kubectl apply -f -

echo "🔑 ขั้นตอนที่ 3: Restore private key (สำคัญมาก!)"
# ลบ fields ที่ไม่จำเป็นออกก่อน apply
cat $BACKUP_FILE | grep -v "creationTimestamp\|resourceVersion\|uid" | kubectl apply -f -

echo "📦 ขั้นตอนที่ 4: ติดตั้ง controller"
kubectl apply -f https://github.com/bitnami-labs/sealed-secrets/releases/download/v0.27.2/controller.yaml

echo "⏳ รอ controller พร้อมทำงาน..."
kubectl wait --for=condition=available -n sealed-secrets deployment/sealed-secrets-controller --timeout=120s

echo "✅ ทดสอบการทำงาน"
kubeseal --fetch-cert --controller-name=sealed-secrets-controller --controller-namespace=sealed-secrets

echo "🎉 เสร็จสิ้น! cluster ใหม่ใช้ key เดิมได้แล้ว"