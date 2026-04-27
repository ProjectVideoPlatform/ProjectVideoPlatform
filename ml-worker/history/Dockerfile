# Dockerfile.kafka
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY worker.py .

# ป้องกัน Python buffer ค้าง — log ออก stdout ทันที
ENV PYTHONUNBUFFERED=1

CMD ["python", "-u", "worker.py"]