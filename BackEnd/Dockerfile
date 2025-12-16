# ====== STAGE 1: Dependencies ======
FROM node:18-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --prefer-offline

# ====== STAGE 2: Builder ======
FROM node:18-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build --if-present
RUN npm prune --omit=dev

# ====== STAGE 3: Runner ======
FROM node:18-alpine AS runner

RUN apk add --no-cache tini \
 && addgroup -g 1001 -S nodejs \
 && adduser -S appuser -u 1001 \
 && mkdir -p /app \
 && chown -R appuser:nodejs /app

WORKDIR /app

COPY --from=builder --chown=appuser:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:nodejs /app/package.json ./
COPY --from=builder --chown=appuser:nodejs /app/dist ./dist
COPY --chown=appuser:nodejs healthcheck.js ./

USER appuser

ENV NODE_ENV=production \
    PORT=3000

ENTRYPOINT ["/sbin/tini", "--"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "healthcheck.js"]

CMD ["node", "dist/server.js"]
