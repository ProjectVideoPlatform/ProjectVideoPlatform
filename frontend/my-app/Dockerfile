# Base image
FROM node:20-alpine

# Working directory
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm install

# Copy source
COPY . .

# Default command (dev mode)
CMD ["npm", "run", "dev"]
