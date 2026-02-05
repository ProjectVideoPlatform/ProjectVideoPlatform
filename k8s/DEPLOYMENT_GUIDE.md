# 🚀 Secure Video Platform - Kubernetes Deployment Guide

## 📦 สิ่งที่ได้

ได้แปลง Docker Compose เป็น Kubernetes manifests ครบถ้วน:

### ✅ ไฟล์ที่สร้างแล้ว

```
k8s/
├── README.md                          # คู่มือหลัก
├── Makefile                           # คำสั่งลัด
│
├── namespaces/
│   └── namespace.yaml                 # Namespace: secure-video
│
├── secrets/
│   ├── mongodb-secret.yaml            # MongoDB credentials
│   ├── redis-secret.yaml              # Redis password
│   └── app-secret.yaml                # JWT, API keys, etc.
│
├── configmaps/
│   ├── app-config.yaml                # App environment variables
│   └── nginx-config.yaml              # Nginx configuration
│
├── storage/
│   ├── mongodb-storage.yaml           # MongoDB PV + PVC
│   ├── redis-storage.yaml             # Redis PV + PVC
│   └── app-logs-storage.yaml          # App logs PV + PVC
│
├── deployments/
│   ├── react-app-deployment.yaml      # Frontend (React)
│   ├── mongodb-deployment.yaml        # MongoDB StatefulSet
│   ├── redis-deployment.yaml          # Redis StatefulSet
│   ├── app-deployment.yaml            # Backend API
│   └── nginx-deployment.yaml          # Nginx reverse proxy
│
├── services/
│   └── all-services.yaml              # All services
│
├── ingress/
│   └── ingress.yaml                   # Ingress rules
│
├── monitoring/
│   ├── prometheus.yaml                # Prometheus setup
│   └── grafana.yaml                   # Grafana dashboard
│
├── dev/
│   └── mongo-express.yaml             # MongoDB web UI
│
├── autoscaling/
│   └── hpa.yaml                       # Auto-scaling rules
│
├── network-policies/
│   └── network-policies.yaml          # Network security
│
├── scripts/
│   ├── deploy-all.sh                  # Deploy script
│   ├── cleanup.sh                     # Cleanup script
│   └── port-forward.sh                # Port forwarding
│
└── docker/
    ├── Dockerfile                     # App Docker image
    └── .dockerignore                  # Docker ignore

```

## 🎯 การใช้งาน

### 1. ติดตั้ง Prerequisites

```bash
# ติดตั้ง kubectl
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl

# ติดตั้ง Minikube (สำหรับทดสอบ local)
curl -LO https://storage.googleapis.com/minikube/releases/latest/minikube-linux-amd64
sudo install minikube-linux-amd64 /usr/local/bin/minikube

# เริ่ม Minikube
minikube start --cpus=4 --memory=8192

# ติดตั้ง Ingress Controller
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.8.1/deploy/static/provider/cloud/deploy.yaml

# ติดตั้ง Metrics Server (สำหรับ auto-scaling)
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
```

### 2. แก้ไข Configuration

**สำคัญ! ต้องแก้ไขก่อน deploy:**

```bash
cd k8s

# 1. แก้ไข Secrets
nano secrets/mongodb-secret.yaml
nano secrets/redis-secret.yaml
nano secrets/app-secret.yaml

# 2. แก้ไข Domain
nano ingress/ingress.yaml
# เปลี่ยน yourdomain.com เป็น domain จริง

# 3. แก้ไข Docker Registry (ถ้ามี)
nano deployments/app-deployment.yaml
# เปลี่ยน image: your-registry/secure-video-app:latest
```

### 3. Deploy ด้วย Make (แนะนำ)

```bash
# ดู commands ทั้งหมด
make help

# Deploy production
make deploy

# หรือ Deploy development
make deploy-dev

# ดู status
make status

# ดู logs
make logs-app

# Port forward
make port-forward
```

### 4. Deploy แบบ Manual

```bash
cd k8s/scripts
chmod +x *.sh

# Deploy ทั้งหมด
./deploy-all.sh prod

# หรือ Deploy แบบทีละขั้น
cd ..
kubectl apply -f namespaces/
kubectl apply -f secrets/
kubectl apply -f configmaps/
kubectl apply -f storage/
kubectl apply -f deployments/
kubectl apply -f services/
kubectl apply -f ingress/
```

### 5. เช็คสถานะ

