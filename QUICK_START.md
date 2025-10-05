# 🚀 Quick Start Guide - Gasable Multi-Agent Dashboard

## ✅ Everything is Ready!

You now have a fully functional multi-agent AI platform with:
- **4 AI Agents** (Support, Procurement, Research, Marketing)
- **RAG Chat Interface** with agent-to-agent communication
- **n8n-style Agent Creation** with all configuration fields
- **Visual Workflow Builder** with drag-and-drop nodes
- **Production-Ready Deployment** configuration

---

## 🎯 Access Your Dashboard

### **Option 1: React Dashboard (Recommended)**
```bash
open http://localhost:3000
```

**Features:**
- 💬 **AI Chat Tab** - Chat with RAG-powered agents
- 🤖 **Agents Tab** - View and manage all 4 agents
- 🛠️ **Tools Tab** - Browse 7 available MCP tools
- 🔄 **Workflows Tab** - Build visual automation workflows

### **Option 2: API Documentation**
```bash
open http://localhost:8000/docs
```

---

## 🤖 Your 4 AI Agents

### 1. **Support Agent** 🎧
- **Tools**: RAG Search
- **Use For**: Customer support, general questions
- **Try**: "What is Gasable?"

### 2. **Procurement Agent** 📦
- **Tools**: RAG Search, Order Placement
- **Use For**: Product orders, inventory management
- **Try**: "Place an order for diesel fuel"

### 3. **Research Agent** 🔍 (NEW!)
- **Tools**: RAG Search, Web Ingestion, URL Processing
- **Use For**: Web research, competitive analysis, trends
- **Try**: "Research the latest AI trends"

### 4. **Marketing Agent** 📧 (NEW!)
- **Tools**: RAG Search, Gmail Send, Gmail Draft
- **Use For**: Email campaigns, marketing content
- **Try**: "Draft an email about our new product"

---

## 💬 Try the AI Chat

1. Open http://localhost:3000
2. You'll land on the **AI Chat** tab by default
3. Try these prompts:

```
"Research the latest developments in AI agents"
→ Calls Research Agent with web search

"Draft a professional email introducing our company"
→ Calls Marketing Agent for email composition

"What services does Gasable offer?"
→ Calls Support Agent with RAG search

"Help me place an order"
→ Calls Procurement Agent
```

The system automatically routes your message to the right agent!

---

## 🎨 Create a New Agent

1. Click the **Agents** tab
2. Click **"New Agent"** button
3. Fill in the form (all fields like n8n):
   - Agent ID (unique)
   - Display Name
   - Namespace (global/dev/prod)
   - System Prompt (multi-line)
   - **Tool Permissions** (checkbox list)
   - Answer Model (GPT-4o, GPT-4o-mini, etc.)
   - Rerank Model
   - Top K Results
4. Click **"Create Agent"**

**To Edit**: Just click any agent card!

---

## 🔄 Build a Workflow

1. Click the **Workflows** tab
2. Click **"New Workflow"** or an existing workflow
3. Drag nodes from the left sidebar:
   - **Add Agent** - Route to AI agents
   - **Add Tool** - Call MCP tools directly
   - **Add Decision** - Conditional routing
4. Connect nodes by dragging from one handle to another
5. Auto-saves every 1 second!

---

## 🛠️ Available MCP Tools

Your agents can use these tools:

1. **rag_search_tool** - Hybrid vector + BM25 search with reranking
2. **orders_place** - Place product orders (marketplace integration)
3. **ingest_web** - Search and ingest web content
4. **ingest_local_tool** - Ingest local documents (PDF, DOCX, MD)
5. **ingest_drive_tool** - Google Drive document ingestion
6. **db_health** - Check database connection and status
7. **db_migrate** - Run SQL migrations

---

## 📊 Check System Status

### API Health
```bash
curl http://localhost:8000/health
```

### List All Agents
```bash
curl http://localhost:8000/api/agents | jq
```

### Database Stats
```bash
curl http://localhost:8000/api/db_stats | jq
```

