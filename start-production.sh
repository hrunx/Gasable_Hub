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

# Wait for Next.js to be ready by probing the HTTP port
echo "Waiting for Next.js to be ready..."
python - <<'PY'
import os
import socket
import sys
import time

port = int(os.getenv("PORT", "8080"))
deadline = time.time() + 45
addr = ("127.0.0.1", port)

while time.time() < deadline:
	with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
		sock.settimeout(1.0)
		try:
			sock.connect(addr)
		except OSError:
			time.sleep(1.0)
		else:
			print(f"Next.js responded on port {port}")
			sys.exit(0)

print(f"Warning: Next.js did not respond on port {port} within timeout", file=sys.stderr)
PY

# Start FastAPI
echo "Applying database migrations (if any)..."
python - <<'PY'
from gasable_hub.db.postgres import run_migrations
try:
    applied = run_migrations()
    print(f"Migrations applied: {applied}")
except Exception as e:
    print(f"Migration error: {e}")
PY

echo "Starting FastAPI backend on ${BACKEND_PORT}..."
cd /app
exec python -m uvicorn webapp:app --host 0.0.0.0 --port ${BACKEND_PORT} --workers 1
