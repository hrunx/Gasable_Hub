-- Verification and setup for RAG memory integration
-- This ensures all agents have proper access to gasable_index memory via rag_search tool

-- 1) Verify gasable_index structure
DO $$
DECLARE 
    has_embedding boolean;
    has_agent_id boolean;
    has_namespace boolean;
    has_tsv boolean;
    row_count integer;
BEGIN
    -- Check columns
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'gasable_index' AND column_name = 'embedding_1536'
    ) INTO has_embedding;
    
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'gasable_index' AND column_name = 'agent_id'
    ) INTO has_agent_id;
    
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'gasable_index' AND column_name = 'namespace'
    ) INTO has_namespace;
    
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'gasable_index' AND column_name = 'tsv'
    ) INTO has_tsv;
    
    -- Check row count
    SELECT COUNT(*) FROM public.gasable_index INTO row_count;
    
    RAISE NOTICE '=== RAG Memory Status ===';
    RAISE NOTICE 'embedding_1536 column: %', CASE WHEN has_embedding THEN '✅ EXISTS' ELSE '❌ MISSING' END;
    RAISE NOTICE 'agent_id column: %', CASE WHEN has_agent_id THEN '✅ EXISTS' ELSE '❌ MISSING' END;
    RAISE NOTICE 'namespace column: %', CASE WHEN has_namespace THEN '✅ EXISTS' ELSE '❌ MISSING' END;
    RAISE NOTICE 'tsv (full-text) column: %', CASE WHEN has_tsv THEN '✅ EXISTS' ELSE '❌ MISSING' END;
    RAISE NOTICE 'Total indexed documents: %', row_count;
END $$;

-- 2) Ensure all agents have rag_search in their tool_allowlist
-- Update existing agents to include rag_search if not present
UPDATE public.gasable_agents
SET 
    tool_allowlist = ARRAY(
        SELECT DISTINCT unnest(
            tool_allowlist || 
            CASE WHEN NOT ('rag_search_tool' = ANY(tool_allowlist)) 
                 THEN ARRAY['rag_search_tool']
                 ELSE ARRAY[]::text[]
            END
        )
    ),
    updated_at = NOW()
WHERE NOT ('rag_search_tool' = ANY(tool_allowlist));

-- 3) Show current agent configurations
DO $$
DECLARE
    agent_rec RECORD;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '=== Agent Tool Configurations ===';
    FOR agent_rec IN 
        SELECT id, display_name, tool_allowlist, top_k, 
               CASE WHEN assistant_id IS NOT NULL AND assistant_id != '' 
                    THEN '✅ Provisioned' 
                    ELSE '❌ Missing' 
               END as assistant_status
        FROM public.gasable_agents
        ORDER BY id
    LOOP
        RAISE NOTICE 'Agent: % (%)', agent_rec.display_name, agent_rec.id;
        RAISE NOTICE '  Tools: %', agent_rec.tool_allowlist;
        RAISE NOTICE '  Top K: % | OpenAI Assistant: %', agent_rec.top_k, agent_rec.assistant_status;
        RAISE NOTICE '  RAG Enabled: %', 
            CASE WHEN 'rag_search_tool' = ANY(agent_rec.tool_allowlist) OR 'rag.search' = ANY(agent_rec.tool_allowlist)
                 THEN '✅ YES' 
                 ELSE '❌ NO' 
            END;
        RAISE NOTICE '';
    END LOOP;
END $$;

-- 4) Show index statistics per agent/namespace
DO $$
DECLARE
    stat_rec RECORD;
    total_count integer;
BEGIN
    RAISE NOTICE '=== Memory Index Statistics ===';
    
    SELECT COUNT(*) FROM public.gasable_index INTO total_count;
    RAISE NOTICE 'Total documents: %', total_count;
    RAISE NOTICE '';
    
    FOR stat_rec IN
        SELECT 
            agent_id,
            namespace,
            COUNT(*) as doc_count,
            COUNT(CASE WHEN embedding_1536 IS NOT NULL THEN 1 END) as with_embedding,
            COUNT(CASE WHEN tsv IS NOT NULL THEN 1 END) as with_tsv
        FROM public.gasable_index
        GROUP BY agent_id, namespace
        ORDER BY agent_id, namespace
    LOOP
        RAISE NOTICE 'Agent: % | Namespace: %', stat_rec.agent_id, stat_rec.namespace;
        RAISE NOTICE '  Documents: % | With Embeddings: % | With Full-Text: %', 
            stat_rec.doc_count, stat_rec.with_embedding, stat_rec.with_tsv;
    END LOOP;
END $$;

-- 5) Verify indexes exist for performance
DO $$
DECLARE
    has_hnsw boolean;
    has_tsv_gin boolean;
    has_agent_ns boolean;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '=== Performance Indexes ===';
    
    SELECT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE tablename = 'gasable_index' 
        AND indexname LIKE '%1536%hnsw%'
    ) INTO has_hnsw;
    
    SELECT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE tablename = 'gasable_index' 
        AND indexname LIKE '%tsv%'
    ) INTO has_tsv_gin;
    
    SELECT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE tablename = 'gasable_index' 
        AND indexname LIKE '%agent%ns%'
    ) INTO has_agent_ns;
    
    RAISE NOTICE 'HNSW Vector Index (embedding_1536): %', CASE WHEN has_hnsw THEN '✅ EXISTS' ELSE '⚠️  MISSING (slow queries)' END;
    RAISE NOTICE 'GIN Full-Text Index (tsv): %', CASE WHEN has_tsv_gin THEN '✅ EXISTS' ELSE '⚠️  MISSING (slow queries)' END;
    RAISE NOTICE 'Agent/Namespace Index: %', CASE WHEN has_agent_ns THEN '✅ EXISTS' ELSE '⚠️  MISSING (slow filters)' END;
END $$;

