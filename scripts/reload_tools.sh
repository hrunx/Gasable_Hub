#!/bin/bash
# Reload backend to pick up new tools

echo "🔄 Reloading backend to pick up new tools..."

# Find and kill uvicorn process
PID=$(lsof -ti:8000 | head -1)

if [ -z "$PID" ]; then
    echo "❌ No backend running on port 8000"
    exit 1
fi

echo "   Stopping backend (PID: $PID)..."
kill -9 $PID 2>/dev/null

sleep 2

echo "   Starting backend..."
cd "$(dirname "$0")/.."
source venv/bin/activate

nohup uvicorn webapp:app --host 127.0.0.1 --port 8000 > /tmp/gasable_api.log 2>&1 &
NEW_PID=$!

sleep 3

# Check if it's running
if curl -s http://localhost:8000/api/status > /dev/null; then
    echo "✅ Backend reloaded successfully (PID: $NEW_PID)"
    echo "   Tools available:"
    curl -s http://localhost:8000/api/mcp_tools | jq -r '.tools[].name' | sed 's/^/     - /'
else
    echo "❌ Backend failed to start. Check /tmp/gasable_api.log"
    exit 1
fi

