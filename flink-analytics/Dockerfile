# flink-analytics/Dockerfile
FROM maven:3.9-eclipse-temurin-11 AS builder
WORKDIR /app
COPY pom.xml .
COPY src ./src
RUN mvn clean package -DskipTests

FROM flink:1.18.1-java11
# สร้างโฟลเดอร์สำหรับเก็บ Artifact
WORKDIR /opt/flink

# ก๊อปปี้ไฟล์ JAR ไปไว้ใน usrlib (เพื่อให้ Flink เห็น Class ต่างๆ)
COPY --from=builder /app/target/flink-analytics-*.jar /opt/flink/usrlib/flink-analytics.jar