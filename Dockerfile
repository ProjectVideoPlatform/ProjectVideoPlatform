# ====== STAGE 1: Production Dependencies ======
FROM node:22-alpine AS deps-prod

WORKDIR /app

# Copy package files
COPY BackEnd/package.json BackEnd/package-lock.json ./

# Install ONLY production dependencies
RUN npm ci --only=production --no-audit --prefer-offline && \
    npm cache clean --force

# ====== STAGE 2: Development Dependencies (ถ้าต้อง build) ======
FROM node:22-alpine AS deps-dev

WORKDIR /app

COPY BackEnd/package.json BackEnd/package-lock.json ./

# Install ALL dependencies
RUN npm ci --no-audit --prefer-offline

# ====== STAGE 3: Builder (ถ้ามี build step) ======
FROM node:22-alpine AS builder

WORKDIR /app

# Copy dev dependencies
COPY --from=deps-dev /app/node_modules ./node_modules

# Copy source
COPY BackEnd/ ./

# Build (ถ้ามี)
RUN npm run build --if-present

# ====== STAGE 4: Production Runner ======
FROM node:22-alpine AS runner

# Security & Profiling: Install tini, dumb-init, and perf for JIT symbols
RUN apk add --no-cache tini dumb-init perf && \
    addgroup -g 1001 -S nodejs && \
    adduser -S appuser -u 1001 -G nodejs && \
    mkdir -p /app/logs /app/tmp && \
    chown -R appuser:nodejs /app

WORKDIR /app

# Copy production dependencies (already pruned!)
COPY --from=deps-prod --chown=appuser:nodejs /app/node_modules ./node_modules

# Copy package.json
COPY --from=builder --chown=appuser:nodejs /app/package.json ./

# Copy only necessary files
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
# COPY --from=builder --chown=appuser:nodejs /app/keys ./keys
COPY --from=builder --chown=appuser:nodejs /app/utils ./utils
COPY --from=builder --chown=appuser:nodejs /app/websocket.js ./websocket.js
COPY --from=builder --chown=appuser:nodejs /app/workers ./workers
COPY --from=builder --chown=appuser:nodejs /app/stripeWebhook.js ./stripeWebhook.js

# Copy docker entrypoint script
COPY --from=builder --chown=appuser:nodejs /app/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# หรือถ้ามี dist/ จาก build
# COPY --from=builder --chown=appuser:nodejs /app/dist ./dist

# Switch to non-root user
USER appuser

# Environment
# 🛠️ สิ่งที่เพิ่ม: เปิดตัวเลือกให้ Node.js บันทึกข้อมูลแผนที่โค้ด (JIT Symbols)
# ตัวนี้ช่วยให้ Elastic Agent เข้าใจโค้ด JavaScript ที่ถูกคอมไพล์ใน RAM ได้ด้วย
ENV NODE_ENV=production \
    PORT=3000 \
    NODE_OPTIONS="--max-old-space-size=512 --perf-prof"

# Expose port
EXPOSE 3000

# Use tini as init and run entrypoint script
ENTRYPOINT ["/sbin/tini", "--", "/app/docker-entrypoint.sh"]

# Health check
HEALTHCHECK --interval=30s \
            --timeout=5s \
            --start-period=30s \
            --retries=3 \
  CMD ["node", "healthcheck.js"]

# Labels
LABEL maintainer="your-team@company.com" \
      version="1.0.0" \
      description="Production Node.js Backend"