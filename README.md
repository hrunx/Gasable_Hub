# 🚀 Gasable Hub - Multi-Agent AI Platform

> Production-ready multi-agent orchestration system with React dashboard

[![Status](https://img.shields.io/badge/status-production%20ready-brightgreen)]()
[![Next.js](https://img.shields.io/badge/Next.js-15-black)]()
[![FastAPI](https://img.shields.io/badge/FastAPI-latest-009688)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)]()

---

## 🎯 Quick Start

### **One Command Start**
```bash
./start.sh
```

This will start both:
- ✅ Backend (FastAPI) on port 8000
- ✅ Frontend (Next.js) on port 3000

### **Manual Start**

**Terminal 1 - Backend:**
```bash
source .venv/bin/activate
python -m uvicorn webapp:app --host 0.0.0.0 --port 8000 --reload
```

**Terminal 2 - Frontend:**
```bash
npm run dev
```

### **Access**
- 📊 **Dashboard**: http://localhost:3000
- 🔧 **API**: http://localhost:8000
- 📚 **API Docs**: http://localhost:8000/docs

---

## ✨ Features

### **1. Multi-Agent Orchestration**
- 🤖 4 AI Agents (Support, Research, Marketing, Procurement)
- 🎯 Auto-routing (AI selects best agent)
- 🎨 Direct agent chat (user selects agent)
- 🔍 RAG search with hybrid retrieval

### **2. Modern Dashboard**
- ⚡ Next.js 15 + TypeScript
- 🎨 shadcn/ui components
- 📊 Real-time status monitoring
- 💬 Multi-agent chat interface

### **3. Workflow Builder**
- 🔄 n8n-style drag-and-drop editor
- 🎯 Custom nodes (Agent, Tool, Decision, Start)
- ⚙️ Right-click node configuration
- 📋 5 pre-built templates

### **4. API & Tools**
- 🛠️ 7 MCP tools
- 📡 RESTful API
- 📚 Complete documentation
- 🔌 OpenAPI/Swagger

---

## 📋 Installation

### **Prerequisites**
- Python 3.11+
- Node.js 18+
- PostgreSQL with pgvector
- OpenAI API key

### **Setup**

1. **Clone & Install Python Dependencies**
```bash
git clone https://github.com/hrunx/Gasable_Hub.git
cd Gasable_Hub
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

2. **Install Node.js Dependencies**
```bash
npm install
```

3. **Configure Environment**
```bash
cp .env.example .env
# Edit .env with your credentials
```

4. **Run Database Migrations**
```bash
psql -d your_database -f migrations/0010_multi_agent_schema.sql
psql -d your_database -f migrations/0011_workflows.sql
psql -d your_database -f migrations/0012_research_marketing_agents.sql
```

5. **Start the Application**
```bash
./start.sh
```

---

## 🎮 Usage

### **Multi-Agent Chat**

**Auto-Routing Mode:**
```bash
curl -X POST http://localhost:8000/api/orchestrate \
  -H "Content-Type: application/json" \
  -d '{"user_id":"user123","message":"Research AI trends","namespace":"global"}'
```

**Direct Agent Mode:**
```bash
curl -X POST http://localhost:8000/api/orchestrate \
  -H "Content-Type: application/json" \
  -d '{"user_id":"user123","message":"Tell me about AI","namespace":"global","agent_preference":"research"}'
```

### **Dashboard Usage**

1. **Select Agent Mode**
   - Purple sparkles = Orchestrator (AI routes)
   - Blue bot buttons = Direct agent chat

2. **Create Workflows**
   - Click "Workflows" tab
   - Click "New Workflow"
   - Drag nodes from sidebar
   - Right-click to configure

3. **Manage Agents**
   - Click "Agents" tab
   - Click "New Agent" to create
   - Click existing agent to edit

---

## 📁 Project Structure

```
gasable_mcp/
├── webapp.py                 # FastAPI backend
├── gasable_hub/              # Core modules
│   ├── agents/               # Agent logic
│   ├── orch/                 # Orchestration
│   └── tools/                # MCP tools
├── src/                      # Next.js frontend
│   ├── app/                  # Pages
│   ├── components/           # React components
│   │   ├── chat/             # Chat interface
│   │   ├── agents/           # Agent management
│   │   └── workflow/         # Workflow builder
│   └── lib/                  # API client & utilities
├── migrations/               # SQL migrations
├── logs/                     # Application logs
├── start.sh                  # One-command start script
└── README.md                 # This file
```

---

## 🔧 API Endpoints

### **Core Endpoints**
- `POST /api/orchestrate` - Multi-agent chat
- `GET /api/status` - System health
- `GET /api/agents` - List agents
- `POST /api/agents` - Create/update agent
- `GET /api/mcp_tools` - List tools
- `GET /api/workflows` - List workflows
- `POST /api/workflows` - Save workflow

📚 **Full API Documentation**: See [API_DOCUMENTATION.md](API_DOCUMENTATION.md)

---

## 🧪 Testing

### **Test Agents**
```bash
# Support Agent
curl -X POST http://localhost:8000/api/orchestrate \
  -H "Content-Type: application/json" \
  -d '{"user_id":"test","message":"What is Gasable?","namespace":"global"}'

# Research Agent (Direct)
curl -X POST http://localhost:8000/api/orchestrate \
  -H "Content-Type: application/json" \
  -d '{"user_id":"test","message":"Research AI","namespace":"global","agent_preference":"research"}'
```

### **Check Status**
```bash
curl http://localhost:8000/api/status
```

---

## 🚀 Production Deployment

### **Build for Production**
```bash
npm run build
```

### **Deploy to Google Cloud Run**
```bash
gcloud run deploy gasable-hub \
  --source . \
  --platform managed \
  --region us-central1 \
  --port 8000 \
  --allow-unauthenticated
```

📖 **Full Deployment Guide**: See [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)

---

## 🤖 Available Agents

| Agent | ID | Tools | Purpose |
|-------|------|-------|---------|
| **Support** | `support` | rag.search | General questions, company info |
| **Research** | `research` | rag.search, ingest_web, ingest_urls | Web research, data analysis |
| **Marketing** | `marketing` | rag.search, gmail.send, gmail.draft | Email campaigns, content |
| **Procurement** | `procurement` | rag.search, orders.place | Order processing, inventory |

---

## 🛠️ Development

### **File Watching**
Both backend and frontend support hot-reload:
- Backend: `--reload` flag on uvicorn
- Frontend: Next.js dev server auto-reloads

### **Logs**
```bash
# View logs
tail -f logs/backend.log
tail -f logs/frontend.log
```

### **Stop Services**
```bash
pkill -f uvicorn && pkill -f 'next dev'
```

---

## 📊 Tech Stack

**Frontend:**
- Next.js 15
- React 18
- TypeScript
- shadcn/ui
- Tailwind CSS
- React Flow
- TanStack Query

**Backend:**
- FastAPI
- Python 3.11
- PostgreSQL
- pgvector
- OpenAI API

**Tools:**
- RAG Search (hybrid: vector + BM25 + rerank)
- Web Ingestion
- Document Processing
- Gmail Integration
- Order Management

---

## 🔐 Environment Variables

```bash
OPENAI_API_KEY=sk-proj-...
DATABASE_URL=postgresql://...
NETLIFY_DATABASE_URL=postgresql://...  # Supabase
OPENAI_MODEL=gpt-4o-mini
OPENAI_EMBED_MODEL=text-embedding-3-small
ENVIRONMENT=development
```

---

## 📝 Documentation

- **API Documentation**: [API_DOCUMENTATION.md](API_DOCUMENTATION.md)
- **Agent Selection**: [AGENT_SELECTION_FEATURE.md](AGENT_SELECTION_FEATURE.md)
- **Deployment Guide**: [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)
- **Quick Start**: [QUICK_START.md](QUICK_START.md)

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License.

---

## 🆘 Support

- **GitHub Issues**: https://github.com/hrunx/Gasable_Hub/issues
- **Documentation**: See `/docs` folder
- **API Docs**: http://localhost:8000/docs

---

## ✨ Status

✅ **Production Ready**
- All features implemented
- Comprehensive testing completed
- Full documentation provided
- Zero TypeScript errors
- Zero ESLint warnings

---

**Made with ❤️ by the Gasable Team**

🌟 Star us on GitHub if you find this useful!
