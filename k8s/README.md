# Secure Video Platform - Kubernetes Deployment

Complete Kubernetes deployment configuration for the Secure Video Platform.

## 📁 Folder Structure

```
k8s/
├── namespaces/              # Namespace definitions
├── secrets/                 # Sensitive data (passwords, keys)
├── configmaps/             # Configuration files
├── storage/                # PersistentVolumes and PVCs
├── deployments/            # Application deployments
├── services/               # Service definitions
├── ingress/                # Ingress rules
├── monitoring/             # Prometheus & Grafana
├── dev/                    # Development tools (Mongo Express)
├── autoscaling/            # HorizontalPodAutoscaler
├── network-policies/       # Network security policies
└── scripts/                # Deployment helper scripts
```

## 🚀 Quick Start

### Prerequisites

1. **Kubernetes Cluster** (v1.24+)
   - Minikube (local)
   - GKE, EKS, AKS (cloud)
   - K3s, Kind (lightweight)

2. **kubectl** installed and configured
   ```bash
   kubectl version --client
   ```

3. **Ingress Controller** (Nginx recommended)
   ```bash
   kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.8.1/deploy/static/provider/cloud/deploy.yaml
   ```

4. **Metrics Server** (for HPA)
   ```bash
   kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
   ```

### Deployment Steps

#### 1. Update Configuration

**Update Secrets** (`secrets/*.yaml`):
```bash
# Generate secure passwords
openssl rand -base64 32  # MongoDB password
openssl rand -base64 32  # Redis password
openssl rand -base64 32  # JWT secret
```

Edit files:
- `secrets/mongodb-secret.yaml`
- `secrets/redis-secret.yaml`
- `secrets/app-secret.yaml`

**Update ConfigMaps** (`configmaps/app-config.yaml`):
- `ALLOWED_ORIGINS`: Your domain
- Other environment variables

**Update Ingress** (`ingress/ingress.yaml`):
- Replace `yourdomain.com` with your actual domain

#### 2. Deploy All Resources

```bash
cd k8s/scripts
chmod +x *.sh

# Deploy everything
./deploy-all.sh prod

# Or for development
./deploy-all.sh dev
```

#### 3. Verify Deployment

```bash
# Check all resources
kubectl get all -n secure-video

# Check pod status
kubectl get pods -n secure-video

# Check services
kubectl get svc -n secure-video

# Check ingress
kubectl get ingress -n secure-video
```

#### 4. Access Services

**Production (via Ingress)**:
- Frontend: `https://yourdomain.com`
- Backend API: `https://yourdomain.com/api`
- Grafana: `https://yourdomain.com/grafana` (if configured)

**Development (via port-forward)**:
```bash
./port-forward.sh
```

Then select the service you want to access.

## 📊 Architecture

```
┌─────────────────┐
│   Internet      │
└────────┬────────┘
         │
    ┌────▼────┐
    │ Ingress │
    └────┬────┘
         │
    ┌────▼────┐
    │  Nginx  │ (Reverse Proxy)
    └─┬────┬──┘
      │    │
┌─────▼─┐ ┌▼────────┐
│ React │ │ Backend │
│  App  │ │   API   │
└───────┘ └─┬────┬──┘
            │    │
       ┌────▼─┐ ┌▼─────┐
       │ Mongo│ │ Redis│
       │  DB  │ │      │
       └──────┘ └──────┘
```

## 🔧 Common Operations

### Scaling

**Manual scaling**:
```bash
kubectl scale deployment app -n secure-video --replicas=5
```

**Auto-scaling** (HPA already configured):
```bash
kubectl get hpa -n secure-video
```

### Rolling Updates

```bash
# Update image
kubectl set image deployment/app app=your-registry/app:v2.0 -n secure-video

# Check rollout status
kubectl rollout status deployment/app -n secure-video

# Rollback if needed
kubectl rollout undo deployment/app -n secure-video
```

### Logs

```bash
# View logs
kubectl logs -f deployment/app -n secure-video

# View logs for specific pod
kubectl logs -f <pod-name> -n secure-video

# View logs from all pods
kubectl logs -l app=backend-app -n secure-video --tail=100
```

### Debugging

```bash
# Describe pod
kubectl describe pod <pod-name> -n secure-video

# Execute command in pod
kubectl exec -it <pod-name> -n secure-video -- /bin/sh

# Get events
kubectl get events -n secure-video --sort-by='.lastTimestamp'
```

### Backup & Restore

**MongoDB Backup**:
```bash
# Create backup
kubectl exec -n secure-video mongodb-0 -- mongodump --uri="mongodb://admin:password@localhost:27017" --out=/tmp/backup

# Copy backup to local
kubectl cp secure-video/mongodb-0:/tmp/backup ./mongodb-backup
```

