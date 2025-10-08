// Prefer direct backend; allow override with NEXT_PUBLIC_API_BASE
export const API_BASE = (() => {
  const env = (process?.env?.NEXT_PUBLIC_API_BASE || '').trim();
  if (env) return env.replace(/\/$/, '');
  if (typeof window === 'undefined') return 'http://localhost:8000';
  // In dev, regardless of hostname (localhost, 127.0.0.1, or LAN IP), use local backend
  if (window.location.port === '3000') return 'http://localhost:8000';
  return '';
})();

interface RagSettings {
  rerank?: boolean;
  expansions?: number;
  k_dense_fuse?: number;
  mmr_lambda?: number;
}

interface Agent {
  id: string;
  display_name: string;
  namespace: string;
  system_prompt: string;
  tool_allowlist: string[];
  answer_model?: string;
  rerank_model?: string;
  top_k?: number;
  assistant_id?: string;
  api_key?: string;
  rag_settings?: RagSettings;
}

interface Workflow {
  id?: string;
  display_name: string;
  namespace: string;
  graph: Record<string, unknown>;
  description?: string;
}

export const api = {
  // Agents
  async getAgents() {
    const res = await fetch(`${API_BASE}/api/agents`);
    if (!res.ok) throw new Error("Failed to fetch agents");
    return res.json();
  },

  async getOrchestrator() {
    const res = await fetch(`${API_BASE}/api/orchestrator`);
    if (!res.ok) throw new Error("Failed to fetch orchestrator config");
    return res.json();
  },

  async setOrchestrator(cfg: { system_prompt: string; rules?: Record<string, unknown> }) {
    const res = await fetch(`${API_BASE}/api/orchestrator`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg),
    });
    if (!res.ok) throw new Error("Failed to save orchestrator config");
    return res.json();
  },

  async saveAgent(agent: Agent) {
    const res = await fetch(`${API_BASE}/api/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(agent),
    });
    if (!res.ok) {
      const txt = await res.text();
      try {
        const data = JSON.parse(txt);
        throw new Error(data?.error || `Failed to save agent (${res.status})`);
      } catch {
        throw new Error(txt || `Failed to save agent (${res.status})`);
      }
    }
    return res.json();
  },

  async rotateAgentKey(agentId: string) {
    const res = await fetch(`${API_BASE}/api/agents/${encodeURIComponent(agentId)}/rotate_key`, { method: "POST" });
    if (!res.ok) throw new Error("Failed to rotate agent key");
    return res.json();
  },

  async rewritePrompt(text: string) {
    const res = await fetch(`${API_BASE}/api/prompt_rewrite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error("Failed to rewrite prompt");
    return res.json();
  },

  async syncAssistants() {
    const res = await fetch(`${API_BASE}/api/assistants/sync`, {
      method: "POST",
    });
    if (!res.ok) throw new Error("Failed to sync assistants");
    return res.json();
  },

  // Workflows
  async getWorkflows(params?: { limit?: number; offset?: number }) {
    const namespace = "global";
    const limit = params?.limit ?? 500; // Reasonable default for performance
    const offset = params?.offset ?? 0;
    const res = await fetch(`${API_BASE}/api/workflows?namespace=${namespace}&limit=${limit}&offset=${offset}`);
    if (!res.ok) throw new Error("Failed to fetch workflows");
    return res.json();
  },

  async getWorkflow(id: string) {
    const res = await fetch(`${API_BASE}/api/workflows/${id}`);
    if (!res.ok) throw new Error("Failed to fetch workflow");
    return res.json();
  },

  async getWorkflowEnriched(id: string) {
    const res = await fetch(`${API_BASE}/api/workflows/${id}?enrich=true`);
    if (!res.ok) throw new Error("Failed to fetch workflow");
    return res.json();
  },

  async saveWorkflow(workflow: Workflow) {
    const res = await fetch(`${API_BASE}/api/workflows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(workflow),
    });
    if (!res.ok) throw new Error("Failed to save workflow");
    return res.json();
  },

  // Tools
  async getTools() {
    const res = await fetch(`${API_BASE}/api/mcp_tools`);
    if (!res.ok) throw new Error("Failed to fetch tools");
    return res.json();
  },

  async getToolsDb() {
    const res = await fetch(`${API_BASE}/api/mcp_tools_db`);
    if (!res.ok) throw new Error("Failed to fetch tools DB");
    return res.json();
  },

  async getToolDb(name: string) {
    const res = await fetch(`${API_BASE}/api/mcp_tools_db/${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error("Failed to fetch tool");
    return res.json();
  },

  async updateTool(tool: { name: string; description?: string; module: string; code: string; required_keys?: string[] }) {
    const res = await fetch(`${API_BASE}/api/mcp_tools_db/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tool),
    });
    if (!res.ok) throw new Error("Failed to update tool");
    return res.json();
  },

  async deleteTool(name: string) {
    const res = await fetch(`${API_BASE}/api/mcp_tools_db/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error("Failed to delete tool");
    return res.json();
  },

  async draftTool(description: string) {
    const res = await fetch(`${API_BASE}/api/mcp_tools/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description }),
    });
    if (!res.ok) throw new Error("Failed to draft tool");
    return res.json();
  },

  async createTool(tool: { name: string; description?: string; module?: string; code: string }) {
    const res = await fetch(`${API_BASE}/api/mcp_tools`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tool),
    });
    if (!res.ok) throw new Error("Failed to create tool");
    return res.json();
  },

  // Status
  async getStatus() {
    const res = await fetch(`${API_BASE}/api/status`);
    if (!res.ok) throw new Error("Failed to fetch status");
    return res.json();
  },

  async getRecentErrors(limit = 100) {
    const res = await fetch(`${API_BASE}/api/recent_errors?limit=${limit}`);
    if (!res.ok) throw new Error("Failed to fetch recent errors");
    return res.json();
  },

  // Connections
  async getConnections() {
    const res = await fetch(`${API_BASE}/api/connections`);
    if (!res.ok) throw new Error("Failed to fetch connections");
    return res.json();
  },

  // Keys
  async getKeys() {
    const res = await fetch(`${API_BASE}/api/keys`);
    if (!res.ok) throw new Error("Failed to fetch keys");
    return res.json();
  },

  async rotateMcpToken() {
    const res = await fetch(`${API_BASE}/api/keys/mcp_token/rotate`, { method: "POST" });
    if (!res.ok) throw new Error("Failed to rotate MCP token");
    return res.json();
  },

  async rotateToolKey(toolName: string) {
    const res = await fetch(`${API_BASE}/api/tools/${encodeURIComponent(toolName)}/rotate_key`, { method: "POST" });
    if (!res.ok) throw new Error("Failed to rotate tool key");
    return res.json();
  },

  // Orchestrator
  async orchestrate(body: { user_id: string; message: string; namespace?: string; agent_preference?: string | null }) {
    const res = await fetch(`${API_BASE}/api/orchestrate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("Failed to orchestrate");
    return res.json();
  },

  orchestrateStream(params: { message: string; namespace?: string; agent_preference?: string | null }, onEvent: (evt: { event: string; data: any }) => void) {
    const qs = new URLSearchParams();
    qs.set("message", params.message);
    if (params.namespace) qs.set("namespace", params.namespace);
    if (params.agent_preference) qs.set("agent_preference", params.agent_preference);
    const url = `${API_BASE}/api/orchestrate_stream?${qs.toString()}`;
    const es = new EventSource(url);
    es.onopen = () => {
      try { onEvent({ event: "open", data: null }); } catch {}
    };
    es.addEventListener("step", (e: MessageEvent) => {
      try { onEvent({ event: "step", data: JSON.parse(e.data) }); } catch { onEvent({ event: "step", data: e.data }); }
    });
    es.addEventListener("final", (e: MessageEvent) => {
      try { onEvent({ event: "final", data: JSON.parse(e.data) }); } catch { onEvent({ event: "final", data: e.data }); }
      es.close();
    });
    es.onerror = () => {
      onEvent({ event: "error", data: { error: "stream_error" } });
      es.close();
    };
    return () => es.close();
  },

  // Nodes API
  async listNodes(category?: string) {
    const url = new URL(`${API_BASE}/api/nodes`, typeof window === 'undefined' ? undefined : window.location.origin);
    if (category) url.searchParams.set("category", category);
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error("Failed to fetch nodes");
    return res.json();
  },

  async installNodes(specs: any[]) {
    const res = await fetch(`${API_BASE}/api/nodes/install`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ specs }),
    });
    if (!res.ok) throw new Error("Failed to install nodes");
    return res.json();
  },

  async runNode(body: { name: string; version?: string; params?: Record<string, unknown>; inputs?: Record<string, unknown>; credential_id?: string | null; }) {
    const res = await fetch(`${API_BASE}/api/nodes/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("Failed to run node");
    return res.json();
  },

  // Templates API
  async listTemplates(params?: { category?: string; q?: string; limit?: number; offset?: number }) {
    const url = new URL(`${API_BASE}/api/templates`, typeof window === 'undefined' ? undefined : window.location.origin);
    if (params?.category) url.searchParams.set("category", params.category);
    if (params?.q) url.searchParams.set("q", params.q);
    if (params?.limit) url.searchParams.set("limit", String(params.limit));
    if (params?.offset) url.searchParams.set("offset", String(params.offset));
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error("Failed to fetch templates");
    return res.json();
  },

  async getTemplate(slug: string) {
    const res = await fetch(`${API_BASE}/api/templates/${encodeURIComponent(slug)}`);
    if (!res.ok) throw new Error("Failed to fetch template");
    return res.json();
  },

  async installTemplate(tpl: { slug: string; name: string; description?: string; category?: string; graph: any; source?: string }) {
    const res = await fetch(`${API_BASE}/api/templates/install`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tpl),
    });
    if (!res.ok) throw new Error("Failed to install template");
    return res.json();
  },
};
