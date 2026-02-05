#!/bin/bash

# Cleanup all Kubernetes resources for Secure Video Platform
# Usage: ./cleanup.sh

set -e

NAMESPACE="secure-video"

echo "======================================"
echo "Cleaning up Secure Video Platform"
echo "Namespace: $NAMESPACE"
echo "======================================"

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

# Confirm deletion
read -p "Are you sure you want to delete all resources in namespace '$NAMESPACE'? (yes/no): " confirm
if [ "$confirm" != "yes" ]; then
    echo "Cleanup cancelled."
    exit 0
fi

print_warning "Starting cleanup..."

# Delete Ingress
echo ""
echo "Deleting Ingress..."
kubectl delete -f ../ingress/ --ignore-not-found=true
print_status "Ingress deleted"

# Delete Deployments
echo ""
echo "Deleting deployments..."
kubectl delete -f ../deployments/ --ignore-not-found=true
print_status "Deployments deleted"

# Delete Services
echo ""
echo "Deleting services..."
kubectl delete -f ../services/ --ignore-not-found=true
print_status "Services deleted"

# Delete Monitoring
echo ""
echo "Deleting monitoring stack..."
kubectl delete -f ../monitoring/ --ignore-not-found=true
print_status "Monitoring stack deleted"

# Delete Dev tools
echo ""
echo "Deleting dev tools..."
kubectl delete -f ../dev/ --ignore-not-found=true
print_status "Dev tools deleted"

# Delete ConfigMaps
echo ""
echo "Deleting ConfigMaps..."
kubectl delete -f ../configmaps/ --ignore-not-found=true
print_status "ConfigMaps deleted"

# Ask about PVCs
read -p "Do you want to delete PersistentVolumeClaims (this will delete data)? (yes/no): " delete_pvc
if [ "$delete_pvc" == "yes" ]; then
    echo ""
    echo "Deleting PVCs..."
    kubectl delete -f ../storage/ --ignore-not-found=true
    print_status "PVCs deleted"
else
    print_warning "PVCs retained"
fi

# Ask about Secrets
read -p "Do you want to delete Secrets? (yes/no): " delete_secrets
if [ "$delete_secrets" == "yes" ]; then
    echo ""
    echo "Deleting secrets..."
    kubectl delete -f ../secrets/ --ignore-not-found=true
    print_status "Secrets deleted"
else
    print_warning "Secrets retained"
fi

# Ask about Namespace
read -p "Do you want to delete the namespace '$NAMESPACE'? (yes/no): " delete_namespace
if [ "$delete_namespace" == "yes" ]; then
    echo ""
    echo "Deleting namespace..."
    kubectl delete namespace $NAMESPACE --ignore-not-found=true
    print_status "Namespace deleted"
else
    print_warning "Namespace retained"
fi

echo ""
echo "======================================"
print_status "Cleanup completed!"
echo "======================================"