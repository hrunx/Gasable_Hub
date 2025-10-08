#!/usr/bin/env python3
"""
Verify RAG memory integration and show usage examples.

This script checks:
1. Database connection
2. gasable_index table structure
3. Agent configurations
4. Provides test queries
"""

import os
import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from gasable_hub.db.postgres import connect as pg_connect

# Import search functions only if needed (requires OPENAI_API_KEY)
try:
    from gasable_hub.orch.search import hybrid_query, embed_query
    from gasable_hub.orch.answer import synthesize_answer
    RAG_SEARCH_AVAILABLE = True
except Exception:
    RAG_SEARCH_AVAILABLE = False


def verify_database():
    """Check database connection and structure."""
    print("=" * 60)
    print("🔍 Verifying RAG Memory Setup")
    print("=" * 60)
    
    try:
        with pg_connect() as conn:
            with conn.cursor() as cur:
                # Check gasable_index structure
                cur.execute("""
                    SELECT 
                        column_name, 
                        data_type,
                        CASE 
                            WHEN data_type = 'USER-DEFINED' 
                            THEN udt_name 
                            ELSE data_type 
                        END as type_detail
                    FROM information_schema.columns 
                    WHERE table_name = 'gasable_index'
                    ORDER BY ordinal_position
                """)
                columns = cur.fetchall()
                
                print("\n✅ Database Connection: SUCCESS")
                print(f"\n📊 gasable_index Table Structure:")
                print("-" * 60)
                for col in columns:
                    col_name, dtype, detail = col
                    print(f"  {col_name:20s} {detail}")
                
                # Check row count
                cur.execute("SELECT COUNT(*) FROM public.gasable_index")
                total = cur.fetchone()[0]
                
                cur.execute("""
                    SELECT COUNT(*) FROM public.gasable_index 
                    WHERE embedding_1536 IS NOT NULL
                """)
                with_embeddings = cur.fetchone()[0]
                
                print(f"\n📈 Index Statistics:")
                print("-" * 60)
                print(f"  Total documents: {total:,}")
                print(f"  With embeddings:  {with_embeddings:,}")
                print(f"  Coverage: {(with_embeddings/total*100 if total > 0 else 0):.1f}%")
                
                # Check per agent/namespace
                cur.execute("""
                    SELECT agent_id, namespace, COUNT(*) as count
                    FROM public.gasable_index
                    GROUP BY agent_id, namespace
                    ORDER BY agent_id, namespace
                """)
                stats = cur.fetchall()
                
                if stats:
                    print(f"\n📁 Documents by Agent/Namespace:")
                    print("-" * 60)
                    for agent_id, namespace, count in stats:
                        print(f"  {agent_id:15s} | {namespace:10s} | {count:,} docs")
                
                # Check agents
                cur.execute("""
                    SELECT 
                        id, 
                        display_name, 
                        tool_allowlist,
                        top_k,
                        CASE WHEN assistant_id IS NOT NULL AND assistant_id != '' 
                             THEN 'Provisioned' 
                             ELSE 'Missing' 
                        END as assistant_status
                    FROM public.gasable_agents
                    ORDER BY id
                """)
                agents = cur.fetchall()
                
                print(f"\n🤖 Agent Configurations:")
                print("-" * 60)
                for agent_id, name, tools, top_k, asst_status in agents:
                    rag_enabled = any('rag' in t.lower() for t in tools) if tools else False
                    status = "✅" if rag_enabled else "❌"
                    print(f"  {status} {name} ({agent_id})")
                    print(f"      Tools: {', '.join(tools) if tools else 'None'}")
                    print(f"      Top-K: {top_k} | Assistant: {asst_status}")
                    print()
                
                return True
                
    except Exception as e:
        print(f"\n❌ Database Error: {e}")
        return False


