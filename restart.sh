#!/bin/bash
# Complete restart script for Gasable MCP (Backend + Frontend)

set -e

cd "$(dirname "$0")"

echo "🔄 Restarting Gasable MCP..."
echo "================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Kill backend (port 8000)
echo -e "\n${YELLOW}Stopping backend (port 8000)...${NC}"
if lsof -ti:8000 > /dev/null 2>&1; then
    lsof -ti:8000 | xargs kill -9 2>/dev/null || true
    echo -e "${GREEN}✓ Backend stopped${NC}"
else
    echo -e "${YELLOW}⚠ Backend not running${NC}"
fi

# Kill frontend (port 3000)
echo -e "\n${YELLOW}Stopping frontend (port 3000)...${NC}"
if lsof -ti:3000 > /dev/null 2>&1; then
    lsof -ti:3000 | xargs kill -9 2>/dev/null || true
    echo -e "${GREEN}✓ Frontend stopped${NC}"
else
    echo -e "${YELLOW}⚠ Frontend not running${NC}"
fi

# Wait for ports to be released
sleep 2

# Start backend
echo -e "\n${YELLOW}Starting backend...${NC}"
source venv/bin/activate

# Export database URL
export SUPABASE_DB_URL="postgresql://postgres:GASABLEHUB@db.lopbyztcrrngppnvajis.supabase.co:5432/postgres?sslmode=require"

# Apply migrations before starting API (idempotent)
python - <<'PY'
from gasable_hub.db.postgres import run_migrations
try:
    applied = run_migrations()
    print("Migrations applied:", applied)
except Exception as e:
    print("Migration error:", e)
PY

# Load environment variables and start uvicorn
source venv/bin/activate
nohup uvicorn webapp:app --host 0.0.0.0 --port 8000 --timeout-keep-alive 75 --env-file .env > /tmp/gasable_api.log 2>&1 &
BACKEND_PID=$!
echo -e "${GREEN}✓ Backend started (PID: $BACKEND_PID)${NC}"

# Wait for backend to be ready
echo -e "\n${YELLOW}Waiting for backend...${NC}"
for i in {1..15}; do
    if curl -s http://localhost:8000/api/status > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Backend is ready!${NC}"
        break
    fi
    echo -n "."
    sleep 1
done

# Start frontend in background (bypass proxy via env)
echo -e "\n${YELLOW}Starting frontend...${NC}"
export NEXT_PUBLIC_API_BASE="http://localhost:8000"
nohup npm run dev > /tmp/gasable_frontend.log 2>&1 &
FRONTEND_PID=$!
echo -e "${GREEN}✓ Frontend started (PID: $FRONTEND_PID)${NC}"

# Wait for frontend to be ready
echo -e "\n${YELLOW}Waiting for frontend...${NC}"
for i in {1..20}; do
    if curl -s http://localhost:3000 > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Frontend is ready!${NC}"
        break
    fi
    echo -n "."
    sleep 1
done

echo ""
echo "================================"
echo -e "${GREEN}✅ Gasable MCP is running!${NC}"
echo ""
echo "📍 Services:"
echo "   • Backend:  http://localhost:8000"
echo "   • Frontend: http://localhost:3000"
echo ""
echo "📝 Logs:"
echo "   • Backend:  tail -f /tmp/gasable_api.log"
echo "   • Frontend: tail -f /tmp/gasable_frontend.log"
echo ""
echo "🛑 To stop: ./restart.sh stop"
echo "🔄 To restart: ./restart.sh"
echo ""
