# Multi-stage build for production deployment

# Stage 1: Build Next.js app (Debian-based to match runtime)
FROM node:18-bullseye-slim AS frontend-builder
WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy project source and configs required for Next.js build
COPY . .

# Build Next.js app
RUN npm run build

# Stage 2: Python backend with Next.js build
FROM python:3.11-slim
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy Python requirements
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy Python application
COPY webapp.py ./
COPY gasable_hub ./gasable_hub
COPY migrations ./migrations

# Copy Node.js and Next.js build from frontend stage
COPY --from=frontend-builder /usr/local/bin/node /usr/local/bin/node
COPY --from=frontend-builder /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=frontend-builder /app/.next/standalone ./
COPY --from=frontend-builder /app/.next/static ./.next/static
COPY --from=frontend-builder /app/public ./public

# Create necessary directories
RUN mkdir -p logs storage

# Expose port (Cloud Run defaults to 8080)
EXPOSE 8080

# Set environment variable
ENV ENVIRONMENT=production
ENV PORT=8080

# Copy start script
COPY start-production.sh ./
RUN chmod +x start-production.sh

# Start command - run both FastAPI and Next.js
CMD ["./start-production.sh"]
