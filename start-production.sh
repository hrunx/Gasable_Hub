#!/bin/bash
# Production start script for Google Cloud Run

set -e

echo "🚀 Starting Gasable Hub (Production Mode)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Set production environment
export ENVIRONMENT=production
export PORT=${PORT:-8080}
export BACKEND_PORT=${BACKEND_PORT:-8001}

# Start Next.js server in background
echo "Starting Next.js frontend..."
node /app/server.js > /app/logs/nextjs.log 2>&1 &
NEXT_PID=$!
echo "✓ Next.js started (PID: $NEXT_PID)"

# Wait for Next.js to be ready
echo "Waiting for Next.js to be ready..."
sleep 5

# Start FastAPI
echo "Starting FastAPI backend on ${BACKEND_PORT}..."
cd /app
exec python -m uvicorn webapp:app --host 0.0.0.0 --port ${BACKEND_PORT} --workers 2

