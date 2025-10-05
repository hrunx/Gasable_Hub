# 🚀 Gasable Hub API Documentation

## Base URL
```
Development: http://localhost:8000
Production: https://your-domain.run.app
```

---

## 📡 System Status & Health

### GET `/api/status`
Get system health status and process information.

**Response:**
```json
{
  "db": {
    "status": "ok"
  },
  "pids": {
    "mcp_pid": 85415,
    "web_pid": 85416
  },
  "embedding_col": "embedding_1536"
}
```

### GET `/api/connections`
Get active MCP connections.

**Response:**
```json
{
  "connections": []
}
```

---

## 🤖 Multi-Agent Orchestration

### POST `/api/orchestrate`
Main orchestration endpoint that routes messages to the appropriate agent or uses a specific agent.

**Modes:**
1. **Auto-Routing Mode**: AI automatically selects the best agent
2. **Direct Agent Mode**: Specify an agent preference

#### Auto-Routing Mode (Recommended)
AI analyzes your message and routes to the best agent automatically.

**Request:**
```json
{
  "user_id": "demo_user",
  "message": "What is Gasable?",
  "namespace": "global"
}
```

**Response:**
```json
{
  "agent": "support",
  "message": "Gasable is a customer care service...",
  "status": "completed"
}
```

#### Direct Agent Mode
Force message to go to a specific agent.

**Request:**
```json
{
  "user_id": "demo_user",
  "message": "Tell me about AI research",
  "namespace": "global",
  "agent_preference": "research"
}
```

**Response:**
```json
{
  "agent": "research",
  "message": "AI research is a vast field...",
  "status": "completed"
}
```

**Available Agents:**
- `support` - General questions, company info
- `research` - Web research, analysis, data gathering  
- `marketing` - Email drafting, content creation
- `procurement` - Order placement, inventory

**Parameters:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `user_id` | string | Yes | Unique user identifier |
| `message` | string | Yes | User message to process |
| `namespace` | string | Yes | Namespace (usually "global") |
| `agent_preference` | string | No | Force specific agent (support/research/marketing/procurement) |

---

## 👥 Agents Management

### GET `/api/agents`
List all available AI agents.

**Response:**
```json
{
  "agents": [
    {
      "id": "support",
      "display_name": "Gasable Support",
      "namespace": "global",
      "system_prompt": "You are a support agent...",
      "tool_allowlist": ["rag.search"],
      "answer_model": "gpt-4o-mini",
      "rerank_model": "gpt-4o-mini",
      "top_k": 12
    }
  ]
}
```

### POST `/api/agents`
Create or update an agent.

**Request:**
```json
{
  "id": "custom_agent",
  "display_name": "Custom Agent",
  "namespace": "global",
  "system_prompt": "You are a custom agent...",
  "tool_allowlist": ["rag.search", "orders.place"],
  "answer_model": "gpt-4o-mini",
  "rerank_model": "gpt-4o-mini",
  "top_k": 12
}
```

**Response:**
```json
{
  "status": "ok",
  "agent_id": "custom_agent"
}
```

---

## 🛠️ MCP Tools

### GET `/api/mcp_tools`
List all available MCP (Model Context Protocol) tools.

**Response:**
```json
{
  "tools": [
    {
      "name": "rag_search_tool",
      "description": "Hybrid search with vector + BM25 + rerank",
      "module": "gasable_hub.tools.rag_search"
    },
    {
      "name": "orders_place",
      "description": "Place orders",
      "module": "gasable_hub.tools.orders"
    },
    {
      "name": "ingest_web",
      "description": "Ingest web content",
      "module": "gasable_hub.tools.ingest_web"
    }
  ]
}
```

---

## 🔄 Workflows

### GET `/api/workflows`
List all workflows for a namespace.

**Query Parameters:**
- `namespace` (optional): Filter by namespace (default: "global")

**Response:**
```json
{
  "workflows": [
    {
      "id": "uuid-here",
      "display_name": "Customer Support Flow",
      "namespace": "global",
      "graph": {
        "nodes": [...],
        "edges": [...]
      }
    }
  ]
}
```

### GET `/api/workflows/{id}`
Get a specific workflow by ID.

**Response:**
```json
{
  "id": "uuid-here",
  "display_name": "Customer Support Flow",
  "namespace": "global",
  "graph": {
    "nodes": [...],
    "edges": [...]
  }
}
```

### POST `/api/workflows`
Create or update a workflow.

