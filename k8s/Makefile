.PHONY: help deploy deploy-dev deploy-prod clean logs status port-forward build push

# Variables
NAMESPACE := secure-video
REGISTRY := your-registry.com  # Change this
IMAGE_NAME := secure-video-app
VERSION := latest

# Colors
GREEN := \033[0;32m
YELLOW := \033[1;33m
NC := \033[0m

help: ## Show this help message
	@echo "$(GREEN)Secure Video Platform - Kubernetes Deployment$(NC)"
	@echo ""
	@echo "Available targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-20s$(NC) %s\n", $$1, $$2}'

check-prereqs: ## Check prerequisites
	@echo "$(GREEN)Checking prerequisites...$(NC)"
	@which kubectl > /dev/null || (echo "$(YELLOW)kubectl not found$(NC)" && exit 1)
	@kubectl cluster-info > /dev/null 2>&1 || (echo "$(YELLOW)Cannot connect to cluster$(NC)" && exit 1)
	@echo "$(GREEN)✓ All prerequisites met$(NC)"

build: ## Build Docker image
	@echo "$(GREEN)Building Docker image...$(NC)"
	docker build -f docker/Dockerfile -t $(IMAGE_NAME):$(VERSION) ../BackEnd

push: build ## Build and push Docker image
	@echo "$(GREEN)Pushing Docker image...$(NC)"
	docker tag $(IMAGE_NAME):$(VERSION) $(REGISTRY)/$(IMAGE_NAME):$(VERSION)
	docker push $(REGISTRY)/$(IMAGE_NAME):$(VERSION)

deploy: check-prereqs ## Deploy all resources (production)
	@echo "$(GREEN)Deploying to Kubernetes (production)...$(NC)"
	@cd scripts && ./deploy-all.sh prod

deploy-dev: check-prereqs ## Deploy for development
	@echo "$(GREEN)Deploying to Kubernetes (development)...$(NC)"
	@cd scripts && ./deploy-all.sh dev

deploy-monitoring: check-prereqs ## Deploy monitoring stack only
	@echo "$(GREEN)Deploying monitoring stack...$(NC)"
	kubectl apply -f monitoring/

clean: ## Clean up all resources
	@echo "$(YELLOW)Cleaning up...$(NC)"
	@cd scripts && ./cleanup.sh

status: ## Show deployment status
	@echo "$(GREEN)Deployment Status:$(NC)"
	@kubectl get all -n $(NAMESPACE)
	@echo ""
	@echo "$(GREEN)Ingress:$(NC)"
	@kubectl get ingress -n $(NAMESPACE)

logs: ## Show logs for all pods
	@echo "$(GREEN)Recent logs:$(NC)"
	@kubectl logs -n $(NAMESPACE) -l tier=backend --tail=50

logs-app: ## Show backend app logs
	@kubectl logs -n $(NAMESPACE) -l app=backend-app --tail=100 -f

logs-mongodb: ## Show MongoDB logs
	@kubectl logs -n $(NAMESPACE) -l app=mongodb --tail=100 -f

logs-redis: ## Show Redis logs
	@kubectl logs -n $(NAMESPACE) -l app=redis --tail=100 -f

port-forward: ## Port forward services
	@cd scripts && ./port-forward.sh

port-forward-app: ## Port forward backend app only
	@kubectl port-forward -n $(NAMESPACE) svc/app-service 3000:3000

port-forward-frontend: ## Port forward frontend only
	@kubectl port-forward -n $(NAMESPACE) svc/react-app-service 5173:5173

port-forward-mongo: ## Port forward MongoDB
	@kubectl port-forward -n $(NAMESPACE) svc/mongodb-service 27017:27017

port-forward-redis: ## Port forward Redis
	@kubectl port-forward -n $(NAMESPACE) svc/redis-service 6379:6379

shell-app: ## Get shell in backend pod
	@kubectl exec -it -n $(NAMESPACE) $$(kubectl get pod -n $(NAMESPACE) -l app=backend-app -o jsonpath='{.items[0].metadata.name}') -- /bin/sh

shell-mongodb: ## Get shell in MongoDB pod
	@kubectl exec -it -n $(NAMESPACE) mongodb-0 -- mongosh -u admin -p

scale-app: ## Scale backend app (usage: make scale-app REPLICAS=5)
	@kubectl scale deployment app -n $(NAMESPACE) --replicas=$(REPLICAS)

restart-app: ## Restart backend app
	@kubectl rollout restart deployment/app -n $(NAMESPACE)

restart-all: ## Restart all deployments
	@kubectl rollout restart deployment -n $(NAMESPACE)

describe-pod: ## Describe pods (usage: make describe-pod POD=pod-name)
	@kubectl describe pod $(POD) -n $(NAMESPACE)

events: ## Show recent events
	@kubectl get events -n $(NAMESPACE) --sort-by='.lastTimestamp'

top: ## Show resource usage
	@echo "$(GREEN)Node Resources:$(NC)"
	@kubectl top nodes
	@echo ""
	@echo "$(GREEN)Pod Resources:$(NC)"
	@kubectl top pods -n $(NAMESPACE)

hpa-status: ## Show HPA status
	@kubectl get hpa -n $(NAMESPACE)

backup-mongodb: ## Backup MongoDB
	@echo "$(GREEN)Creating MongoDB backup...$(NC)"
	@kubectl exec -n $(NAMESPACE) mongodb-0 -- mongodump --uri="mongodb://admin:securepassword123@localhost:27017" --out=/tmp/backup
	@kubectl cp $(NAMESPACE)/mongodb-0:/tmp/backup ./backups/mongodb-$$(date +%Y%m%d-%H%M%S)
	@echo "$(GREEN)Backup completed$(NC)"

watch: ## Watch pods status
	@watch -n 2 kubectl get pods -n $(NAMESPACE)

update-secrets: ## Update secrets from files
	@echo "$(GREEN)Updating secrets...$(NC)"
	@kubectl apply -f secrets/

update-config: ## Update ConfigMaps
	@echo "$(GREEN)Updating ConfigMaps...$(NC)"
	@kubectl apply -f configmaps/
	@echo "$(YELLOW)Remember to restart pods to pick up changes$(NC)"

rollback-app: ## Rollback app deployment
	@kubectl rollout undo deployment/app -n $(NAMESPACE)
	@kubectl rollout status deployment/app -n $(NAMESPACE)

test-endpoints: ## Test if endpoints are accessible
	@echo "$(GREEN)Testing endpoints...$(NC)"
	@kubectl run -it --rm test-pod --image=curlimages/curl --restart=Never -n $(NAMESPACE) -- sh -c "\
		echo 'Testing backend API...' && \
		curl -v http://app-service:3000/api/health && \
		echo '' && \
		echo 'Testing frontend...' && \
		curl -v http://react-app-service:5173"

install-ingress: ## Install Nginx Ingress Controller
	@echo "$(GREEN)Installing Nginx Ingress Controller...$(NC)"
	@kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.8.1/deploy/static/provider/cloud/deploy.yaml

install-metrics: ## Install Metrics Server
	@echo "$(GREEN)Installing Metrics Server...$(NC)"
	@kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

install-cert-manager: ## Install Cert Manager for SSL
	@echo "$(GREEN)Installing Cert Manager...$(NC)"
	@kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml

docs: ## Open documentation
	@echo "$(GREEN)Opening documentation...$(NC)"
	@cat README.md | less