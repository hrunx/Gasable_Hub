# 🚀 Gasable MCP - Quick Commands

## 🔄 Restart Everything

```bash
cd /Users/hrn/Desktop/gasable_mcp
./restart.sh
```

This will:
- Kill backend (port 8000)
- Kill frontend (port 3000)
- Restart both with auto-reload
- Show status and log locations

## 🛑 Stop All Services

```bash
cd /Users/hrn/Desktop/gasable_mcp
./stop.sh
```

## 📊 Check Status

```bash
# Check if services are running
lsof -ti:8000  # Backend
lsof -ti:3000  # Frontend

# Quick API check
curl http://localhost:8000/api/status

# Frontend check
curl http://localhost:3000
```

## 📝 View Logs

```bash
# Backend logs (live)
tail -f /tmp/gasable_api.log

# Frontend logs (live)
tail -f /tmp/gasable_frontend.log

# Last 50 lines of backend
tail -50 /tmp/gasable_api.log

# Search for errors
grep -i error /tmp/gasable_api.log
```

## 🔧 Reload Tools (after creating new tools)

```bash
cd /Users/hrn/Desktop/gasable_mcp
./scripts/reload_tools.sh
```

## 🤖 Sync Support Agent (after updating prompt)

```bash
cd /Users/hrn/Desktop/gasable_mcp
source venv/bin/activate
python3 scripts/sync_support_assistant.py
```

## 🗄️ Database Operations

```bash
# Verify RAG memory
source venv/bin/activate
python scripts/verify_rag_memory.py

# Check database connection
curl http://localhost:8000/api/status | jq '.db'

# Count indexed documents
curl -s http://localhost:8000/api/status | jq '.embedding_col'
```

## 📦 Install Dependencies

```bash
# Python dependencies
source venv/bin/activate
pip install -r requirements.txt

# Node dependencies
npm install
```

## 🧹 Clean Restart (if issues)

```bash
# Stop everything
./stop.sh

# Clear logs
rm /tmp/gasable_*.log

# Restart
./restart.sh
```

## 🆘 Troubleshooting

### Port already in use

```bash
# Kill process on port 8000
lsof -ti:8000 | xargs kill -9

# Kill process on port 3000
lsof -ti:3000 | xargs kill -9
```

### Backend won't start

```bash
# Check logs
tail -100 /tmp/gasable_api.log

# Check database connection
curl http://localhost:8000/api/status
```

### Frontend won't start

```bash
# Check logs
tail -100 /tmp/gasable_frontend.log

# Try manual start
npm run dev
```

### Tools not appearing in UI

```bash
# Reload backend
./scripts/reload_tools.sh

# Or full restart
./restart.sh
```

### Agent not working correctly

```bash
# Sync OpenAI Assistant
python3 scripts/sync_support_assistant.py

# Check agent status
curl http://localhost:8000/api/agents | jq '.agents[] | {id, display_name, assistant_id}'
```

## 🌐 Access URLs

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:8000
- **API Docs**: http://localhost:8000/docs
- **API Status**: http://localhost:8000/api/status

## 🔑 Environment Variables

Located in `.env` file:

```bash
# View environment
cat .env

# Edit environment
nano .env
```

Key variables:
- `OPENAI_API_KEY` - OpenAI API key
- `SUPABASE_DB_URL` - Database connection string
- `DATABASE_URL` - Alternative database URL

## 📚 Documentation Files

- `README.md` - Main documentation
- `API_DOCUMENTATION.md` - API endpoints
- `RAG_MEMORY_ARCHITECTURE.md` - RAG memory system
- `QUICK_RAG_SETUP.md` - RAG setup guide
- `WORKFLOW_TESTING_GUIDE.md` - Workflow testing

---

## 💡 Common Workflows

### After Creating a New Tool

```bash
./scripts/reload_tools.sh
# Or
./restart.sh
```

### After Updating Agent Prompt

```bash
source venv/bin/activate
python3 scripts/sync_support_assistant.py
```

### Fresh Start After Code Changes

```bash
./restart.sh
```

### Debugging Issues

```bash
# Stop everything
./stop.sh

# Check logs
tail -100 /tmp/gasable_api.log
tail -100 /tmp/gasable_frontend.log

# Restart
./restart.sh
```

---

**Quick Reference**: Most common command is `./restart.sh` - use this whenever you make changes or have issues!