**Request:**
```json
{
  "id": "optional-uuid",
  "display_name": "My Workflow",
  "namespace": "global",
  "graph": {
    "nodes": [
      {
        "id": "start",
        "type": "startNode",
        "position": { "x": 250, "y": 50 },
        "data": { "label": "Start" }
      }
    ],
    "edges": []
  }
}
```

**Response:**
```json
{
  "status": "ok",
  "workflow_id": "uuid-here"
}
```

---

## 🔍 RAG (Retrieval Augmented Generation)

### POST `/api/ingest`
Ingest documents or web content for RAG search.

**Web Ingestion Request:**
```json
{
  "source": "web",
  "urls": ["https://example.com"],
  "namespace": "global"
}
```

**Local File Ingestion Request:**
```json
{
  "source": "local",
  "path": "/path/to/documents",
  "namespace": "global"
}
```

**Response:**
```json
{
  "status": "ok",
  "documents_ingested": 15
}
```

### POST `/api/search`
Perform hybrid RAG search (vector + BM25 + rerank).

**Request:**
```json
{
  "query": "What is the pricing model?",
  "namespace": "global",
  "top_k": 12
}
```

**Response:**
```json
{
  "results": [
    {
      "id": "doc-1",
      "text": "Our pricing model is...",
      "score": 0.95,
      "metadata": {}
    }
  ]
}
```

---

## 🎯 Example Use Cases

### 1. Simple Question (Auto-Routing)
```bash
curl -X POST http://localhost:8000/api/orchestrate \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "user123",
    "message": "What are your hours?",
    "namespace": "global"
  }'
```

### 2. Research Query (Direct Agent)
```bash
curl -X POST http://localhost:8000/api/orchestrate \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "user123",
    "message": "Research the latest AI trends",
    "namespace": "global",
    "agent_preference": "research"
  }'
```

### 3. Email Draft (Marketing Agent)
```bash
curl -X POST http://localhost:8000/api/orchestrate \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "user123",
    "message": "Draft an email about our new product launch",
    "namespace": "global",
    "agent_preference": "marketing"
  }'
```

### 4. Check System Status
```bash
curl http://localhost:8000/api/status
```

### 5. List All Agents
```bash
curl http://localhost:8000/api/agents
```

---

## 🔐 Authentication

Currently, the API uses basic user_id-based authentication. In production:
- Implement OAuth 2.0 / JWT tokens
- Add API key authentication for service-to-service calls
- Use middleware for rate limiting

---

## 📊 Rate Limits

**Development:** No limits  
**Production (Recommended):**
- 100 requests/minute per user
- 1000 requests/hour per API key
- Burst allowance: 20 requests/second

---

## ⚡ Performance

**Typical Response Times:**
- Status check: < 50ms
- Agent listing: < 100ms
- Orchestration (simple): 1-3 seconds
- Orchestration (complex with RAG): 3-8 seconds
- Workflow execution: 5-30 seconds

---

## 🐛 Error Responses

### 400 Bad Request
```json
{
  "error": "Missing required field: message"
}
```

### 404 Not Found
```json
{
  "error": "Agent not found: invalid_agent"
}
```

### 500 Internal Server Error
```json
{
  "error": "Database connection failed",
  "details": "Connection timeout"
}
```

---

## 🔄 Webhooks (Coming Soon)

Future support for webhook notifications:
- Workflow completion
- Agent task updates
- System health alerts

---

## 📦 SDKs

### Python SDK (Example)
```python
from gasable_client import GasableClient

client = GasableClient(base_url="http://localhost:8000")

# Auto-routing
response = client.orchestrate(
    user_id="user123",
    message="What is Gasable?",
    namespace="global"
)

# Direct agent
response = client.orchestrate(
    user_id="user123",
    message="Research AI trends",
    namespace="global",
    agent_preference="research"
)
```

### JavaScript SDK (Example)
```javascript
import { GasableClient } from 'gasable-client';

const client = new GasableClient('http://localhost:8000');

// Auto-routing
const response = await client.orchestrate({
  userId: 'user123',
  message: 'What is Gasable?',
  namespace: 'global'
});

// Direct agent
const response = await client.orchestrate({
  userId: 'user123',
  message: 'Research AI trends',
  namespace: 'global',
  agentPreference: 'research'
});
```

---

## 📚 Additional Resources

- **Dashboard UI**: http://localhost:3000
- **API Docs (Interactive)**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc
- **GitHub**: https://github.com/your-org/gasable-hub

---

## 🆘 Support

For API support:
- Email: api-support@gasable.com
- Discord: https://discord.gg/gasable
- GitHub Issues: https://github.com/your-org/gasable-hub/issues

---

**Version:** 1.0.0  
**Last Updated:** October 2025  
**Status:** ✅ Production Ready

