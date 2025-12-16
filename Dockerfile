# ====== STAGE 1: Dependencies ======
FROM node:18-alpine AS deps

WORKDIR /app

# Copy package files only
COPY ./BackEnd/package.json ./BackEnd/package-lock.json ./

# Install ALL dependencies (รวม devDependencies สำหรับ build)
RUN npm ci --no-audit --prefer-offline

# ====== STAGE 2: Builder ======
FROM node:18-alpine AS builder

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/BackEnd/node_modules ./BackEnd/node_modules

# Copy source code (เฉพาะที่จำเป็น)
COPY . .
COPY ./BackEnd/package.json ./

# Build application
RUN npm run build --if-present

# Prune dev dependencies (ถ้าต้องการ)
RUN npm prune --production
FROM node:18-alpine AS runner

# Security hardening
RUN apk add --no-cache tini

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S appuser -u 1001 && \
    mkdir -p /app && \
    chown -R appuser:nodejs /app

WORKDIR /app

# Copy from builder
COPY --from=builder --chown=appuser:nodejs /app/BackEnd/node_modules ./node_modules
COPY --from=builder --chown=appuser:nodejs /app/BackEnd/package.json ./
COPY --from=builder --chown=appuser:nodejs /app/BackEnd/dist ./dist



# Copy health check
COPY --chown=appuser:nodejs healthcheck.js ./

# Switch to non-root user
USER appuser

# Environment
ENV NODE_ENV=production \
    PORT=3000

# Use tini as init process
ENTRYPOINT ["/sbin/tini", "--"]

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "healthcheck.js"]

# Start
CMD ["node", "dist/server.js"]