### Available Tools
```bash
curl http://localhost:8000/api/mcp_tools | jq
```

---

## 🔧 Development Servers

You have 2 servers running:

### **Frontend (Next.js)**
```bash
Port: 3000
URL: http://localhost:3000
Process: gasable-ui/
```

### **Backend (FastAPI)**
```bash
Port: 8000
URL: http://localhost:8000
Process: webapp.py
```

**To restart backend:**
```bash
cd /Users/hrn/Desktop/gasable_mcp
pkill -f "uvicorn.*webapp:app"
source .venv/bin/activate
python -m uvicorn webapp:app --host 0.0.0.0 --port 8000 --reload &
```

**To restart frontend:**
```bash
cd /Users/hrn/Desktop/gasable_mcp/gasable-ui
pkill -f "next dev"
npm run dev &
```

---

## 🚀 Deploy to Production (Google Cloud Run)

### Quick Deploy:
```bash
cd /Users/hrn/Desktop/gasable_mcp

# Build React UI
cd gasable-ui
npm run build
cd ..

# Deploy to Cloud Run
gcloud run deploy gasable-hub \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --port 8000
```

### Access in Production:
- **Single URL**: https://your-app-hash.run.app
- **Everything on port 8000** (React + API)
- **No separate ports needed!**

See `DEPLOYMENT_GUIDE.md` for complete instructions.

---

## 🎯 What's Different from the Old Dashboard?

### Old HTML Dashboard ❌
- Agents stuck loading forever
- No chat interface
- No agent creation
- Static HTML + jQuery
- Only 2 agents

### New React Dashboard ✅
- Agents load instantly
- Full RAG chat with agent routing
- n8n-style agent creation
- Modern React + TypeScript
- 4 specialized agents
- Visual workflow builder
- Production-ready

---

## 🔑 Key Endpoints

### Frontend (Development)
- Dashboard: http://localhost:3000
- Workflows: http://localhost:3000/workflows/new

### Backend API
- Health: http://localhost:8000/health
- Agents: http://localhost:8000/api/agents
- Tools: http://localhost:8000/api/mcp_tools
- Chat: POST http://localhost:8000/api/orchestrate
- Docs: http://localhost:8000/docs

### Production (Cloud Run)
- Everything: https://your-app.run.app/
- Dashboard: https://your-app.run.app/dashboard (redirects to /)

---

## 📚 Documentation

- `FEATURES_SUMMARY.md` - Complete feature list and what's been built
- `DEPLOYMENT_GUIDE.md` - Full production deployment guide
- `README.md` - Project overview
- `gasable-ui/README.md` - React dashboard docs

---

## 🐛 Troubleshooting

### Chat not working?
```bash
# Check backend is running
curl http://localhost:8000/health

# Check agents loaded
curl http://localhost:8000/api/agents
```

### Agents not showing?
```bash
# Restart backend
pkill -f uvicorn
cd /Users/hrn/Desktop/gasable_mcp
source .venv/bin/activate
python -m uvicorn webapp:app --host 0.0.0.0 --port 8000 --reload &
```

### Frontend build errors?
```bash
cd gasable-ui
rm -rf .next node_modules
npm install
npm run dev
```

---

## 🎉 You're All Set!

Start exploring: **http://localhost:3000**

**Try the chat first!** It's the fastest way to see everything in action.

**Questions?** Check the documentation files or test the API at http://localhost:8000/docs

---

## ⚡ Quick Commands Reference

```bash
# Start backend
cd /Users/hrn/Desktop/gasable_mcp
source .venv/bin/activate
python -m uvicorn webapp:app --host 0.0.0.0 --port 8000 --reload

# Start frontend
cd /Users/hrn/Desktop/gasable_mcp/gasable-ui
npm run dev

# Run migrations
export DATABASE_URL="your_supabase_url"
psql "$DATABASE_URL" -f migrations/0012_research_marketing_agents.sql

# Build for production
cd gasable-ui
npm run build

# Deploy
gcloud run deploy gasable-hub --source .
```

**Happy Building! 🚀**

