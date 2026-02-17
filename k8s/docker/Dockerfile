# Stage 1: Install dependencies
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
# ติดตั้งแค่ prod deps
RUN npm ci --only=production

# Stage 2: Final Image
FROM node:20-alpine
WORKDIR /app

# สร้าง User เพื่อความปลอดภัย
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# ✅ ก๊อปปี้เฉพาะ node_modules จาก stage แรก
COPY --from=deps --chown=nodejs:nodejs /app/node_modules ./node_modules

# ✅ ก๊อปปี้เฉพาะไฟล์ที่จำเป็นต้องใช้รัน (server.js และอื่นๆ ที่จำเป็น)
# ไม่ควรใช้ COPY . . ถ้ามีไฟล์ขยะเยอะ
COPY --chown=nodejs:nodejs . .

USER nodejs
EXPOSE 3000
CMD ["node", "server.js"]