# Dockerfile.embedder
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN pip install --no-cache-dir \
    torch \
    --extra-index-url https://download.pytorch.org/whl/cpu

RUN pip install --no-cache-dir -r requirements.txt

COPY worker.py .

ENV PYTHONUNBUFFERED=1
# ✅ ให้ download model ตอน container start แทน
# โดย cache ไว้ใน volume แทนการ bake เข้า image
ENV TRANSFORMERS_CACHE=/app/model-cache
ENV SENTENCE_TRANSFORMERS_HOME=/app/model-cache

CMD ["python", "-u", "worker.py"]