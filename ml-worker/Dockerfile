# ─── Stage 1: Builder (สำหรับ Compile และติดตั้งไลบรารี) ───
FROM python:3.9-slim AS builder

WORKDIR /app

# ติดตั้ง System dependencies สำหรับ Build
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# สร้างและใช้งาน Virtual Environment
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt .

# อัปเกรด pip และติดตั้งไลบรารีใน Virtual Env
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir --default-timeout=100 -r requirements.txt

# ─── Stage 2: Final (Hardened, เล็ก, และปลอดภัย) ───
FROM python:3.9-slim

# สร้าง Non-root User ชื่อ 'appuser'
RUN useradd --create-home appuser

WORKDIR /app

# 1. Copy เฉพาะ Virtual Environment ที่ติดตั้งเสร็จแล้วมาจาก Stage 1
COPY --from=builder /opt/venv /opt/venv

# ตั้งค่าให้ Python เรียกใช้ Virtual Environment
ENV PATH="/opt/venv/bin:$PATH"

# 2. Copy โค้ดของคุณ
COPY worker.py .

# 3. เปลี่ยนสิทธิ์ความเป็นเจ้าของไฟล์ให้ appuser
RUN chown -R appuser:appuser /app

# 4. สลับไปใช้สิทธิ์ Non-root
USER appuser

# Environment variables
ENV KAFKA_BROKERS=kafka:9092 \
    REDIS_HOST=redis \
    REDIS_PASSWORD=redispassword123 \
    PINECONE_API_KEY=""

CMD ["python", "-u", "worker.py"]