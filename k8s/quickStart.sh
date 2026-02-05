#!/bin/bash

# Quick Start Script for Secure Video Platform on Kubernetes
# This script helps you get started quickly

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}"
cat << "EOF"
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   Secure Video Platform - Kubernetes Quick Start         ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
EOF
echo -e "${NC}"

# Functions
print_step() {
    echo -e "\n${BLUE}==>${NC} ${GREEN}$1${NC}"
}

print_info() {
    echo -e "${YELLOW}ℹ${NC}  $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

check_command() {
    if ! command -v $1 &> /dev/null; then
        return 1
    fi
    return 0
}

# Check prerequisites
print_step "Checking prerequisites..."

if ! check_command kubectl; then
    print_error "kubectl is not installed"
    echo "Install with: https://kubernetes.io/docs/tasks/tools/"
    exit 1
fi
print_success "kubectl is installed"

if ! kubectl cluster-info &> /dev/null; then
    print_error "Cannot connect to Kubernetes cluster"
    echo ""
    echo "Please ensure you have a Kubernetes cluster running:"
    echo "  - Local: minikube start"
    echo "  - Cloud: configure kubectl with your cloud provider"
    exit 1
fi
print_success "Connected to Kubernetes cluster"

# Show cluster info
CLUSTER_INFO=$(kubectl cluster-info | head -1)
print_info "Cluster: $CLUSTER_INFO"

# Ask for environment
echo ""
echo "Select deployment environment:"
echo "  1) Development (includes dev tools)"
echo "  2) Production (with monitoring)"
echo "  3) Minimal (basic setup only)"
read -p "Enter choice [1-3]: " env_choice

case $env_choice in
    1) ENVIRONMENT="dev" ;;
    2) ENVIRONMENT="prod" ;;
    3) ENVIRONMENT="minimal" ;;
    *) 
        print_error "Invalid choice"
        exit 1
        ;;
esac

print_success "Selected: $ENVIRONMENT environment"

# Check if secrets need updating
print_step "Checking secrets..."
if grep -q "securepassword123" secrets/mongodb-secret.yaml; then
    print_error "Default passwords detected in secrets!"
    echo ""
    read -p "Do you want to generate secure passwords? (y/n): " gen_pass
    
    if [ "$gen_pass" = "y" ]; then
        print_info "Generating secure passwords..."
        
        MONGO_PASS=$(openssl rand -base64 24)
        REDIS_PASS=$(openssl rand -base64 24)
        JWT_SECRET=$(openssl rand -base64 32)
        
        # Update secrets
        sed -i.bak "s/securepassword123/$MONGO_PASS/g" secrets/mongodb-secret.yaml
        sed -i.bak "s/redispassword123/$REDIS_PASS/g" secrets/redis-secret.yaml
        sed -i.bak "s/your-jwt-secret-here/$JWT_SECRET/g" secrets/app-secret.yaml
        
        print_success "Passwords generated and updated"
        print_info "Backup files created with .bak extension"
        
        echo ""
        echo "Generated passwords (save these!):"
        echo "  MongoDB: $MONGO_PASS"
        echo "  Redis: $REDIS_PASS"
        echo "  JWT: $JWT_SECRET"
        echo ""
        read -p "Press Enter to continue..."
    else
        print_info "Please update secrets manually before deploying to production"
        read -p "Press Enter to continue..."
    fi
fi

# Ask for domain configuration
print_step "Domain configuration..."
read -p "Enter your domain (or press Enter for default 'localhost'): " DOMAIN
if [ -z "$DOMAIN" ]; then
    DOMAIN="localhost"
fi

print_info "Domain: $DOMAIN"

# Update ingress
if [ "$DOMAIN" != "localhost" ] && [ "$DOMAIN" != "yourdomain.com" ]; then
    print_info "Updating Ingress configuration..."
    sed -i.bak "s/yourdomain.com/$DOMAIN/g" ingress/ingress.yaml
    print_success "Ingress updated"
fi

# Confirmation
echo ""
print_step "Deployment Summary"
echo "  Environment: $ENVIRONMENT"
echo "  Domain: $DOMAIN"
echo "  Namespace: secure-video"
echo ""
read -p "Proceed with deployment? (y/n): " confirm

if [ "$confirm" != "y" ]; then
    echo "Deployment cancelled"
    exit 0
fi

# Start deployment
print_step "Starting deployment..."

# Create namespace
print_info "Creating namespace..."
kubectl apply -f namespaces/namespace.yaml
print_success "Namespace created"

# Create secrets
print_info "Creating secrets..."
kubectl apply -f secrets/
print_success "Secrets created"

# Create ConfigMaps
print_info "Creating ConfigMaps..."
kubectl apply -f configmaps/
print_success "ConfigMaps created"

# Create storage
print_info "Creating storage..."
kubectl apply -f storage/
print_success "Storage created"

