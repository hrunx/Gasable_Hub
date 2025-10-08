# 🧠 RAG Memory Architecture

## Overview

Your **gasable_index** table is already integrated as memory for all agents through the RAG (Retrieval-Augmented Generation) system. The orchestrator doesn't need direct memory access because it's a **routing layer** - the agents themselves use RAG memory to answer queries.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER MESSAGE                             │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     ORCHESTRATOR (Routing Layer)                 │
│  • Analyzes intent                                               │
│  • Routes to best agent (Support/Research/Marketing/Procurement) │
│  • Uses keyword matching + rules                                 │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SELECTED AGENT (OpenAI Assistant)             │
│  • Has tool_allowlist: ['rag_search_tool', ...]                 │
│  • Decides when to query RAG memory                              │
│  • Can call other tools (orders, email, etc.)                    │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    RAG SEARCH TOOL                               │
│  gasable_hub/tools/rag_search.py                                 │
│  • Hybrid search (vector + BM25)                                 │
│  • Agent-aware (agent_id filter)                                 │
│  • Namespace isolation                                           │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                 HYBRID SEARCH ENGINE                             │
│  gasable_hub/orch/search.py                                      │
│                                                                   │
│  ┌────────────────────┐        ┌────────────────────┐           │
│  │  Vector Search     │        │   BM25 Search      │           │
│  │  (embedding_1536)  │        │   (tsv column)     │           │
│  │  • HNSW index      │        │   • GIN index      │           │
│  │  • Cosine sim      │        │   • Full-text      │           │
│  └─────────┬──────────┘        └─────────┬──────────┘           │
│            │                              │                      │
│            └──────────────┬───────────────┘                      │
│                           ▼                                      │
│                    ┌──────────────┐                              │
│                    │  Dedupe      │                              │
│                    │  & Merge     │                              │
│                    └──────┬───────┘                              │
│                           ▼                                      │
│                    ┌──────────────┐                              │
│                    │  LLM Rerank  │                              │
│                    │  (gpt-4o)    │                              │
│                    └──────┬───────┘                              │
│                           ▼                                      │
│                      Top K Results                               │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    GASABLE_INDEX TABLE                           │
│  • node_id (primary key)                                         │
│  • text (full document text)                                     │
│  • embedding_1536 vector(1536)  ← Your 1536-dim vectors!        │
│  • tsv (full-text search)                                        │
│  • agent_id (agent isolation)                                    │
│  • namespace (tenant isolation)                                  │
│  • li_metadata (source, chunks, etc.)                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔑 Key Components

### 1. **gasable_index Table** (Your Memory Store)

```sql
CREATE TABLE public.gasable_index (
  node_id TEXT PRIMARY KEY,              -- Unique document ID
  text TEXT,                             -- Document content
  embedding_1536 vector(1536),           -- ✨ Your 1536-dim vectors
  tsv tsvector,                          -- Full-text search index
  agent_id TEXT NOT NULL DEFAULT 'default',  -- Agent isolation
  namespace TEXT NOT NULL DEFAULT 'global',  -- Tenant isolation
  chunk_index INT NOT NULL DEFAULT 0,    -- Chunk ordering
  li_metadata JSONB                      -- Source metadata
);

-- Indexes for performance
CREATE INDEX gasable_index_hnsw_1536 
  ON gasable_index USING hnsw (embedding_1536 vector_cosine_ops);
CREATE INDEX gasable_index_tsv_idx 
  ON gasable_index USING gin (tsv);
CREATE INDEX gasable_index_agent_ns_idx 
  ON gasable_index (agent_id, namespace);
```

### 2. **RAG Search Tool** (`gasable_hub/tools/rag_search.py`)

```python
async def rag_search_tool(
    query: str,              # User question
    k: int = 12,            # Number of results
    agent_id: str = "default",  # Agent-specific memory
    namespace: str = "global",  # Namespace isolation
) -> dict:
    """
    Hybrid search with:
    1. Vector search (embedding_1536 cosine similarity)
    2. BM25 full-text search (tsv column)
    3. Deduplication
    4. LLM reranking
    5. Answer synthesis
    """
    result = hybrid_query(query, agent_id, namespace, k)
    answer = synthesize_answer(query, result["hits"])
    return {"status": "ok", "hits": result["hits"], "answer": answer}
```

### 3. **Hybrid Search Engine** (`gasable_hub/orch/search.py`)

#### Vector Search
```python
def vector_search(vec: List[float], agent_id: str, namespace: str, k: int = 40):
    """
    1. Embed query using text-embedding-3-small (1536 dims)
    2. Search using HNSW index on embedding_1536
    3. Filter by agent_id (exact match or 'default')
    4. Filter by namespace
    5. Optional keyword steering (agent-aware)
    """
```

