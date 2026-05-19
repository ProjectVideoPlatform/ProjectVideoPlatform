# ── Static Config ──────────────────────────────────────────
PORT=3000
NODE_ENV=production
JWT_EXPIRES_IN=1d
IDEMPOTENCY_KEY_EXPIRY=3600
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
LOCK_EXPIRY_MS=5000
LOG_LEVEL=debug

RABBITMQ_URL=amqp://guest:guest@rabbitmq:5672
KAFKA_BROKERS=kafka:9092
KAFKA_TOPIC=video-logs
ML_TOPIC=user-activities
RECOMMENDATION_GRPC_HOST=recommendation-service:50051

ELASTIC_APM_SERVICE_NAME=my-securevideo-backend
ELASTIC_APM_ENVIRONMENT=development
ELASTIC_APM_ACTIVE=true

UPLOADS_BUCKET=photong
HLS_OUTPUT_BUCKET=hls-output-bucket-photong
MEDIACONVERT_ENDPOINT=https://mediaconvert.us-east-1.amazonaws.com
CLOUDFRONT_DOMAIN=cdn.toteja.co
CLOUDFRONT_KEY_PAIR_ID=KM18YXD93MX5V
CLOUDFRONT_PRIVATE_KEY_PATH=/app/keys/cloudfront-private-key.pem

PROJECT_ID=1
COLLECTION_AGENT=b329e4682f5a4731bb28e4719291303e.profiling.ap-southeast-1.aws.cloud.es.io
COLLECTION_PORT=443

# ── Secrets from Vault ─────────────────────────────────────

# 💾 MongoDB Dynamic Credentials
{{ with secret "database/creds/backend-role" }}
MONGO_USERNAME="{{ .Data.username }}"
MONGO_PASSWORD="{{ .Data.password }}"
MONGO_URI="mongodb://{{ .Data.username }}:{{ .Data.password }}@mongodb1:27017,mongodb2:27017,mongodb3:27017/secure-video?replicaSet=rs0"
{{ end }}
MONGO_DB=secure-video
MONGO_REPLICA_SET=rs0

# 🔴 Redis Secrets
{{ with secret "secret/data/redis/main" }}
REDIS_URL="{{ .Data.data.REDIS_URL }}"
REDIS_HOST="{{ .Data.data.REDIS_HOST }}"
REDIS_PORT="{{ .Data.data.REDIS_PORT }}"
REDIS_PASSWORD="{{ .Data.data.REDIS_PASSWORD }}"
{{ end }}

# ☁️ AWS Secrets
{{ with secret "secret/data/aws/main" }}
AWS_ACCESS_KEY_ID="{{ .Data.data.AWS_ACCESS_KEY_ID }}"
AWS_SECRET_ACCESS_KEY="{{ .Data.data.AWS_SECRET_ACCESS_KEY }}"
AWS_REGION="{{ .Data.data.AWS_REGION }}"
MEDIACONVERT_ROLE="{{ .Data.data.MEDIACONVERT_ROLE }}"
MEDIACONVERT_QUEUE_ARN="{{ .Data.data.MEDIACONVERT_QUEUE_ARN }}"
{{ end }}

# 🔑 JWT Secrets
{{ with secret "secret/data/jwt/main" }}
JWT_SECRET="{{ .Data.data.JWT_SECRET }}"
JWT_REFRESH_SECRET="{{ .Data.data.JWT_REFRESH_SECRET }}"
{{ end }}

# 💳 Stripe Secrets
{{ with secret "secret/data/stripe/production" }}
STRIPE_SECRET_KEY="{{ .Data.data.STRIPE_SECRET_KEY }}"
STRIPE_WEBHOOK_SECRET="{{ .Data.data.STRIPE_WEBHOOK_SECRET }}"
{{ end }}

# 🌐 CloudFront Keys
{{ with secret "secret/data/cloudfront/keys" }}
CLOUDFRONT_PRIVATE_KEY="{{ .Data.data.CLOUDFRONT_PRIVATE_KEY }}"
{{ end }}

# 📧 Email Secrets
{{ with secret "secret/data/email/gmail" }}
EMAIL_USER="{{ .Data.data.EMAIL_USER }}"
EMAIL_APP_PASSWORD="{{ .Data.data.EMAIL_APP_PASSWORD }}"
{{ end }}

# 🌲 Pinecone Secrets
{{ with secret "secret/data/pinecone/main" }}
PINECONE_API_KEY="{{ .Data.data.PINECONE_API_KEY }}"
PINECONE_ENVIRONMENT="{{ .Data.data.PINECONE_ENVIRONMENT }}"
{{ end }}

# 🔍 Elasticsearch & APM Secrets (จุดเสี่ยงที่มีตัวแปรแปลกปลอม)
{{ with secret "secret/data/elasticsearch/backend" }}
ELASTICSEARCH_URL="{{ .Data.data.ELASTICSEARCH_URL }}"
ELASTIC_PASSWORD="{{ .Data.data.ELASTIC_PASSWORD }}"
ELASTIC_CLOUD_ID="{{ .Data.data.ELASTIC_CLOUD_ID }}"
ELASTICSEARCH_API_KEY="{{ .Data.data.ELASTICSEARCH_API_KEY }}"
ELASTIC_APM_SERVER_URL="{{ .Data.data.ELASTIC_APM_SERVER_URL }}"
ELASTIC_APM_SECRET_TOKEN="{{ .Data.data.ELASTIC_APM_SECRET_TOKEN }}"
SECRET_TOKEN="{{ .Data.data.SECRET_TOKEN }}"
{{ end }}