def test_rag_search():
    """Test RAG search functionality."""
    print("\n" + "=" * 60)
    print("🧪 Testing RAG Search")
    print("=" * 60)
    
    if not RAG_SEARCH_AVAILABLE:
        print("\n⚠️  RAG search test skipped (OPENAI_API_KEY not set)")
        print("    Set OPENAI_API_KEY to test search functionality")
        return
    
    test_query = "What is Gasable?"
    test_agent = "default"
    test_namespace = "global"
    
    print(f"\nQuery: '{test_query}'")
    print(f"Agent: {test_agent}")
    print(f"Namespace: {test_namespace}")
    print("-" * 60)
    
    try:
        # Run hybrid search
        result = hybrid_query(test_query, test_agent, test_namespace, k=5)
        hits = result.get("hits", [])
        
        if not hits:
            print("\n⚠️  No results found. Possible reasons:")
            print("  1. No documents indexed yet")
            print("  2. Documents don't match the query")
            print("  3. agent_id or namespace mismatch")
            return
        
        print(f"\n✅ Found {len(hits)} results:")
        print("-" * 60)
        
        for i, hit in enumerate(hits[:3], 1):
            score = hit.get('score', 0)
            text = hit.get('txt', '')[:200]
            metadata = hit.get('metadata', {})
            
            print(f"\n[{i}] Score: {score:.4f}")
            print(f"    Text: {text}...")
            if metadata:
                source = metadata.get('source', 'unknown')
                print(f"    Source: {source}")
        
        # Generate answer
        print("\n" + "-" * 60)
        print("📝 Generated Answer:")
        print("-" * 60)
        answer = synthesize_answer(test_query, hits)
        print(answer)
        
    except Exception as e:
        print(f"\n❌ Search Error: {e}")
        import traceback
        traceback.print_exc()


def show_usage_examples():
    """Show code examples for using RAG memory."""
    print("\n" + "=" * 60)
    print("💡 Usage Examples")
    print("=" * 60)
    
    print("""
1️⃣  Query RAG Memory from Python:
   
    from gasable_hub.orch.search import hybrid_query
    from gasable_hub.orch.answer import synthesize_answer
    
    # Search with agent-specific memory
    result = hybrid_query(
        q="What products do we sell?",
        agent_id="support",      # or "default" for shared memory
        namespace="global",      # or company-specific namespace
        k=12                     # number of results
    )
    
    # Generate grounded answer
    answer = synthesize_answer(
        q="What products do we sell?",
        hits=result["hits"]
    )

2️⃣  Query via MCP Tool (from OpenAI Assistant):
   
    The agents automatically have access to rag_search_tool:
    
    {
      "name": "rag_search_tool",
      "parameters": {
        "query": "What products do we sell?",
        "k": 12,
        "agent_id": "support",
        "namespace": "global"
      }
    }

3️⃣  Query via REST API:
   
    POST http://localhost:8000/api/orchestrate
    {
      "user_id": "user123",
      "message": "What products do we sell?",
      "namespace": "global",
      "agent_preference": "support"  // optional
    }
    
    The agent will automatically use RAG memory if relevant!

4️⃣  Add Documents to Memory:
   
    # Via ingestion tools
    POST http://localhost:8000/api/ingest/local
    {
      "path": "/path/to/docs",
      "agent_id": "support",    // agent-specific memory
      "namespace": "global"
    }
    
    # Or via web ingestion
    POST http://localhost:8000/api/ingest/web
    {
      "urls": ["https://example.com/docs"],
      "agent_id": "support",
      "namespace": "global"
    }

5️⃣  Configure Agent RAG Settings:
   
    UPDATE public.gasable_agents
    SET rag_settings = '{
      "rerank": true,
      "rerank_model": "gpt-4o-mini",
      "top_k": 12
    }'::jsonb
    WHERE id = 'support';
""")


def main():
    """Main verification flow."""
    # Check environment
    db_env = ["DATABASE_URL", "SUPABASE_DB_URL", "PG_HOST"]
    
    has_db = any(os.getenv(e) for e in db_env)
    
    if not has_db:
        print(f"❌ Missing database configuration. Set one of: {', '.join(db_env)}")
        return False
    
    if not os.getenv("OPENAI_API_KEY"):
        print("⚠️  OPENAI_API_KEY not set - RAG search test will be skipped\n")
    
    # Run verification
    if not verify_database():
        return False
    
    # Test search
    test_rag_search()
    
    # Show examples
    show_usage_examples()
    
    print("\n" + "=" * 60)
    print("✅ Verification Complete!")
    print("=" * 60)
    print("\nNext steps:")
    print("  1. Ensure you have documents indexed (check counts above)")
    print("  2. Test queries via the chat interface at http://localhost:3000")
    print("  3. Agents will automatically use RAG memory when relevant")
    print("  4. The orchestrator routes to agents, who use RAG as needed")
    print("\n")
    
    return True


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)

