# 🧠 RAG Memory: Already Integrated! ✅

## TL;DR

**Your `gasable_index` (with 1536-dim vectors) is already working as memory for all agents.**

The orchestrator doesn't need RAG directly because:
- **Orchestrator** = Routing layer (picks which agent to use)
- **Agents** = Use RAG memory automatically via `rag_search_tool`

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────┐
│                      USER                                 │
│            "What products do we sell?"                    │
└────────────────────────┬─────────────────────────────────┘
                         │
                         ▼
        ┌────────────────────────────────────┐
        │      ORCHESTRATOR (Routing)         │
        │  ✓ Analyzes intent                  │
        │  ✓ Picks best agent                 │
        │  ✓ Uses keyword rules               │
        └────────────┬───────────────────────┘
                     │ Selects: "Support Agent"
                     ▼
    ┌────────────────────────────────────────────┐
    │      SUPPORT AGENT (OpenAI Assistant)       │
    │  ✓ Has tool_allowlist: [rag_search_tool]   │
    │  ✓ Decides when to query memory            │
    │  ✓ Can call other tools too                │
    └────────────┬───────────────────────────────┘
                 │ Calls: rag_search_tool(...)
                 ▼
┌────────────────────────────────────────────────────┐
│              RAG SEARCH TOOL                        │
│  ✓ Hybrid search (vector + BM25)                   │
│  ✓ Agent-aware filtering (agent_id)                │
│  ✓ Namespace isolation                             │
│  ✓ LLM reranking                                   │
└────────────┬───────────────────────────────────────┘
             │
             ▼
┌────────────────────────────────────────────────────┐
│            GASABLE_INDEX TABLE                      │
│  ┌──────────────────────────────────────────┐     │
│  │ • embedding_1536 vector(1536) ← YOURS!   │     │
│  │ • tsv (full-text search index)           │     │
│  │ • agent_id (agent isolation)             │     │
│  │ • namespace (tenant isolation)           │     │
│  │ • text (document content)                │     │
│  │ • li_metadata (source info)              │     │
│  └──────────────────────────────────────────┘     │
│                                                     │
│  Indexes:                                          │
│  • HNSW on embedding_1536 (fast vector search)    │
│  • GIN on tsv (fast full-text search)             │
│  • B-tree on (agent_id, namespace)                │
└─────────────────────────────────────────────────────┘
```

## Current Agent Configurations

All agents already have RAG access:

| Agent ID     | Display Name       | Tools                                          |
|--------------|--------------------|-------------------------------------------------|
| `support`    | Support Agent      | `rag_search_tool`                              |
| `procurement`| Procurement Agent  | `rag_search_tool`, `orders.place`              |
| `research`   | Research Agent     | `rag_search_tool`, `ingest_web`, `ingest_urls` |
| `marketing`  | Marketing Agent    | `rag_search_tool`, `gmail.send`, `gmail.draft` |

## Example Flow

### User Query
```
User: "What products do we sell?"
```

### Step 1: Orchestrator Routes
```python
# webapp.py: _choose_agent_with_rules()
message = "What products do we sell?"
# Keyword matching: "products" → company info → Support
agent = "support"
```

### Step 2: Agent Receives Message
```
OpenAI Assistant (support) receives:
"What products do we sell?"

Agent thinks:
"I need product information from the knowledge base"

Agent calls tool:
{
  "name": "rag_search_tool",
  "parameters": {
    "query": "products we sell",
    "k": 12,
    "agent_id": "support",
    "namespace": "global"
  }
}
```

### Step 3: RAG Search Executes
```python
# gasable_hub/tools/rag_search.py
# 1. Embed query → [1536 floats]
# 2. Vector search on embedding_1536 (top 40)
# 3. BM25 search on tsv (top 40)
# 4. Dedupe by node_id
# 5. Rerank with gpt-4o-mini
# 6. Return top 12 results with metadata
```

### Step 4: Agent Synthesizes Answer
```
Agent receives context:
[1] Product A: Description... [source: catalog.pdf]
[2] Product B: Description... [source: website]
[3] Product C: Description... [source: database]

Agent responds:
"We sell the following products:
1. Product A - [description] [1]
2. Product B - [description] [2]
3. Product C - [description] [3]

[1] Source: catalog.pdf
[2] Source: website
[3] Source: database"
```

## How to Verify

### Quick Check (SQL)
```bash
export DATABASE_URL="postgresql://user:pass@host:5432/dbname"
psql $DATABASE_URL -c "SELECT COUNT(*) FROM public.gasable_index;"
psql $DATABASE_URL -c "SELECT id, tool_allowlist FROM public.gasable_agents;"
```

### Full Verification
```bash
cd /Users/hrn/Desktop/gasable_mcp
source venv/bin/activate

# Option 1: SQL verification
psql $DATABASE_URL -f migrations/0018_verify_rag_memory.sql

# Option 2: Python script
export OPENAI_API_KEY="sk-..."
python scripts/verify_rag_memory.py
```

### Test in Chat UI
```bash
# Start backend
python webapp.py

# Start frontend (another terminal)
cd /Users/hrn/Desktop/gasable_mcp
npm run dev

# Visit: http://localhost:3000
# Try: "What is Gasable?"
```

## Memory Isolation

### Agent-Specific vs Shared Memory

```sql
-- Shared memory (all agents can access)
INSERT INTO gasable_index (node_id, text, embedding_1536, agent_id, namespace)
VALUES ('doc-1', 'Company info...', vector, 'default', 'global');

