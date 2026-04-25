# build stage
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# serve stage
FROM nginx:alpine
# Copy ไฟล์ config ของเราไปทับค่า default ของ nginx
COPY nginx.conf /etc/nginx/conf.d/default.conf 
COPY --from=build /app/dist /usr/share/nginx/html

# (Optional) ระบุ Port ให้ชัดเจนว่า Container นี้ใช้ Port อะไร
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]