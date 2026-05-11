# recommendation-service/Dockerfile
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# copy proto และ generate stubs ตอน build
COPY ../proto /proto
RUN python -m grpc_tools.protoc \
    -I/proto \
    --python_out=. \
    --grpc_python_out=. \
    /proto/recommendation.proto

COPY . .

EXPOSE 50051
CMD ["python", "server.py"]