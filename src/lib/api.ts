// Use relative URL in production, localhost in development
const API_BASE = typeof window !== 'undefined' && window.location.hostname !== 'localhost' 
  ? '' // Empty string uses same origin in production
  : "http://localhost:8000";

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
}

export const api = {
  // Agents
  async getAgents() {
    const res = await fetch(`${API_BASE}/api/agents`);
    if (!res.ok) throw new Error("Failed to fetch agents");
    return res.json();
  },

  async saveAgent(agent: Agent) {
    const res = await fetch(`${API_BASE}/api/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(agent),
    });
    if (!res.ok) throw new Error("Failed to save agent");
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
  async getWorkflows() {
    const namespace = "global";
    const res = await fetch(`${API_BASE}/api/workflows?namespace=${namespace}`);
    if (!res.ok) throw new Error("Failed to fetch workflows");
    return res.json();
  },

  async getWorkflow(id: string) {
    const res = await fetch(`${API_BASE}/api/workflows/${id}`);
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

  // Status
  async getStatus() {
    const res = await fetch(`${API_BASE}/api/status`);
    if (!res.ok) throw new Error("Failed to fetch status");
    return res.json();
  },

  // Connections
  async getConnections() {
    const res = await fetch(`${API_BASE}/api/connections`);
    if (!res.ok) throw new Error("Failed to fetch connections");
    return res.json();
  },
};

