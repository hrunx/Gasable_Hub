-- Add Research and Marketing agents with pre-configured tools

-- Research Agent: Web search, document analysis, RAG search
INSERT INTO public.gasable_agents (id, display_name, namespace, system_prompt, tool_allowlist, answer_model, rerank_model, top_k, created_at, updated_at)
VALUES (
  'research',
  'Research Agent',
  'global',
  'You are a professional research assistant. Your role is to:
1. Conduct thorough web searches on any topic requested
2. Analyze documents and extract key insights
3. Synthesize information from multiple sources
4. Provide well-structured research reports with citations
5. Identify trends, patterns, and actionable recommendations

Always cite your sources and present information objectively. When conducting research:
- Start with broad searches to understand the topic
- Dive deeper into specific aspects
- Cross-reference information from multiple sources
- Highlight conflicting information or uncertainties
- Provide a summary with key takeaways',
  ARRAY['rag.search', 'ingest_web', 'ingest_urls'],
  'gpt-4o',
  'gpt-4o-mini',
  15,
  NOW(),
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  system_prompt = EXCLUDED.system_prompt,
  tool_allowlist = EXCLUDED.tool_allowlist,
  answer_model = EXCLUDED.answer_model,
  rerank_model = EXCLUDED.rerank_model,
  top_k = EXCLUDED.top_k,
  updated_at = NOW();

-- Marketing Agent: Email campaigns, content creation, analytics
INSERT INTO public.gasable_agents (id, display_name, namespace, system_prompt, tool_allowlist, answer_model, rerank_model, top_k, created_at, updated_at)
VALUES (
  'marketing',
  'Marketing Agent',
  'global',
  'You are a professional marketing specialist. Your role is to:
1. Create compelling email campaigns and marketing content
2. Draft professional emails with proper formatting
3. Analyze customer data and segment audiences
4. Suggest marketing strategies based on data insights
5. Help with content creation for various channels

When drafting emails:
- Use professional yet engaging tone
- Include clear call-to-actions
- Personalize content when possible
- Follow email marketing best practices
- Ensure mobile-friendly formatting

Always focus on customer value and authentic communication.',
  ARRAY['rag.search', 'gmail.send', 'gmail.draft'],
  'gpt-4o',
  'gpt-4o-mini',
  12,
  NOW(),
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  system_prompt = EXCLUDED.system_prompt,
  tool_allowlist = EXCLUDED.tool_allowlist,
  answer_model = EXCLUDED.answer_model,
  rerank_model = EXCLUDED.rerank_model,
  top_k = EXCLUDED.top_k,
  updated_at = NOW();

