# ─── Stage 1: Builder ───
FROM python:3.9-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential gcc \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir --default-timeout=100 -r requirements.txt

# ─── Stage 2: Final ───
FROM python:3.9-slim

RUN useradd --create-home appuser
WORKDIR /app

COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY worker.py .
RUN chown -R appuser:appuser /app
USER appuser

# ✅ No secrets here — all injected at runtime
ENV KAFKA_BROKERS=kafka:9092 \
    REDIS_HOST=redis

CMD ["python", "-u", "worker.py"]