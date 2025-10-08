#!/bin/bash
# Stop all Gasable MCP services

cd "$(dirname "$0")"

echo "🛑 Stopping Gasable MCP..."
echo "================================"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

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

# Kill any remaining node/npm processes
pkill -f "next dev" 2>/dev/null || true
pkill -f "npm run dev" 2>/dev/null || true

# Kill any uvicorn processes
pkill -f "uvicorn webapp:app" 2>/dev/null || true

echo ""
echo "================================"
echo -e "${GREEN}✅ All services stopped!${NC}"
echo ""

