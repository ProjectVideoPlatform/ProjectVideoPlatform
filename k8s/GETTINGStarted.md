# 📦 Kubernetes Manifests - Complete Package

## ✅ สิ่งที่คุณได้รับ

ระบบ Kubernetes manifests ครบชุด สำหรับ Deploy Secure Video Platform

### 📂 โครงสร้างไฟล์

```
k8s/
├── 📄 README.md                      # คู่มือหลัก พร้อมรายละเอียดทุกอย่าง
├── 📄 DEPLOYMENT_GUIDE.md            # คู่มือ Deploy แบบละเอียด (ภาษาไทย)
├── 📄 Makefile                       # คำสั่งลัดสำหรับ Deploy และจัดการ
├── 🚀 quick-start.sh                 # Script เริ่มต้นใช้งานอัตโนมัติ
│
├── 📁 namespaces/
│   └── namespace.yaml                # สร้าง namespace: secure-video
│
├── 🔐 secrets/
│   ├── mongodb-secret.yaml           # Username, Password สำหรับ MongoDB
│   ├── redis-secret.yaml             # Password สำหรับ Redis
│   └── app-secret.yaml               # JWT secrets, DB URLs, API keys
│
├── ⚙️  configmaps/
│   ├── app-config.yaml               # Environment variables สำหรับ App
│   └── nginx-config.yaml             # Nginx configuration ครบถ้วน
│
├── 💾 storage/
│   ├── mongodb-storage.yaml          # PV + PVC สำหรับ MongoDB (10GB)
│   ├── redis-storage.yaml            # PV + PVC สำหรับ Redis (5GB)
│   └── app-logs-storage.yaml         # PV + PVC สำหรับ App logs (2GB)
│
├── 🚢 deployments/
│   ├── react-app-deployment.yaml     # Frontend React App (2 replicas)
│   ├── mongodb-deployment.yaml       # MongoDB StatefulSet
│   ├── redis-deployment.yaml         # Redis StatefulSet
│   ├── app-deployment.yaml           # Backend Node.js App (3 replicas)
│   └── nginx-deployment.yaml         # Nginx Reverse Proxy (2 replicas)
│
├── 🌐 services/
│   └── all-services.yaml             # Services ทั้งหมด (ClusterIP, LoadBalancer)
│
├── 🔀 ingress/
│   └── ingress.yaml                  # Ingress rules พร้อม SSL/TLS config
│
├── 📊 monitoring/
│   ├── prometheus.yaml               # Prometheus สำหรับ metrics
│   └── grafana.yaml                  # Grafana สำหรับ visualization
│
├── 🛠️  dev/
│   └── mongo-express.yaml            # MongoDB Web UI (สำหรับ dev)
│
├── 📈 autoscaling/
│   └── hpa.yaml                      # Horizontal Pod Autoscaler
│
├── 🔒 network-policies/
│   └── network-policies.yaml         # Network security policies
│
├── 📜 scripts/
│   ├── deploy-all.sh                 # Deploy ทั้งหมดอัตโนมัติ
│   ├── cleanup.sh                    # ลบทุกอย่าง
│   └── port-forward.sh               # Port forwarding helper
│
└── 🐳 docker/
    ├── Dockerfile                    # Multi-stage Docker build
    └── .dockerignore                 # Docker ignore rules
```

## 🚀 วิธีใช้งานแบบเร็ว

### 1. ติดตั้ง Prerequisites

```bash
# ติดตั้ง kubectl
curl -LO https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl
sudo install kubectl /usr/local/bin/kubectl

# สำหรับทดสอบ local - ติดตั้ง Minikube
curl -LO https://storage.googleapis.com/minikube/releases/latest/minikube-linux-amd64
sudo install minikube-linux-amd64 /usr/local/bin/minikube
minikube start --cpus=4 --memory=8192
```

### 2. Deploy แบบอัตโนมัติ

