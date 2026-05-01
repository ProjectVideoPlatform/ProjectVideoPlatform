FROM python:3.12-slim

WORKDIR /app

# ── System deps ───────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# ── Python deps ───────────────────────────────────────────
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ── App code ──────────────────────────────────────────────
COPY user-vector-producer.py .
COPY user-vector-worker.py .

# Default: worker (override ใน docker-compose command:)
CMD ["python", "user-vector-worker.py"]