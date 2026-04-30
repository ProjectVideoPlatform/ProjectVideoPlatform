# flink-analytics/Dockerfile
FROM maven:3.9-eclipse-temurin-11 AS builder
WORKDIR /app
COPY pom.xml .
COPY src ./src
RUN mvn clean package -DskipTests

FROM flink:1.18.1-java11
COPY --from=builder /app/target/flink-analytics-*.jar /app/flink-analytics.jar