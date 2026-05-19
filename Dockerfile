# ====== STAGE 1: Production Dependencies ======
FROM node:20-alpine AS deps-prod

WORKDIR /app

COPY BackEnd/package.json BackEnd/package-lock.json ./

RUN npm ci --only=production --no-audit --prefer-offline && \
    npm cache clean --force


# ====== STAGE 2: Development Dependencies ======
FROM node:20-alpine AS deps-dev

WORKDIR /app

COPY BackEnd/package.json BackEnd/package-lock.json ./

RUN npm ci --no-audit --prefer-offline


# ====== STAGE 3: Builder ======
FROM node:20-alpine AS builder

WORKDIR /app

COPY --from=deps-dev /app/node_modules ./node_modules

# ก๊อปปี้ซอร์สโค้ดทั้งหมด รวมถึงไฟล์ entrypoint.sh
COPY BackEnd/ ./

RUN npm run build --if-present


# ====== STAGE 4: Production Runner ======
FROM node:20-alpine AS runner

RUN apk add --no-cache tini dumb-init && \
    addgroup -g 1001 -S nodejs && \
    adduser -S appuser -u 1001 -G nodejs && \
    mkdir -p /app/logs /app/tmp && \
    chown -R appuser:nodejs /app

WORKDIR /app

# Dependencies
COPY --from=deps-prod --chown=appuser:nodejs /app/node_modules ./node_modules

# App source (แก้ไขจาก nodeuser เป็น nodejs ให้ถูกต้องทั้งหมด)
COPY --from=builder --chown=appuser:nodejs /app/package.json ./
COPY --from=builder --chown=appuser:nodejs /app/scripts ./scripts
COPY --from=builder --chown=appuser:nodejs /app/grpc ./grpc
COPY --from=builder --chown=appuser:nodejs /app/proto ./proto
COPY --from=builder --chown=appuser:nodejs /app/server.js ./
COPY --from=builder --chown=appuser:nodejs /app/config ./config
COPY --from=builder --chown=appuser:nodejs /app/routes ./routes
COPY --from=builder --chown=appuser:nodejs /app/models ./models
COPY --from=builder --chown=appuser:nodejs /app/middleware ./middleware
COPY --from=builder --chown=appuser:nodejs /app/services ./services
COPY --from=builder --chown=appuser:nodejs /app/healthcheck.js ./
COPY --from=builder --chown=appuser:nodejs /app/utils ./utils
COPY --from=builder --chown=appuser:nodejs /app/websocket.js ./websocket.js
COPY --from=builder --chown=appuser:nodejs /app/workers ./workers
COPY --from=builder --chown=appuser:nodejs /app/stripeWebhook.js ./stripeWebhook.js

# 🌟 1. ดึงไฟล์สคริปต์หน้าด่านเข้ามา และให้สิทธิ์รัน (Executable)
COPY --from=builder --chown=appuser:nodejs /app/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Optional dist build
# COPY --from=builder --chown=appuser:nodejs /app/dist ./dist

USER appuser

ENV NODE_ENV=production \
    PORT=3000 \
    NODE_OPTIONS="--max-old-space-size=512"

EXPOSE 3000

# 🌟 2. ใช้ tini ครอบ docker-entrypoint.sh เพื่อจัดการ Process อย่างปลอดภัย
ENTRYPOINT ["/sbin/tini", "--", "/app/docker-entrypoint.sh"]

# 🌟 3. ส่งคำสั่งรันแอปไปให้ docker-entrypoint.sh (จะกลายเป็นตัวแปร "$@" ในสคริปต์)
CMD ["node", "server.js"]


HEALTHCHECK --interval=30s \
            --timeout=5s \
            --start-period=30s \
            --retries=3 \
  CMD ["node", "healthcheck.js"]


LABEL maintainer="your-team@company.com" \
      version="1.0.0" \
      description="Production Node.js Backend with Vault Secrets Injection"