#### BM25 Search
```python
def bm25_search(q: str, agent_id: str, namespace: str, k: int = 40):
    """
    1. Full-text search using PostgreSQL tsv column
    2. ts_rank_cd scoring
    3. Filter by agent_id and namespace
    4. Optional keyword steering
    """
```

#### Hybrid Query
```python
def hybrid_query(q: str, agent_id: str, namespace: str, k: int = 12):
    """
    1. Run vector_search (top 40)
    2. Run bm25_search (top 40)
    3. Deduplicate by node_id, keep best score
    4. LLM rerank (gpt-4o-mini) for relevance
    5. Return top k results
    """
```

### 4. **Agent Configuration**

```sql
-- Agents in public.gasable_agents
id           | display_name       | tool_allowlist
-------------|--------------------|---------------------------------
support      | Support Agent      | {rag_search_tool}
procurement  | Procurement Agent  | {rag_search_tool, orders.place}
research     | Research Agent     | {rag_search_tool, ingest_web, ingest_urls}
marketing    | Marketing Agent    | {rag_search_tool, gmail.send, gmail.draft}
```

Each agent:
- Has OpenAI Assistant ID (created via `gasable_hub/agents/boot.py`)
- Has `tool_allowlist` defining available tools
- Can call `rag_search_tool` automatically when needed
- Has `rag_settings` for custom configuration:
  ```json
  {
    "rerank": true,
    "rerank_model": "gpt-4o-mini",
    "top_k": 12
  }
  ```

---

## 🎯 How the Orchestrator Uses Memory

**IMPORTANT:** The orchestrator **doesn't use memory directly**. Here's the flow:

### Step 1: User sends message
```bash
POST /api/orchestrate
{
  "user_id": "user123",
  "message": "What products do we sell?",
  "namespace": "global"
}
```

### Step 2: Orchestrator routes to agent
```python
# webapp.py: _choose_agent_with_rules()
# Analyzes message intent using keywords/rules
# Selects: "support" agent
```

### Step 3: Agent uses RAG memory
```
OpenAI Assistant (support) receives message
  → Decides it needs context about products
  → Calls rag_search_tool("What products do we sell?")
  → Gets context from gasable_index
  → Synthesizes answer with citations
```

### Step 4: Response returned
```json
{
  "agent": "support",
  "message": "We sell [product list with citations]...",
  "status": "completed"
}
```

---

## 🚀 Usage Examples

### Query RAG Memory Directly (Python)

```python
from gasable_hub.orch.search import hybrid_query
from gasable_hub.orch.answer import synthesize_answer

# Search
result = hybrid_query(
    q="What is Gasable?",
    agent_id="support",    # or "default" for shared
    namespace="global",
    k=12
)

# Generate answer
answer = synthesize_answer("What is Gasable?", result["hits"])
print(answer)
```

### Query via Chat Interface

```
User: "What products do we sell?"
  → Orchestrator selects Support Agent
  → Support Agent calls rag_search_tool automatically
  → Returns grounded answer with [citations]
```

### Add Documents to Memory

```python
# Local files
POST /api/ingest/local
{
  "path": "/path/to/docs",
  "agent_id": "support",     # Agent-specific memory
  "namespace": "global",     # Namespace isolation
  "chunk_size": 1000,
  "chunk_overlap": 200
}

# Web URLs
POST /api/ingest/web
{
  "urls": ["https://example.com/docs"],
  "agent_id": "support",
  "namespace": "global"
}

# Google Drive
POST /api/ingest/drive
{
  "folder_id": "xxx",
  "agent_id": "support",
  "namespace": "global"
}
```

### Configure Agent RAG Settings

```sql
UPDATE public.gasable_agents
SET rag_settings = '{
  "rerank": true,
  "rerank_model": "gpt-4o-mini",
  "top_k": 15
}'::jsonb
WHERE id = 'support';
```

---

## 🎛️ Memory Isolation

### Agent-Level Isolation

```python
# Agent-specific memory
INSERT INTO gasable_index (node_id, text, embedding_1536, agent_id)
VALUES ('doc-1', 'Support FAQ...', vector, 'support');

# Shared memory (accessible by all agents)
INSERT INTO gasable_index (node_id, text, embedding_1536, agent_id)
VALUES ('doc-2', 'Company info...', vector, 'default');
```

Search query:
```sql
WHERE (agent_id = 'support' OR agent_id = 'default')
-- Support agent gets both support-specific and shared docs
```

### Namespace Isolation (Multi-Tenancy)

