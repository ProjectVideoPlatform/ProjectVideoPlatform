FROM python:3.9-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt .
RUN pip install --no-cache-dir --default-timeout=100 -r requirements.txt

# Copy source code
COPY worker.py .

# Environment variables (set defaults)
ENV KAFKA_BROKERS=kafka:9092 \
    REDIS_HOST=redis \
    REDIS_PASSWORD=redispassword123 \
    PINECONE_API_KEY=""

# Run worker
CMD ["python", "-u", "worker.py"]