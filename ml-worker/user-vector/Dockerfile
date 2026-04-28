# Dockerfile
FROM python:3.11-slim

WORKDIR /app

# pymongo ต้องการ gcc
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY worker.py .

ENV PYTHONUNBUFFERED=1

CMD ["python", "-u", "worker.py"]