**MongoDB Restore**:
```bash
# Copy backup to pod
kubectl cp ./mongodb-backup secure-video/mongodb-0:/tmp/restore

# Restore
kubectl exec -n secure-video mongodb-0 -- mongorestore --uri="mongodb://admin:password@localhost:27017" /tmp/restore
```

## 🔒 Security

### Secrets Management

**Never commit secrets to Git!**

Use external secret management:
- **Sealed Secrets**: Encrypt secrets in Git
- **External Secrets Operator**: Sync from cloud secret managers
- **Vault**: HashiCorp Vault integration

Example with Sealed Secrets:
```bash
# Install Sealed Secrets
kubectl apply -f https://github.com/bitnami-labs/sealed-secrets/releases/download/v0.24.0/controller.yaml

# Seal a secret
kubeseal -f secrets/app-secret.yaml -w secrets/app-sealed-secret.yaml
```

### Network Policies

Network policies are configured to:
- Deny all traffic by default
- Allow only necessary connections
- Isolate database from direct external access

Enable network policies:
```bash
kubectl apply -f network-policies/
```

### Pod Security

All pods are configured with:
- Non-root user (UID 1001)
- Read-only root filesystem
- Dropped capabilities
- No privilege escalation

## 📈 Monitoring

### Prometheus

Access Prometheus:
```bash
kubectl port-forward -n secure-video svc/prometheus-service 9090:9090
```

Open: http://localhost:9090

### Grafana

Access Grafana:
```bash
kubectl port-forward -n secure-video svc/grafana-service 3001:3000
```

Open: http://localhost:3001
- Username: `admin`
- Password: `grafana123` (change in production!)

### Metrics

Check pod metrics:
```bash
kubectl top pods -n secure-video
kubectl top nodes
```

## 🛠️ Troubleshooting

### Pods not starting

```bash
# Check pod status
kubectl get pods -n secure-video

# Describe pod to see events
kubectl describe pod <pod-name> -n secure-video

# Check logs
kubectl logs <pod-name> -n secure-video
```

Common issues:
- **ImagePullBackOff**: Check image name and registry credentials
- **CrashLoopBackOff**: Check application logs
- **Pending**: Check resource requests and available node resources

### Database connection issues

```bash
# Test MongoDB connection
kubectl exec -it mongodb-0 -n secure-video -- mongosh -u admin -p

# Test Redis connection
kubectl exec -it redis-0 -n secure-video -- redis-cli -a <password> ping
```

### Service not accessible

```bash
# Check service endpoints
kubectl get endpoints -n secure-video

# Test service internally
kubectl run -it --rm debug --image=curlimages/curl --restart=Never -n secure-video -- curl http://app-service:3000/api/health
```

## 🔄 CI/CD Integration

### GitHub Actions Example

```yaml
name: Deploy to Kubernetes

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Set up kubectl
        uses: azure/setup-kubectl@v3
        
      - name: Configure kubectl
        run: |
          echo "${{ secrets.KUBE_CONFIG }}" | base64 -d > kubeconfig
          export KUBECONFIG=kubeconfig
          
      - name: Deploy
        run: |
          cd k8s/scripts
          ./deploy-all.sh prod
```

## 🌍 Multi-Environment Setup

### Using Kustomize

```bash
# Development
kubectl apply -k overlays/dev/

# Production
kubectl apply -k overlays/prod/
```

### Using Helm (recommended)

Convert to Helm chart for better management:
```bash
helm create secure-video-platform
# Move resources to templates/
helm install secure-video ./secure-video-platform -n secure-video
```

## 📝 Production Checklist

- [ ] Update all secrets with strong passwords
- [ ] Configure SSL/TLS certificates
- [ ] Set up DNS records
- [ ] Enable network policies
- [ ] Configure resource limits
- [ ] Set up monitoring alerts
- [ ] Configure backup strategy
- [ ] Enable pod disruption budgets
- [ ] Set up logging (ELK/Loki)
- [ ] Configure auto-scaling
- [ ] Review security policies
- [ ] Set up CI/CD pipeline
- [ ] Document disaster recovery plan

## 🆘 Support

For issues:
1. Check logs: `kubectl logs -f <pod-name> -n secure-video`
2. Check events: `kubectl get events -n secure-video`
3. Review configuration files
4. Check cluster resources: `kubectl top nodes`

## 📚 Additional Resources

- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [Kubectl Cheat Sheet](https://kubernetes.io/docs/reference/kubectl/cheatsheet/)
- [Best Practices](https://kubernetes.io/docs/concepts/configuration/overview/)
- [Security Best Practices](https://kubernetes.io/docs/concepts/security/security-checklist/)

## 🔐 License

[Your License Here]