```bash
cd k8s

# ใช้ Quick Start Script
chmod +x quick-start.sh
./quick-start.sh

# หรือใช้ Make
make deploy        # Production
make deploy-dev    # Development
```

### 3. Deploy แบบ Manual

```bash
cd k8s/scripts
chmod +x *.sh

# Deploy production
./deploy-all.sh prod

# หรือ Deploy development
./deploy-all.sh dev
```

## 📋 คำสั่ง Make ที่สำคัญ

```bash
make help              # แสดงคำสั่งทั้งหมด
make deploy            # Deploy production
make deploy-dev        # Deploy development
make status            # ดูสถานะการ deploy
make logs-app          # ดู logs ของ backend
make port-forward      # Port forward services
make clean             # ลบทุกอย่าง
make restart-app       # Restart backend app
make backup-mongodb    # Backup MongoDB
```

## 🔑 ข้อมูลที่ต้องแก้ไขก่อน Deploy

### 1. Secrets (สำคัญมาก!)

**📁 secrets/mongodb-secret.yaml**
```yaml
stringData:
  mongodb-root-username: admin
  mongodb-root-password: "สร้าง password ใหม่"  # ⚠️ แก้ไข!
```

**📁 secrets/redis-secret.yaml**
```yaml
stringData:
  redis-password: "สร้าง password ใหม่"  # ⚠️ แก้ไข!
```

**📁 secrets/app-secret.yaml**
```yaml
stringData:
  jwt-secret: "สร้าง secret ใหม่"        # ⚠️ แก้ไข!
  jwt-refresh-secret: "สร้าง secret ใหม่" # ⚠️ แก้ไข!
```

💡 **สร้าง secure passwords:**
```bash
openssl rand -base64 32  # สำหรับ passwords
openssl rand -base64 64  # สำหรับ JWT secrets
```

### 2. Domain Configuration

**📁 ingress/ingress.yaml**
```yaml
spec:
  rules:
  - host: yourdomain.com  # ⚠️ เปลี่ยนเป็น domain จริง
```

### 3. Docker Image

**📁 deployments/app-deployment.yaml**
```yaml
spec:
  template:
    spec:
      containers:
      - name: app
        image: your-registry/secure-video-app:latest  # ⚠️ เปลี่ยนเป็น registry จริง
```

## 🌍 Deploy บน Cloud

### AWS (EKS)
```bash
eksctl create cluster --name secure-video --region us-west-2
kubectl apply -f k8s/
```

### Google Cloud (GKE)
```bash
gcloud container clusters create secure-video --region us-central1
kubectl apply -f k8s/
```

### Azure (AKS)
```bash
az aks create --resource-group rg --name secure-video
kubectl apply -f k8s/
```

### DigitalOcean (DOKS)
```bash
doctl kubernetes cluster create secure-video
kubectl apply -f k8s/
```

## 📊 Components ที่ถูก Deploy

| Component | Type | Replicas | Resources |
|-----------|------|----------|-----------|
| React App | Deployment | 2 | 512Mi-1Gi RAM, 250-500m CPU |
| Backend API | Deployment | 3 | 512Mi-1Gi RAM, 500m-1 CPU |
| Nginx | Deployment | 2 | 128-256Mi RAM, 100-200m CPU |
| MongoDB | StatefulSet | 1 | 512Mi-2Gi RAM, 500m-1 CPU |
| Redis | StatefulSet | 1 | 256-512Mi RAM, 250-500m CPU |
| Prometheus | Deployment | 1 | 512Mi-1Gi RAM, 500m-1 CPU |
| Grafana | Deployment | 1 | 256-512Mi RAM, 250-500m CPU |

## 🔐 Security Features

✅ Non-root containers (UID 1001)
✅ Read-only root filesystem
✅ No privilege escalation
✅ Network policies enabled
✅ Secrets encryption
✅ Resource limits
✅ Security contexts
✅ Pod security policies

## 📈 Monitoring & Observability