-- Support agent only
INSERT INTO gasable_index (node_id, text, embedding_1536, agent_id, namespace)
VALUES ('doc-2', 'Support FAQ...', vector, 'support', 'global');

-- Research agent only
INSERT INTO gasable_index (node_id, text, embedding_1536, agent_id, namespace)
VALUES ('doc-3', 'Research data...', vector, 'research', 'global');
```

Search behavior:
```sql
-- When support agent searches:
WHERE (agent_id = 'support' OR agent_id = 'default')
-- Gets: support-specific + shared docs

-- When research agent searches:
WHERE (agent_id = 'research' OR agent_id = 'default')
-- Gets: research-specific + shared docs
```

### Namespace Isolation (Multi-Tenancy)

```python
# Company A ingests docs
ingest(..., namespace='company_a')

# Company B ingests docs
ingest(..., namespace='company_b')

# Company A user queries
orchestrate(..., namespace='company_a')
# Only sees company_a docs

# Company B user queries
orchestrate(..., namespace='company_b')
# Only sees company_b docs
```

## Performance Characteristics

| Operation | Index Used | Performance |
|-----------|-----------|-------------|
| Vector similarity search | HNSW on `embedding_1536` | O(log n) ~100ms for 1M docs |
| Full-text search | GIN on `tsv` | O(log n) ~50ms for 1M docs |
| Agent/namespace filter | B-tree on `(agent_id, namespace)` | O(log n) ~1ms |
| Embedding generation | OpenAI API cache | Cached: 0ms, Fresh: ~200ms |
| Reranking (12 docs) | gpt-4o-mini | ~500ms |

**Total latency for RAG query: ~700-900ms**

## Key Files

| File | Purpose |
|------|---------|
| `gasable_hub/tools/rag_search.py` | RAG search tool (MCP) |
| `gasable_hub/orch/search.py` | Hybrid search engine |
| `gasable_hub/orch/answer.py` | Answer synthesis |
| `gasable_hub/agents/boot.py` | Agent provisioning |
| `webapp.py` | Orchestration endpoint |
| `migrations/0010_multi_agent_schema.sql` | Agent + memory schema |
| `migrations/0008_embed_1536.sql` | 1536-dim vectors |

## Configuration Options

### Per-Agent RAG Settings

```sql
UPDATE public.gasable_agents
SET rag_settings = '{
  "rerank": true,
  "rerank_model": "gpt-4o-mini",
  "top_k": 15
}'::jsonb
WHERE id = 'support';
```

### Global RAG Configuration

```bash
# Disable reranking for faster responses
export RAG_RERANK=0

# Change embedding model
export OPENAI_EMBED_MODEL="text-embedding-3-small"
export OPENAI_EMBED_DIM=1536

# Change answer model
export OPENAI_MODEL="gpt-4o"
```

## Adding Documents

### Via API
```bash
# Local files
POST /api/ingest/local
{"path": "/docs", "agent_id": "default", "namespace": "global"}

# Web URLs
POST /api/ingest/web
{"urls": ["https://..."], "agent_id": "default", "namespace": "global"}

# Google Drive
POST /api/ingest/drive
{"folder_id": "xxx", "agent_id": "default", "namespace": "global"}
```

### Via Python
```python
from gasable_hub.ingestion.local import ingest_directory

docs = ingest_directory(
    path="/path/to/docs",
    agent_id="default",
    namespace="global",
    chunk_size=1000,
    chunk_overlap=200
)

# Docs are automatically indexed with embeddings
```

## Monitoring & Debugging

### Check Agent Tool Calls
```sql
SELECT 
    user_message,
    selected_agent,
    tool_calls,
    result_summary,
    created_at
FROM public.agent_runs
ORDER BY created_at DESC
LIMIT 10;
```

### Check Memory Stats
```sql
SELECT 
    agent_id,
    namespace,
    COUNT(*) as doc_count,
    COUNT(CASE WHEN embedding_1536 IS NOT NULL THEN 1 END) as with_embeddings,
    AVG(LENGTH(text)) as avg_text_length
FROM public.gasable_index
GROUP BY agent_id, namespace;
```

### Enable Debug Logging
```python
# webapp.py or run_hub.py
import logging
logging.basicConfig(level=logging.DEBUG)
```

## FAQ

**Q: The orchestrator isn't using RAG?**  
A: Correct! The orchestrator routes. The **agents** use RAG.

**Q: How do I force agents to always use RAG?**  
A: Update their `system_prompt` to mention "Always search knowledge base first"

**Q: Can I customize search for each agent?**  
A: Yes! Use `rag_settings` JSONB column per agent.

**Q: What if I want the orchestrator to have memory?**  
A: Create an "orchestrator" agent with RAG access, or use the `orchestrator_sessions` table for planning/memory.

**Q: How do I see what was retrieved?**  
A: Query `agent_runs` table or enable debug logging.

## Summary

✅ **gasable_index** = Your memory store (1536-dim vectors)  
✅ **Agents** = Have `rag_search_tool` access  
✅ **Orchestrator** = Routes to agents (doesn't need RAG)  
✅ **Hybrid Search** = Vector + BM25 + Rerank  
✅ **Agent Isolation** = Each agent can have private memory  
✅ **Namespace Isolation** = Multi-tenancy support  

**Everything is already configured!** Just ensure you have documents indexed and agents provisioned.

---

📚 **More Details:**
- Full architecture: `RAG_MEMORY_ARCHITECTURE.md`
- Quick start: `QUICK_RAG_SETUP.md`
- Verification: `scripts/verify_rag_memory.py`
- SQL verification: `migrations/0018_verify_rag_memory.sql`

