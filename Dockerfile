# ====== STAGE 1: Dependencies ======
FROM node:18-alpine AS deps
WORKDIR /app/BackEnd

COPY BackEnd/package.json BackEnd/package-lock.json ./
RUN npm ci --no-audit --prefer-offline

# ====== STAGE 2: Runner ======
FROM node:18-alpine AS runner

RUN apk add --no-cache tini \
 && addgroup -g 1001 -S nodejs \
 && adduser -S appuser -u 1001

WORKDIR /app

# Copy only what is needed
COPY --from=deps /app/BackEnd/node_modules ./node_modules
COPY BackEnd/package.json ./
COPY BackEnd/server.js ./
COPY BackEnd/healthcheck.js ./

# Remove dev dependencies
RUN npm prune --omit=dev \
 && chown -R appuser:nodejs /app

USER appuser

ENV NODE_ENV=production \
    PORT=3000

ENTRYPOINT ["/sbin/tini", "--"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "healthcheck.js"]

CMD ["node", "server.js"]