```bash
# ดู pods
kubectl get pods -n secure-video

# ดู services
kubectl get svc -n secure-video

# ดู ingress
kubectl get ingress -n secure-video

# ดู logs
kubectl logs -f deployment/app -n secure-video

# ดู events
kubectl get events -n secure-video --sort-by='.lastTimestamp'
```

### 6. เข้าถึง Services (Local)

```bash
# แบบที่ 1: ใช้ port-forward
./scripts/port-forward.sh

# แบบที่ 2: Port forward แยก
kubectl port-forward -n secure-video svc/nginx-service 8080:80
kubectl port-forward -n secure-video svc/app-service 3000:3000
kubectl port-forward -n secure-video svc/react-app-service 5173:5173

# แบบที่ 3: ใช้ Minikube tunnel
minikube tunnel

# จากนั้นเข้าได้ที่
# http://<EXTERNAL-IP>  (ดู IP จาก kubectl get svc nginx-service)
```

## 🔑 Secrets Management

**⚠️ ระวัง! อย่า commit secrets จริงลง Git**

### วิธีที่ 1: ใช้ Environment Variables

```bash
# สร้าง secret จาก env vars
kubectl create secret generic app-secret \
  --from-literal=jwt-secret="$(openssl rand -base64 32)" \
  --from-literal=mongodb-url="mongodb://..." \
  -n secure-video
```

### วิธีที่ 2: ใช้ Sealed Secrets

```bash
# ติดตั้ง Sealed Secrets
kubectl apply -f https://github.com/bitnami-labs/sealed-secrets/releases/download/v0.24.0/controller.yaml

# แปลง secret เป็น sealed secret
kubeseal -f secrets/app-secret.yaml -w secrets/app-sealed-secret.yaml

# Deploy sealed secret (ปลอดภัยที่จะ commit)
kubectl apply -f secrets/app-sealed-secret.yaml
```

### วิธีที่ 3: ใช้ Cloud Secret Manager

```yaml
# ใช้ External Secrets Operator
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: app-secret
spec:
  secretStoreRef:
    name: aws-secrets-manager  # หรือ GCP, Azure
  target:
    name: app-secret
  data:
  - secretKey: jwt-secret
    remoteRef:
      key: prod/secure-video/jwt-secret
```

## 📊 Monitoring

### เข้าถึง Grafana

```bash
# Port forward
kubectl port-forward -n secure-video svc/grafana-service 3001:3000

# เปิดเบราว์เซอร์
open http://localhost:3001

# Login
Username: admin
Password: grafana123
```

### เข้าถึง Prometheus

```bash
kubectl port-forward -n secure-video svc/prometheus-service 9090:9090
open http://localhost:9090
```

## 🔄 CI/CD Pipeline

### GitHub Actions Example

```yaml
# .github/workflows/deploy.yml
name: Deploy to Kubernetes

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Build Docker Image
        run: |
          docker build -t ${{ secrets.REGISTRY }}/secure-video-app:${{ github.sha }} .
          docker push ${{ secrets.REGISTRY }}/secure-video-app:${{ github.sha }}
      
      - name: Set up kubectl
        uses: azure/setup-kubectl@v3
        with:
          version: 'v1.27.0'
      
      - name: Configure kubectl
        run: |
          echo "${{ secrets.KUBE_CONFIG }}" | base64 -d > kubeconfig
          export KUBECONFIG=kubeconfig
          
      - name: Update Deployment
        run: |
          kubectl set image deployment/app \
            app=${{ secrets.REGISTRY }}/secure-video-app:${{ github.sha }} \
            -n secure-video
          
      - name: Wait for Rollout
        run: |
          kubectl rollout status deployment/app -n secure-video
```

## 🌍 Production Deployment

### 1. Cloud Providers

#### AWS (EKS)
```bash
# สร้าง EKS cluster
eksctl create cluster \
  --name secure-video \
  --region us-west-2 \
  --nodegroup-name standard-workers \
  --node-type t3.medium \
  --nodes 3

# Deploy
kubectl apply -f k8s/
```

#### Google Cloud (GKE)
```bash
# สร้าง GKE cluster
gcloud container clusters create secure-video \
  --region us-central1 \
  --num-nodes 3 \
  --machine-type n1-standard-2

# Deploy
kubectl apply -f k8s/
```

#### Azure (AKS)
```bash
# สร้าง AKS cluster
az aks create \
  --resource-group secure-video-rg \
  --name secure-video \
  --node-count 3 \
  --node-vm-size Standard_D2s_v3

# Deploy
kubectl apply -f k8s/
```

