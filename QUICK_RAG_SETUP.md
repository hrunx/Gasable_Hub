# 🚀 Quick RAG Memory Setup

## ✅ GOOD NEWS!

Your `gasable_index` with 1536-dimensional vectors is **already integrated** as memory! 

The orchestrator **doesn't need RAG directly** because:
- The orchestrator is just a **routing layer** (picks which agent to use)
- The **agents** are the ones that use RAG memory
- Agents already have `rag_search_tool` in their `tool_allowlist`

## 📋 What's Already Working

✅ **RAG Search Tool** - Queries `gasable_index` with hybrid search (vector + BM25)  
✅ **All Agents Have Access** - Support, Research, Marketing, Procurement  
✅ **1536-dim Vectors** - Using `embedding_1536` column  
✅ **Performance Indexes** - HNSW (vector) + GIN (full-text)  
✅ **Agent Isolation** - Each agent can have private + shared memory  
✅ **Namespace Isolation** - Multi-tenancy support  

## 🔄 How It Works

```
User Message
    ↓
Orchestrator (routes to best agent)
    ↓
Agent (Support/Research/Marketing/Procurement)
    ↓
Agent automatically calls rag_search_tool when needed
    ↓
Hybrid Search (Vector + BM25) on gasable_index
    ↓
Returns context with [citations]
```

## 🎯 Quick Verification

### Option 1: Via SQL (Fastest)

```bash
# Source your .env or set env vars
export DATABASE_URL="postgresql://user:pass@host:5432/dbname"
# or
export PG_HOST=localhost
export PG_PORT=5432
export PG_USER=postgres
export PG_PASSWORD=yourpass
export PG_DBNAME=gasable_db

# Run verification migration
cd /Users/hrn/Desktop/gasable_mcp
source venv/bin/activate
psql $DATABASE_URL -f migrations/0018_verify_rag_memory.sql
```

This will show:
- ✅ gasable_index structure
- ✅ Agent configurations and tool access
- ✅ Memory statistics (docs per agent/namespace)
- ✅ Performance indexes

### Option 2: Via Python Script

```bash
cd /Users/hrn/Desktop/gasable_mcp
source venv/bin/activate

# Set environment variables
export DATABASE_URL="postgresql://user:pass@host:5432/dbname"
export OPENAI_API_KEY="sk-..."  # Optional: for testing search

# Run verification
python scripts/verify_rag_memory.py
```

This will:
1. Check database connection ✅
2. Verify gasable_index structure ✅
3. Show agent configurations ✅
4. Display memory statistics ✅
5. Test RAG search (if OPENAI_API_KEY is set) ✅
6. Show usage examples ✅

### Option 3: Via Web UI

```bash
# Start your backend
cd /Users/hrn/Desktop/gasable_mcp
source venv/bin/activate
python webapp.py

# In another terminal, check status
curl http://localhost:8000/api/status
```

Then test in the chat interface:
```
http://localhost:3000

Try: "What is Gasable?"
```

The orchestrator will route to the Support agent, who will automatically query RAG memory if relevant.

## 📊 Check Current Memory Status

### Quick DB Query

```sql
-- Count total documents
SELECT COUNT(*) as total_docs FROM public.gasable_index;

-- Count by agent and namespace
SELECT 
    agent_id,
    namespace,
    COUNT(*) as doc_count,
    COUNT(CASE WHEN embedding_1536 IS NOT NULL THEN 1 END) as with_vectors
FROM public.gasable_index
GROUP BY agent_id, namespace
ORDER BY agent_id, namespace;

-- Check agent configurations
SELECT 
    id,
    display_name,
    tool_allowlist,
    CASE WHEN assistant_id IS NOT NULL THEN 'Provisioned' ELSE 'Missing' END as assistant_status
FROM public.gasable_agents
ORDER BY id;
```

### Expected Output

```
agent_id  | namespace | doc_count | with_vectors
----------|-----------|-----------|-------------
default   | global    | 1,234     | 1,234
support   | global    | 56        | 56
research  | global    | 89        | 89
```