# Wait for PVCs
print_info "Waiting for PVCs to be bound..."
sleep 5
kubectl wait --for=condition=Bound pvc --all -n secure-video --timeout=60s 2>/dev/null || print_info "Some PVCs still pending..."

# Deploy databases
print_info "Deploying databases..."
kubectl apply -f deployments/mongodb-deployment.yaml
kubectl apply -f deployments/redis-deployment.yaml
print_success "Databases deployed"

# Wait for databases
print_info "Waiting for databases to be ready..."
kubectl wait --for=condition=ready pod -l app=mongodb -n secure-video --timeout=120s 2>/dev/null || print_info "MongoDB still starting..."
kubectl wait --for=condition=ready pod -l app=redis -n secure-video --timeout=120s 2>/dev/null || print_info "Redis still starting..."

# Create services
print_info "Creating services..."
kubectl apply -f services/
print_success "Services created"

# Deploy application
print_info "Deploying application..."
kubectl apply -f deployments/app-deployment.yaml
kubectl apply -f deployments/react-app-deployment.yaml
kubectl apply -f deployments/nginx-deployment.yaml
print_success "Application deployed"

# Deploy ingress
print_info "Creating ingress..."
kubectl apply -f ingress/ingress.yaml
print_success "Ingress created"

# Environment-specific deployments
if [ "$ENVIRONMENT" = "dev" ]; then
    print_info "Deploying development tools..."
    kubectl apply -f dev/
    print_success "Development tools deployed"
fi

if [ "$ENVIRONMENT" = "prod" ]; then
    print_info "Deploying monitoring..."
    kubectl apply -f monitoring/
    print_success "Monitoring deployed"
    
    print_info "Deploying autoscaling..."
    kubectl apply -f autoscaling/
    print_success "Autoscaling configured"
fi

# Wait for deployments
print_info "Waiting for deployments to be ready..."
sleep 10
kubectl wait --for=condition=available deployment --all -n secure-video --timeout=300s 2>/dev/null || print_info "Some deployments still starting..."

# Show status
print_step "Deployment Status"
kubectl get all -n secure-video

echo ""
print_step "Deployment Complete! 🎉"

# Access information
echo ""
echo -e "${GREEN}Access Information:${NC}"
echo ""

if [ "$DOMAIN" = "localhost" ]; then
    echo "Since you're using localhost, you'll need to use port-forwarding:"
    echo ""
    echo "  # Frontend"
    echo "  kubectl port-forward -n secure-video svc/react-app-service 5173:5173"
    echo "  Access: http://localhost:5173"
    echo ""
    echo "  # Backend API"
    echo "  kubectl port-forward -n secure-video svc/app-service 3000:3000"
    echo "  Access: http://localhost:3000"
    echo ""
    echo "  # Nginx (All-in-one)"
    echo "  kubectl port-forward -n secure-video svc/nginx-service 8080:80"
    echo "  Access: http://localhost:8080"
    echo ""
    
    if [ "$ENVIRONMENT" = "dev" ]; then
        echo "  # Mongo Express"
        echo "  kubectl port-forward -n secure-video svc/mongo-express-service 8081:8081"
        echo "  Access: http://localhost:8081"
        echo "  Login: admin / admin123"
        echo ""
    fi
    
    if [ "$ENVIRONMENT" = "prod" ]; then
        echo "  # Grafana"
        echo "  kubectl port-forward -n secure-video svc/grafana-service 3001:3000"
        echo "  Access: http://localhost:3001"
        echo "  Login: admin / grafana123"
        echo ""
    fi
    
    echo "Or use the helper script:"
    echo "  cd scripts && ./port-forward.sh"
else
    echo "Your application will be available at:"
    echo "  http://$DOMAIN"
    echo ""
    echo "Make sure your DNS is configured to point to your cluster's ingress IP:"
    INGRESS_IP=$(kubectl get svc -n ingress-nginx ingress-nginx-controller -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "pending...")
    echo "  Ingress IP: $INGRESS_IP"
fi

echo ""
echo -e "${GREEN}Useful Commands:${NC}"
echo "  make status         # Check deployment status"
echo "  make logs-app       # View application logs"
echo "  make port-forward   # Port forward services"
echo "  make help           # See all available commands"
echo ""
echo "  kubectl get pods -n secure-video"
echo "  kubectl logs -f <pod-name> -n secure-video"
echo "  kubectl describe pod <pod-name> -n secure-video"
echo ""

echo -e "${YELLOW}Next Steps:${NC}"
echo "  1. Update secrets with production values (if not done)"
echo "  2. Configure SSL/TLS certificates"
echo "  3. Set up monitoring alerts"
echo "  4. Configure backup strategy"
echo "  5. Review security policies"
echo ""

echo -e "${BLUE}Documentation:${NC}"
echo "  README.md           # Full documentation"
echo "  DEPLOYMENT_GUIDE.md # Detailed deployment guide"
echo ""

echo -e "${GREEN}Happy coding! 🚀${NC}"