```python
# Company A's data
INSERT INTO gasable_index (..., namespace='company_a')

# Company B's data  
INSERT INTO gasable_index (..., namespace='company_b')

# Search only returns docs from the specified namespace
```

---

## 📊 Performance Optimizations

### 1. HNSW Vector Index
```sql
CREATE INDEX gasable_index_hnsw_1536 
  ON gasable_index USING hnsw (embedding_1536 vector_cosine_ops);
-- Fast approximate nearest neighbor search
-- O(log n) instead of O(n)
```

### 2. GIN Full-Text Index
```sql
CREATE INDEX gasable_index_tsv_idx 
  ON gasable_index USING gin (tsv);
-- Fast text search
-- Handles stemming, stop words, etc.
```

### 3. Agent/Namespace Filter Index
```sql
CREATE INDEX gasable_index_agent_ns_idx 
  ON gasable_index (agent_id, namespace);
-- Fast filtering before vector search
```

### 4. Embedding Cache
```python
# gasable_hub/orch/search.py
_EMBED_CACHE: dict[str, tuple[List[float], float]] = {}
# Caches embeddings for 600 seconds
# Avoids redundant OpenAI API calls
```

### 5. LLM Reranking
```python
# Optional reranking with gpt-4o-mini
# Can be disabled for faster responses:
os.environ["RAG_RERANK"] = "0"
```

---

## 🔧 Verification & Testing

### Run Verification Script

```bash
cd /Users/hrn/Desktop/gasable_mcp
python scripts/verify_rag_memory.py
```

This will:
1. ✅ Check database connection
2. ✅ Verify gasable_index structure
3. ✅ Show agent configurations
4. ✅ Display memory statistics
5. ✅ Test RAG search
6. ✅ Show usage examples

### Run SQL Verification

```bash
# Apply the verification migration
psql $DATABASE_URL -f migrations/0018_verify_rag_memory.sql

# Or via webapp
curl -X POST http://localhost:8000/api/db/migrate
```

---

## ❓ FAQ

### Q: Does the orchestrator need RAG as a tool?
**A: No.** The orchestrator is just routing logic. It doesn't respond to users directly. The **agents** are the ones that use RAG memory.

### Q: How do I add RAG to a specific agent?
**A:** Update the agent's `tool_allowlist`:
```sql
UPDATE public.gasable_agents
SET tool_allowlist = array_append(tool_allowlist, 'rag_search_tool')
WHERE id = 'myagent';
```

### Q: Can I have agent-specific memory?
**A: Yes!** When ingesting documents:
```python
# Only accessible by 'research' agent
ingest_documents(..., agent_id='research')

# Accessible by all agents
ingest_documents(..., agent_id='default')
```

### Q: How do I improve search quality?
**A:**
1. Increase `top_k` for more results
2. Enable reranking (default: enabled)
3. Use better rerank model (gpt-4o instead of gpt-4o-mini)
4. Add more diverse training data
5. Use agent-specific keywords

### Q: How do I see what the agent is retrieving?
**A:** Check the `agent_runs` table:
```sql
SELECT 
  user_message, 
  tool_calls,
  result_summary
FROM public.agent_runs
ORDER BY created_at DESC
LIMIT 10;
```

### Q: Can I use this with other LLM providers?
**A:** Currently uses OpenAI for:
- Embeddings: `text-embedding-3-small` (1536 dims)
- Reranking: `gpt-4o-mini`
- Answer synthesis: `gpt-4o-mini`

You can modify `gasable_hub/orch/search.py` and `gasable_hub/orch/answer.py` to use other providers.

---

## 📝 Summary

✅ **gasable_index** is already integrated as RAG memory  
✅ **All agents** have access to `rag_search_tool`  
✅ **Hybrid search** (vector + BM25) with LLM reranking  
✅ **Agent isolation** (agent_id filter)  
✅ **Namespace isolation** (multi-tenancy)  
✅ **Performance optimized** (HNSW, GIN indexes)  
✅ **Orchestrator routes** to agents who use memory

**The orchestrator is in control** - it selects which agent to use, and that agent then decides when to query RAG memory based on the user's message.

---

## 🎯 Next Steps

1. Run verification script: `python scripts/verify_rag_memory.py`
2. Check you have documents indexed (if not, use ingestion tools)
3. Test via chat interface: http://localhost:3000
4. Monitor `agent_runs` table to see RAG tool usage
5. Customize agent RAG settings as needed

**Need more control?** You can:
- Add orchestrator as an agent with RAG access
- Create a meta-orchestrator that queries memory before routing
- Implement planning/memory for long-running sessions (see `orchestrator_sessions` table)