## 🔧 If You Don't Have Documents Yet

Add documents to memory using ingestion tools:

```bash
# Local files
curl -X POST http://localhost:8000/api/ingest/local \
  -H "Content-Type: application/json" \
  -d '{
    "path": "/path/to/docs",
    "agent_id": "default",
    "namespace": "global"
  }'

# Web URLs
curl -X POST http://localhost:8000/api/ingest/web \
  -H "Content-Type: application/json" \
  -d '{
    "urls": ["https://example.com/docs"],
    "agent_id": "default",
    "namespace": "global"
  }'

# Google Drive
curl -X POST http://localhost:8000/api/ingest/drive \
  -H "Content-Type: application/json" \
  -d '{
    "folder_id": "your-gdrive-folder-id",
    "agent_id": "default",
    "namespace": "global"
  }'
```

## 🎯 Test RAG Integration

### Test 1: Direct API Call

```bash
curl -X POST http://localhost:8000/api/orchestrate \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "test_user",
    "message": "What products do we sell?",
    "namespace": "global"
  }'
```

Expected:
```json
{
  "agent": "support",
  "message": "Based on our catalog, we sell [product list with citations]...",
  "status": "completed"
}
```

### Test 2: Via Chat UI

1. Go to http://localhost:3000
2. Select "Multi-Agent (Orchestrator)" mode
3. Type: "What is Gasable?"
4. See response with agent attribution

### Test 3: Direct Agent Mode

1. Go to http://localhost:3000
2. Select "Support Agent" from right sidebar
3. Type: "What information do you have?"
4. Agent will query RAG memory and respond

## ❓ FAQ

### Q: Do I need to add rag_search to the orchestrator?
**A: No!** The orchestrator just routes. The agents use RAG.

### Q: How does the agent know when to use RAG?
**A:** The OpenAI Assistant automatically decides based on the user's message. If it needs context, it calls `rag_search_tool`.

### Q: Can I force the agent to always use RAG?
**A:** Modify the agent's `system_prompt`:
```sql
UPDATE public.gasable_agents
SET system_prompt = system_prompt || ' Always search the knowledge base first using rag_search_tool before answering.'
WHERE id = 'support';
```

### Q: How do I see what the agent retrieved?
**A:** Check the `agent_runs` table:
```sql
SELECT 
    user_message,
    selected_agent,
    tool_calls,
    result_summary,
    created_at
FROM public.agent_runs
ORDER BY created_at DESC
LIMIT 5;
```

### Q: Can different agents have different memory?
**A: Yes!** When ingesting:
```python
# Research agent only
ingest(..., agent_id='research')

# All agents (shared)
ingest(..., agent_id='default')
```

Search query filters:
```sql
WHERE (agent_id = 'research' OR agent_id = 'default')
-- Research agent sees both research-specific and shared docs
```

## 📖 Read More

- **Full Architecture**: `RAG_MEMORY_ARCHITECTURE.md` - Complete technical details
- **API Docs**: `API_DOCUMENTATION.md` - All API endpoints
- **Verification Script**: `scripts/verify_rag_memory.py` - Detailed verification

## 🎉 Summary

Your setup is **already complete**! The orchestrator maintains control by:
1. Routing user messages to the best agent
2. Agents use `rag_search_tool` when they need context
3. RAG queries `gasable_index` with your 1536-dim vectors
4. Hybrid search (vector + BM25) finds relevant docs
5. Agent responds with grounded answers

**No additional configuration needed!** Just ensure you have documents indexed.

---

**Still have questions?** Check:
1. Database has documents: `SELECT COUNT(*) FROM gasable_index`
2. Agents are provisioned: `SELECT id, assistant_id FROM gasable_agents`
3. Backend is running: `curl http://localhost:8000/api/status`
4. Environment variables are set (DATABASE_URL, OPENAI_API_KEY)

