# Dockerfile.embedder
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# ติดตั้ง torch CPU-only ก่อน แยก step
# ป้องกัน pip ดึง torch+cuda มาแทน (~3GB)
RUN pip install --no-cache-dir \
    torch \
    --extra-index-url https://download.pytorch.org/whl/cpu

# ติดตั้งที่เหลือ
RUN pip install --no-cache-dir -r requirements.txt

# pre-download model ตอน build
RUN python -c "\
    from sentence_transformers import SentenceTransformer; \
    SentenceTransformer('all-MiniLM-L6-v2')"

COPY worker.py .

ENV PYTHONUNBUFFERED=1

CMD ["python", "-u", "worker.py"]