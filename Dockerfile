# ====== STAGE 1: Dependencies ======
FROM node:18-alpine AS deps
WORKDIR /app/BackEnd

COPY BackEnd/package.json BackEnd/package-lock.json ./
RUN npm ci --no-audit --prefer-offline

# ====== STAGE 2: Builder ======
FROM node:18-alpine AS builder
WORKDIR /app/BackEnd

COPY --from=deps /app/BackEnd/node_modules ./node_modules
COPY BackEnd/ ./

RUN npm run build
RUN npm prune --omit=dev

# ====== STAGE 3: Runner ======
FROM node:18-alpine AS runner

RUN apk add --no-cache tini \
 && addgroup -g 1001 -S nodejs \
 && adduser -S appuser -u 1001 \
 && mkdir -p /app \
 && chown -R appuser:nodejs /app

WORKDIR /app

COPY --from=builder --chown=appuser:nodejs /app/BackEnd/node_modules ./node_modules
COPY --from=builder --chown=appuser:nodejs /app/BackEnd/package.json ./
COPY --from=builder --chown=appuser:nodejs /app/BackEnd/dist ./dist
COPY --from=builder --chown=appuser:nodejs /app/BackEnd/healthcheck.js ./healthcheck.js

USER appuser

ENV NODE_ENV=production \
    PORT=3000

ENTRYPOINT ["/sbin/tini", "--"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "healthcheck.js"]

CMD ["node", "dist/server.js"]