- **Prometheus**: http://localhost:9090 (via port-forward)
- **Grafana**: http://localhost:3001 (via port-forward)
  - Username: `admin`
  - Password: `grafana123`

## 🔄 Auto-Scaling

HorizontalPodAutoscaler configured for:
- **Backend App**: 2-10 replicas (70% CPU, 80% Memory)
- **React App**: 2-5 replicas (70% CPU)
- **Nginx**: 2-5 replicas (75% CPU)

## 💾 Storage

- **MongoDB**: 10GB persistent storage
- **Redis**: 5GB persistent storage  
- **App Logs**: 2GB shared storage

## 🛠️ ตรวจสอบสถานะ

```bash
# ดู pods
kubectl get pods -n secure-video

# ดู services
kubectl get svc -n secure-video

# ดู logs
kubectl logs -f deployment/app -n secure-video

# Port forward
kubectl port-forward -n secure-video svc/nginx-service 8080:80
```

## 🐛 Troubleshooting

### Pods ไม่ขึ้น
```bash
kubectl describe pod <pod-name> -n secure-video
kubectl logs <pod-name> -n secure-video
```

### Database connection error
```bash
kubectl exec -it mongodb-0 -n secure-video -- mongosh
kubectl exec -it redis-0 -n secure-video -- redis-cli
```

### Service ไม่ accessible
```bash
kubectl get endpoints -n secure-video
kubectl port-forward svc/<service-name> 8080:80 -n secure-video
```

## 📚 เอกสารเพิ่มเติม

- **README.md**: คู่มือหลักภาษาอังกฤษ
- **DEPLOYMENT_GUIDE.md**: คู่มือ Deploy ละเอียด ภาษาไทย
- [Kubernetes Docs](https://kubernetes.io/docs/)
- [kubectl Cheat Sheet](https://kubernetes.io/docs/reference/kubectl/cheatsheet/)

## 🎯 Production Checklist

- [ ] แก้ไข secrets ทั้งหมด
- [ ] ตั้งค่า domain และ DNS
- [ ] Configure SSL/TLS certificates
- [ ] Update Docker registry
- [ ] Set resource limits
- [ ] Enable monitoring alerts
- [ ] Configure backups
- [ ] Enable network policies
- [ ] Review security settings
- [ ] Set up CI/CD pipeline
- [ ] Load testing
- [ ] Disaster recovery plan

## 💡 Tips

1. ใช้ `make` commands แทนคำสั่งยาว
2. ตั้งค่า kubectl alias: `alias k=kubectl`
3. Enable auto-completion: `source <(kubectl completion bash)`
4. ใช้ namespace context: `kubectl config set-context --current --namespace=secure-video`

## 🆘 ต้องการความช่วยเหลือ?

1. ดู logs: `kubectl logs <pod-name> -n secure-video`
2. ดู events: `kubectl get events -n secure-video`
3. Describe pod: `kubectl describe pod <pod-name> -n secure-video`
4. ใช้ `make help` ดูคำสั่งทั้งหมด

---

## ⚡ Quick Commands Reference

```bash
# Deploy
make deploy                  # Full production deployment
./quick-start.sh            # Interactive deployment

# Status
make status                  # Overall status
kubectl get all -n secure-video

# Logs
make logs-app               # Backend logs
kubectl logs -f <pod> -n secure-video

# Port Forward
make port-forward           # Interactive menu
kubectl port-forward svc/nginx-service 8080:80 -n secure-video

# Scaling
kubectl scale deployment app --replicas=5 -n secure-video

# Restart
make restart-app            # Restart backend
kubectl rollout restart deployment/app -n secure-video

# Cleanup
make clean                  # Interactive cleanup
./scripts/cleanup.sh

# Debug
kubectl exec -it <pod> -n secure-video -- sh
kubectl describe pod <pod> -n secure-video
```

---

**🎉 Ready to Deploy!**

เริ่มต้นด้วย: `./quick-start.sh` หรือ `make deploy`

Good luck! 🚀