### 2. SSL/TLS Configuration

#### ใช้ Cert-Manager

```bash
# ติดตั้ง cert-manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml

# สร้าง ClusterIssuer
cat <<EOF | kubectl apply -f -
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: your-email@example.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
    - http01:
        ingress:
          class: nginx
EOF

# แก้ไข ingress.yaml
# เพิ่ม annotation: cert-manager.io/cluster-issuer: "letsencrypt-prod"
# เพิ่ม tls section
```

## 🛠️ Troubleshooting

### Pods ไม่ขึ้น

```bash
# ดู status
kubectl get pods -n secure-video

# ดู events
kubectl describe pod <pod-name> -n secure-video

# ดู logs
kubectl logs <pod-name> -n secure-video

# เข้าไปใน pod
kubectl exec -it <pod-name> -n secure-video -- sh
```

### Database Connection Error

```bash
# Test MongoDB
kubectl exec -it mongodb-0 -n secure-video -- mongosh -u admin -p

# Test Redis
kubectl exec -it redis-0 -n secure-video -- redis-cli -a <password> ping

# ดู service endpoints
kubectl get endpoints -n secure-video
```

### Image Pull Error

```bash
# สร้าง registry secret
kubectl create secret docker-registry regcred \
  --docker-server=<registry-url> \
  --docker-username=<username> \
  --docker-password=<password> \
  --docker-email=<email> \
  -n secure-video

# เพิ่มใน deployment
spec:
  template:
    spec:
      imagePullSecrets:
      - name: regcred
```

## 📚 คำสั่งที่ใช้บ่อย

```bash
# Restart deployment
kubectl rollout restart deployment/app -n secure-video

# Scale deployment
kubectl scale deployment app --replicas=5 -n secure-video

# Update image
kubectl set image deployment/app app=new-image:tag -n secure-video

# Rollback
kubectl rollout undo deployment/app -n secure-video

# Port forward
kubectl port-forward svc/app-service 3000:3000 -n secure-video

# Logs
kubectl logs -f deployment/app -n secure-video

# Execute command
kubectl exec -it <pod-name> -n secure-video -- sh

# Copy files
kubectl cp <pod>:/path/to/file ./local-file -n secure-video

# Top resources
kubectl top pods -n secure-video
kubectl top nodes

# Delete pod (will recreate)
kubectl delete pod <pod-name> -n secure-video
```

## 🧹 Cleanup

```bash
# ใช้ script
cd k8s/scripts
./cleanup.sh

# หรือ manual
kubectl delete namespace secure-video

# ลบทั้งหมด
kubectl delete -f k8s/ --recursive
```

## 📝 Production Checklist

- [ ] แก้ไข secrets ทั้งหมด
- [ ] ตั้งค่า domain และ DNS
- [ ] Configure SSL/TLS
- [ ] ตั้งค่า resource limits
- [ ] Enable monitoring
- [ ] ตั้งค่า backup strategy
- [ ] Configure log aggregation
- [ ] Enable network policies
- [ ] Set up auto-scaling
- [ ] Configure pod disruption budgets
- [ ] Review security policies
- [ ] Set up CI/CD
- [ ] Disaster recovery plan
- [ ] Load testing
- [ ] Security scanning

## 🎓 เรียนรู้เพิ่มเติม

- [Kubernetes Official Docs](https://kubernetes.io/docs/)
- [kubectl Cheat Sheet](https://kubernetes.io/docs/reference/kubectl/cheatsheet/)
- [Best Practices](https://kubernetes.io/docs/concepts/configuration/overview/)
- [12 Factor App](https://12factor.net/)

## 💡 Tips

1. ใช้ `make` commands แทนคำสั่งยาวๆ
2. ตั้งค่า alias สำหรับ kubectl:
   ```bash
   alias k=kubectl
   alias kgp='kubectl get pods'
   alias kgs='kubectl get svc'
   ```
3. ใช้ namespace ใน context:
   ```bash
   kubectl config set-context --current --namespace=secure-video
   ```
4. Enable auto-completion:
   ```bash
   source <(kubectl completion bash)
   ```

## 🆘 ขอความช่วยเหลือ

หาก deploy ไม่ได้:
1. เช็ค prerequisites ทั้งหมด
2. ดู events และ logs
3. ทดสอบแต่ละ component ทีละตัว
4. ใช้ `kubectl describe` ดูรายละเอียด
5. Google error message 😊

---

**Good luck with your deployment! 🚀**