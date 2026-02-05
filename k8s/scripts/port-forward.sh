#!/bin/bash

# Port forwarding helper for local development
# Usage: ./port-forward.sh

NAMESPACE="secure-video"

echo "======================================"
echo "Port Forwarding Helper"
echo "======================================"
echo ""
echo "Available services:"
echo "1. Frontend (React App)     - localhost:5173"
echo "2. Backend API              - localhost:3000"
echo "3. MongoDB                  - localhost:27017"
echo "4. Redis                    - localhost:6379"
echo "5. Mongo Express            - localhost:8081"
echo "6. Prometheus               - localhost:9090"
echo "7. Grafana                  - localhost:3001"
echo "8. Nginx                    - localhost:8080"
echo "9. All (multiple terminals)"
echo ""
read -p "Select service to forward (1-9): " choice

case $choice in
    1)
        echo "Forwarding React App..."
        kubectl port-forward -n $NAMESPACE svc/react-app-service 5173:5173
        ;;
    2)
        echo "Forwarding Backend API..."
        kubectl port-forward -n $NAMESPACE svc/app-service 3000:3000
        ;;
    3)
        echo "Forwarding MongoDB..."
        kubectl port-forward -n $NAMESPACE svc/mongodb-service 27017:27017
        ;;
    4)
        echo "Forwarding Redis..."
        kubectl port-forward -n $NAMESPACE svc/redis-service 6379:6379
        ;;
    5)
        echo "Forwarding Mongo Express..."
        kubectl port-forward -n $NAMESPACE svc/mongo-express-service 8081:8081
        ;;
    6)
        echo "Forwarding Prometheus..."
        kubectl port-forward -n $NAMESPACE svc/prometheus-service 9090:9090
        ;;
    7)
        echo "Forwarding Grafana..."
        kubectl port-forward -n $NAMESPACE svc/grafana-service 3001:3000
        ;;
    8)
        echo "Forwarding Nginx..."
        kubectl port-forward -n $NAMESPACE svc/nginx-service 8080:80
        ;;
    9)
        echo "Opening multiple terminals required..."
        echo "Run these commands in separate terminals:"
        echo ""
        echo "kubectl port-forward -n $NAMESPACE svc/react-app-service 5173:5173"
        echo "kubectl port-forward -n $NAMESPACE svc/app-service 3000:3000"
        echo "kubectl port-forward -n $NAMESPACE svc/nginx-service 8080:80"
        echo "kubectl port-forward -n $NAMESPACE svc/mongo-express-service 8081:8081"
        ;;
    *)
        echo "Invalid choice"
        exit 1
        ;;
esac