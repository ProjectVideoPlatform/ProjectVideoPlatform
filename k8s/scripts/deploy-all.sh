#!/bin/bash

# Deploy all Kubernetes resources for Secure Video Platform
# Usage: ./deploy-all.sh [environment]
# Environment: dev, staging, prod (default: prod)

set -e

ENV=${1:-prod}
NAMESPACE="secure-video"

echo "======================================"
echo "Deploying Secure Video Platform"
echo "Environment: $ENV"
echo "Namespace: $NAMESPACE"
echo "======================================"

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

# Check if kubectl is installed
if ! command -v kubectl &> /dev/null; then
    print_error "kubectl is not installed. Please install kubectl first."
    exit 1
fi

# Check if cluster is accessible
if ! kubectl cluster-info &> /dev/null; then
    print_error "Cannot connect to Kubernetes cluster. Please check your kubeconfig."
    exit 1
fi

print_status "Kubernetes cluster is accessible"

# Create namespace
echo ""
echo "Step 1: Creating namespace..."
kubectl apply -f ../namespaces/namespace.yaml
print_status "Namespace created"

# Create secrets
echo ""
echo "Step 2: Creating secrets..."
print_warning "Make sure to update secrets with production values!"
kubectl apply -f ../secrets/
print_status "Secrets created"

# Create ConfigMaps
echo ""
echo "Step 3: Creating ConfigMaps..."
kubectl apply -f ../configmaps/
print_status "ConfigMaps created"

# Create Storage (PV & PVC)
echo ""
echo "Step 4: Creating storage resources..."
kubectl apply -f ../storage/
print_status "Storage resources created"

# Wait for PVCs to be bound
echo ""
echo "Waiting for PVCs to be bound..."
kubectl wait --for=condition=Bound pvc --all -n $NAMESPACE --timeout=60s || print_warning "Some PVCs are not bound yet"

# Deploy databases and cache
echo ""
echo "Step 5: Deploying databases and cache..."
kubectl apply -f ../deployments/mongodb-deployment.yaml
kubectl apply -f ../deployments/redis-deployment.yaml
print_status "Databases deployed"

# Wait for databases to be ready
echo ""
echo "Waiting for databases to be ready..."
kubectl wait --for=condition=ready pod -l app=mongodb -n $NAMESPACE --timeout=120s
kubectl wait --for=condition=ready pod -l app=redis -n $NAMESPACE --timeout=120s
print_status "Databases are ready"

# Create services
echo ""
echo "Step 6: Creating services..."
kubectl apply -f ../services/
print_status "Services created"

# Deploy application
echo ""
echo "Step 7: Deploying backend application..."
kubectl apply -f ../deployments/app-deployment.yaml
print_status "Backend application deployed"

# Deploy frontend
echo ""
echo "Step 8: Deploying frontend application..."
kubectl apply -f ../deployments/react-app-deployment.yaml
print_status "Frontend application deployed"

# Deploy Nginx
echo ""
echo "Step 9: Deploying Nginx reverse proxy..."
kubectl apply -f ../deployments/nginx-deployment.yaml
print_status "Nginx deployed"

# Deploy Ingress
echo ""
echo "Step 10: Creating Ingress..."
kubectl apply -f ../ingress/ingress.yaml
print_status "Ingress created"

# Deploy monitoring (if enabled)
if [ "$ENV" == "prod" ] || [ "$ENV" == "staging" ]; then
    echo ""
    echo "Step 11: Deploying monitoring stack..."
    kubectl apply -f ../monitoring/prometheus.yaml
    kubectl apply -f ../monitoring/grafana.yaml
    print_status "Monitoring stack deployed"
fi

# Deploy dev tools (if dev environment)
if [ "$ENV" == "dev" ]; then
    echo ""
    echo "Step 12: Deploying development tools..."
    kubectl apply -f ../dev/mongo-express.yaml
    print_status "Development tools deployed"
fi

# Wait for all deployments to be ready
echo ""
echo "Waiting for all deployments to be ready..."
kubectl wait --for=condition=available deployment --all -n $NAMESPACE --timeout=300s || print_warning "Some deployments are not ready yet"

# Display deployment status
echo ""
echo "======================================"
echo "Deployment Status"
echo "======================================"
kubectl get all -n $NAMESPACE

echo ""
echo "======================================"
echo "Ingress Information"
echo "======================================"
kubectl get ingress -n $NAMESPACE

echo ""
echo "======================================"
print_status "Deployment completed successfully!"
echo "======================================"

echo ""
echo "Next steps:"
echo "1. Update DNS records to point to your Ingress IP/hostname"
echo "2. Configure SSL certificates (if not using cert-manager)"
echo "3. Update secrets with production values"
echo "4. Review and adjust resource limits"
echo "5. Set up monitoring alerts"

echo ""
echo "Useful commands:"
echo "  kubectl get pods -n $NAMESPACE"
echo "  kubectl logs -f <pod-name> -n $NAMESPACE"
echo "  kubectl describe pod <pod-name> -n $NAMESPACE"
echo "  kubectl exec -it <pod-name> -n $NAMESPACE -- /bin/sh"

if [ "$ENV" == "dev" ]; then
    echo ""
    print_warning "Development environment detected!"
    echo "Access Mongo Express: kubectl port-forward svc/mongo-express-service 8081:8081 -n $NAMESPACE"
fi