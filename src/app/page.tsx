"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bot, Wrench, Workflow, Plus, Activity, Sparkles, Boxes } from "lucide-react";
import { api } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import Link from "next/link";
import { ChatInterface } from "@/components/chat/ChatInterface";
import { AgentModal } from "@/components/agents/AgentModal";
import ToolModal from "@/components/agents/ToolModal";
import { useMemo, useState as useStateReact, useEffect as useEffectReact } from "react";

export default function Home() {
  const router = useRouter();
  type ErrorItem = { status?: number; method?: string; path?: string; error?: string; ts?: number };
  const [agentModalOpen, setAgentModalOpen] = useState(false);
  const [selectedAgentForModal, setSelectedAgentForModal] = useState<{
    id: string;
    display_name: string;
    namespace: string;
    system_prompt: string;
    tool_allowlist: string[];
  } | null>(null);
  const [selectedChatAgent, setSelectedChatAgent] = useState<string | null>(null);
  const [toolModalOpen, setToolModalOpen] = useState(false);
  const [selectedTool, setSelectedTool] = useState<{ name: string; description?: string; module?: string } | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [recentErrors, setRecentErrors] = useState<ErrorItem[]>([]);

  const { data: agentsData } = useQuery({
    queryKey: ["agents"],
    queryFn: api.getAgents,
  });

  const { data: toolsData } = useQuery({
    queryKey: ["tools"],
    queryFn: api.getTools,
  });

  const { data: workflowsData } = useQuery({
    queryKey: ["workflows"],
    queryFn: () => api.getWorkflows(),
  });

  const { data: nodesData } = useQuery({
    queryKey: ["nodes"],
    queryFn: () => api.listNodes(),
  });

  const { data: statusData } = useQuery({
    queryKey: ["status"],
    queryFn: api.getStatus,
    refetchInterval: 5000,
  });

  // Orchestrator settings
  const { data: orchestratorData, refetch: refetchOrch } = useQuery({
    queryKey: ["orchestrator"],
    queryFn: api.getOrchestrator,
  });

  const { data: connectionsData } = useQuery({
    queryKey: ["connections"],
    queryFn: api.getConnections,
    refetchInterval: 10000,
  });

  const agents = agentsData?.agents || [];
  const tools = toolsData?.tools || [];
  const workflows = workflowsData?.workflows || [];
  const nodes = nodesData || [];
  const connections = connectionsData?.connections || [];
  const isHealthy = statusData?.db?.status === "ok";

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Gasable Hub</h1>
            <p className="text-sm text-gray-500">Mission Control</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={async () => {
                try {
                  const data = await api.getRecentErrors(100);
                  const items = (data.items as ErrorItem[] | undefined) || [];
                  setRecentErrors(items);
                  setLogsOpen(true);
                } catch {
                  setRecentErrors([]);
                  setLogsOpen(true);
                }
              }}
              className={
                `inline-flex items-center rounded px-2 py-1 text-xs border ` +
                (isHealthy ? 'bg-green-500 hover:bg-green-600 text-white border-transparent' : 'border-red-300 text-red-700')
              }
              title="Click to view recent server errors"
            >
              <Activity className="mr-1 h-3 w-3" />
              {isHealthy ? "✓ Online" : "⚠ Degraded"}
            </button>
            <Badge variant="outline" className="text-xs font-normal">
              {agents.length} Agents
            </Badge>
            <Badge variant="outline" className="text-xs font-normal">
              {tools.length} Tools
            </Badge>
            <Badge variant="outline" className="text-xs font-normal">
              {connections.length} Connections
            </Badge>
            <Link href="/workflows/new">
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                New Workflow
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Agents</CardTitle>
              <Bot className="h-4 w-4 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{agents.length}</div>
              <p className="text-xs text-gray-500">Active AI agents</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Tools</CardTitle>
              <Wrench className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{tools.length}</div>
              <p className="text-xs text-gray-500">MCP tools available</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Workflows</CardTitle>
              <Workflow className="h-4 w-4 text-purple-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{workflows.length}</div>
              <p className="text-xs text-gray-500">Configured workflows</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Nodes</CardTitle>
              <Boxes className="h-4 w-4 text-orange-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{nodes.length}</div>
              <p className="text-xs text-gray-500">Runtime nodes available</p>
            </CardContent>
          </Card>
        </div>

        {/* Main Tabs */}
        <Tabs defaultValue="chat" className="space-y-4">
          <TabsList>
            <TabsTrigger value="chat">AI Chat</TabsTrigger>
            <TabsTrigger value="agents">Agents</TabsTrigger>
            <TabsTrigger value="tools">Tools</TabsTrigger>
            <TabsTrigger value="nodes">Nodes</TabsTrigger>
            <TabsTrigger value="workflows">Workflows</TabsTrigger>
            <TabsTrigger value="orchestrator">Orchestrator</TabsTrigger>
            <TabsTrigger value="api">API</TabsTrigger>
          </TabsList>

          <TabsContent value="chat" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <ChatInterface 
                  agents={agents}
                  selectedAgent={selectedChatAgent}
                />
              </div>
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Select Agent</CardTitle>
                    <p className="text-xs text-gray-500 mt-1">
                      Choose how you want to chat
                    </p>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {/* Multi-Agent Orchestrator Option */}
                      <button
                        onClick={() => setSelectedChatAgent(null)}
                        className={`w-full flex items-center gap-2 text-sm p-3 rounded transition-colors ${
                          selectedChatAgent === null
                            ? "bg-purple-100 border-2 border-purple-500 text-purple-900"
                            : "bg-gray-50 hover:bg-purple-50 border border-transparent hover:border-purple-200"
                        }`}
                      >
                        <Sparkles className="h-4 w-4 text-purple-600" />
                        <div className="text-left flex-1">
                          <div className="font-semibold">Multi-Agent (Orchestrator)</div>
                          <div className="text-xs opacity-70">AI routes to best agent</div>
                        </div>
                        {selectedChatAgent === null && (
                          <Badge variant="default" className="text-xs">Active</Badge>
                        )}
                      </button>

                      {/* Individual Agents */}
                      <div className="pt-2 border-t">
                        <div className="text-xs font-semibold text-gray-500 mb-2">Direct Agent Chat</div>
                        {agents.map((agent: { id: string; display_name: string; namespace: string; tool_allowlist: string[] }) => (
                          <button
                            key={agent.id}
                            onClick={() => setSelectedChatAgent(agent.id)}
                            className={`w-full flex items-center gap-2 text-sm p-2 mb-1 rounded transition-colors ${
                              selectedChatAgent === agent.id
                                ? "bg-blue-100 border-2 border-blue-500 text-blue-900"
                                : "bg-gray-50 hover:bg-blue-50 border border-transparent hover:border-blue-200"
                            }`}
                          >
                            <Bot className="h-4 w-4 text-blue-600" />
                            <span className="font-medium flex-1 text-left">{agent.display_name}</span>
                            {selectedChatAgent === agent.id && (
                              <Badge variant="outline" className="text-xs">Active</Badge>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Quick Actions</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Button 
                      variant="outline" 
                      className="w-full justify-start"
              onClick={() => {
                setSelectedAgentForModal(null);
                setAgentModalOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Create Agent
            </Button>
                    <Link href="/workflows/new" className="block">
                      <Button variant="outline" className="w-full justify-start">
                        <Workflow className="mr-2 h-4 w-4" />
                        New Workflow
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="agents" className="space-y-4">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">AI Agents</h2>
              <Button 
                size="sm"
                onClick={() => {
                  setSelectedAgentForModal(null);
                  setAgentModalOpen(true);
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                New Agent
              </Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {agents.map((agent: { id: string; display_name: string; namespace: string; tool_allowlist: string[]; system_prompt?: string }) => (
                <Card 
                  key={agent.id}
                  className="cursor-pointer hover:shadow-lg transition-shadow"
                  onClick={() => {
                    setSelectedAgentForModal({
                      ...agent,
                      system_prompt: agent.system_prompt || ""
                    });
                    setAgentModalOpen(true);
                  }}
                >
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Bot className="h-5 w-5 text-blue-600" />
                      {agent.display_name}
                    </CardTitle>
                    <CardDescription>ID: {agent.id}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div>
                        <span className="text-sm font-medium">Namespace:</span>
                        <Badge variant="outline" className="ml-2">{agent.namespace}</Badge>
                      </div>
                      <div>
                        <span className="text-sm font-medium">System Prompt:</span>
                        <div className="text-xs text-gray-600 mt-1 line-clamp-3 break-words">
                          {(agent.system_prompt && String(agent.system_prompt).trim()) || "(not set)"}
                        </div>
                      </div>
                      <div>
                        <span className="text-sm font-medium">Tools:</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {(agent.tool_allowlist || []).map((tool: string) => (
                            <Badge key={tool} variant="secondary" className="text-xs">
                              {tool}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="tools" className="space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xl font-semibold">MCP Tools</h2>
              <div className="flex items-center gap-2">
                <input
                  className="hidden md:block w-64 border rounded p-2 text-sm"
                  placeholder="Search tools..."
                  onChange={(e) => {
                    // simple client-side filter; rely on ToolsManager to receive all
                    const q = e.target.value.toLowerCase();
                    const el = document.getElementById("tools-manager-list");
                    if (!el) return;
                    Array.from(el.querySelectorAll('[data-tool-item="1"]')).forEach((n) => {
                      const t = (n as HTMLElement).getAttribute("data-name") || "";
                      (n as HTMLElement).style.display = t.includes(q) ? "" : "none";
                    });
                  }}
                />
                <Button size="sm" onClick={() => { setSelectedTool(null); setToolModalOpen(true); }}>
                <Plus className="mr-2 h-4 w-4" /> New Tool
                </Button>
              </div>
            </div>
            <ToolsManager />
          </TabsContent>

          <TabsContent value="nodes" className="space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xl font-semibold">Nodes</h2>
              <input
                className="w-64 border rounded p-2 text-sm"
                placeholder="Search nodes..."
                onChange={(e) => {
                  const q = e.target.value.toLowerCase();
                  const el = document.getElementById("nodes-list");
                  if (!el) return;
                  Array.from(el.querySelectorAll('[data-node-item="1"]')).forEach((n) => {
                    const title = (n as HTMLElement).getAttribute("data-title") || "";
                    const name = (n as HTMLElement).getAttribute("data-name") || "";
                    (n as HTMLElement).style.display = (title + " " + name).includes(q) ? "" : "none";
                  });
                }}
              />
            </div>
            <div id="nodes-list" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {nodes.length === 0 ? (
                <Card className="col-span-2">
                  <CardContent className="py-12 text-center">
                    <Boxes className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                    <h3 className="text-lg font-medium mb-2">No nodes found</h3>
                    <p className="text-gray-500">Install nodes to get started</p>
                  </CardContent>
                </Card>
              ) : (
                nodes.map((n: { name: string; version?: string; title?: string; category?: string; doc?: string; required_keys?: string[] }) => (
                  <Card key={`${n.name}@${n.version || 'latest'}`} data-node-item="1" data-name={(n.name || '').toLowerCase()} data-title={(n.title || '').toLowerCase()} className="hover:shadow">
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Boxes className="h-4 w-4 text-orange-600" />
                        {n.title || n.name}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm space-y-2">
                      <div className="text-gray-700"><span className="font-medium">Name:</span> {n.name}</div>
                      <div className="text-gray-700"><span className="font-medium">Version:</span> {n.version || 'latest'}</div>
                      <div className="text-gray-500 text-xs">Category: {n.category || 'general'}</div>
                      <div className="text-xs text-gray-600 border-t pt-2">
                        {n.doc && n.doc.trim() ? n.doc : <span className="text-gray-400 italic">No description</span>}
                      </div>
                      <div className="text-[11px] text-gray-500">
                        <span className="font-medium">Required keys:</span>{' '}
                        {(n.required_keys && n.required_keys.length > 0) ? n.required_keys.join(', ') : '(none)'}
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </TabsContent>

          <TabsContent value="workflows" className="space-y-4">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">Workflows</h2>
              <div className="flex items-center gap-2">
                <input
                  className="hidden md:block w-64 border rounded p-2 text-sm"
                  placeholder="Search workflows..."
                  onChange={(e) => {
                    const q = e.target.value.toLowerCase();
                    const el = document.getElementById("workflows-list");
                    if (!el) return;
                    Array.from(el.querySelectorAll('[data-workflow-item="1"]')).forEach((n) => {
                      const ttl = (n as HTMLElement).getAttribute("data-title") || "";
                      (n as HTMLElement).style.display = ttl.includes(q) ? "" : "none";
                    });
                  }}
                />
              <Link href="/workflows/new">
                <Button size="sm">
                  <Plus className="mr-2 h-4 w-4" />
                  Create Workflow
                </Button>
              </Link>
              </div>
            </div>
            <div id="workflows-list" className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {workflows.length === 0 ? (
                <Card className="col-span-2">
                  <CardContent className="py-12 text-center">
                    <Workflow className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                    <h3 className="text-lg font-medium mb-2">No workflows yet</h3>
                    <p className="text-gray-500 mb-4">Create your first workflow to get started</p>
                    <Link href="/workflows/new">
                      <Button>
                        <Plus className="mr-2 h-4 w-4" />
                        Create Workflow
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              ) : (
                workflows.map((workflow: { id: string; display_name: string; namespace: string; graph?: any; description?: string; tools?: string[]; tool_details?: Record<string, { description?: string; required_keys?: string[] }> }) => {
                  // derive description and required tools from graph if available
                  const descr = (workflow.description || "").trim();
                  const toolsList = (workflow.tools || []).slice(0, 6);
                  return (
                    <Card key={workflow.id} data-workflow-item="1" data-title={(workflow.display_name || '').toLowerCase()} className="cursor-pointer hover:shadow-lg transition-shadow"
                      onClick={() => router.push(`/workflows/${workflow.id}`)}>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <Workflow className="h-5 w-5 text-purple-600" />
                          {workflow.display_name}
                        </CardTitle>
                        <CardDescription>{workflow.namespace}</CardDescription>
                      </CardHeader>
                      <CardContent className="text-xs text-gray-600 space-y-2">
                        {descr ? (
                          <div className="line-clamp-2">{descr}</div>
                        ) : (
                          <div className="text-gray-400 italic">No description</div>
                        )}
                        {toolsList.length > 0 && (
                          <div className="space-y-1">
                            <div>
                              <span className="font-medium">Uses tools:</span>{' '}
                              {toolsList.map((t, i) => (<span key={t}>{i>0?', ':''}<span className="font-mono">{t}</span></span>))}
                            </div>
                            <div className="text-[11px] text-gray-500">
                              {toolsList.map((t) => {
                                const det = (workflow.tool_details || {})[t] || {};
                                const rk = (det.required_keys || []).join(', ');
                                return (
                                  <div key={t} className="truncate">
                                    {det.description ? (<span>{det.description} </span>) : null}
                                    {rk && (<span className="italic">(keys: {rk})</span>)}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </div>
          </TabsContent>

          <TabsContent value="orchestrator" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Orchestrator Settings</CardTitle>
                <p className="text-xs text-gray-500">Control routing rules and the orchestrator system prompt used for agent selection.</p>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* System Prompt */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">System Prompt</label>
                  <OrchestratorPromptEditor orchestratorData={orchestratorData} onSaved={refetchOrch} />
                  <p className="text-xs text-gray-500">The instruction the orchestrator uses to decide which agent should handle a task.</p>
                </div>

                {/* Visual Keywords Editor */}
                <VisualKeywordsEditor
                  agents={agents.map((a: { id: string }) => a.id)}
                  currentRules={(orchestratorData?.rules as any) || {}}
                  onSave={async (rules) => {
                    await api.setOrchestrator({ system_prompt: (orchestratorData?.system_prompt as string) || "", rules });
                    refetchOrch();
                  }}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="api" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">API & Endpoints</CardTitle>
                <p className="text-xs text-gray-500">Reference for agents, tools, orchestrator, and MCP endpoints with live keys where applicable.</p>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <LiveKeys />
                <div>
                  <div className="font-semibold mb-1">Agents</div>
                  <pre className="bg-gray-50 p-3 rounded border overflow-x-auto">{`
GET  /api/agents
  - List agents with fields: id, display_name, namespace, system_prompt, tool_allowlist, answer_model, rerank_model, top_k, assistant_id, api_key, rag_settings

POST /api/agents
  - Create/update agent
  - Body (JSON): {
      id, display_name, namespace, system_prompt, tool_allowlist[],
      answer_model, rerank_model, top_k, rag_settings { rerank, expansions, k_dense_fuse, mmr_lambda }
    }
  - Upsert semantics (on conflict by id)

POST /api/agents/{agent_id}/rotate_key
  - Generates a new API key for the agent; returns { status, api_key }

POST /api/agents/{agent_id}/chat
  - Headers: X-API-Key: <agent_api_key>
  - Body: { message: string, namespace?: string }
  - Returns: { message, status }
`}</pre>
                </div>
                <div>
                  <div className="font-semibold mb-1">Orchestrator</div>
                  <pre className="bg-gray-50 p-3 rounded border overflow-x-auto">{`
GET  /api/orchestrator
  - Returns { system_prompt, rules }

POST /api/orchestrator
  - Body: { system_prompt: string, rules?: { keywords: { [agentId]: string[] } } }
  - Upserts config

POST /api/orchestrate
  - Body: { user_id: string, message: string, namespace?: string, agent_preference?: string|null }
  - Returns: { agent, message, status, ... }

GET  /api/orchestrate_stream?message=...&namespace=...&agent_preference=...
  - Server-Sent Events: step/final events for streaming orchestration
`}</pre>
                </div>
                <div>
                  <div className="font-semibold mb-1">Tools (MCP)</div>
                  <pre className="bg-gray-50 p-3 rounded border overflow-x-auto">{`
GET  /api/mcp_tools
  - Discovers available tools from runtime

POST /api/mcp_tools
  - Body: { name, description?, module, code, required_keys?[] }

POST /api/mcp_invoke
  - Headers: Authorization: Bearer <MCP_TOKEN>
  - Body: { name: string, args?: object }

GET  /api/mcp_tools_db
GET  /api/mcp_tools_db/{name}
POST /api/mcp_tools_db/update
POST /api/mcp_tools_db/delete
POST /api/tools/{tool_name}/rotate_key
`}</pre>
                </div>
                <div>
                  <div className="font-semibold mb-1">Workflows</div>
                  <pre className="bg-gray-50 p-3 rounded border overflow-x-auto">{`
GET  /api/workflows?namespace=global
GET  /api/workflows/{id}
POST /api/workflows
POST /api/workflows/{id}/run
`}</pre>
                </div>
                <div>
                  <div className="font-semibold mb-1">Schemas</div>
                  <pre className="bg-gray-50 p-3 rounded border overflow-x-auto">
Table public.gasable_agents
  id text primary key
  display_name text
  namespace text
  system_prompt text
  tool_allowlist text[]
  answer_model text
  rerank_model text
  top_k int
  assistant_id text
  api_key text
  rag_settings jsonb
                  </pre>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Agent Modal */}
        <AgentModal
          open={agentModalOpen}
          onOpenChange={setAgentModalOpen}
          agent={selectedAgentForModal}
        />
        <ToolModal
          open={toolModalOpen}
          onOpenChange={setToolModalOpen}
          tool={selectedTool}
        />
        <Dialog open={logsOpen} onOpenChange={setLogsOpen}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Recent Server Errors</DialogTitle>
            </DialogHeader>
            <div className="max-h-96 overflow-auto text-sm">
              {recentErrors.length === 0 ? (
                <p className="text-gray-500">No recent server errors.</p>
              ) : (
                <ul className="space-y-2">
                  {recentErrors.slice(0, 100).map((it, idx) => (
                    <li key={idx} className="border rounded p-2 bg-white">
                      <div className="flex flex-wrap gap-2">
                        <span className="font-mono text-xs">{it.status ?? 500}</span>
                        <span className="font-mono text-xs">{it.method ?? ''}</span>
                        <span className="font-mono text-xs break-all">{it.path ?? ''}</span>
                      </div>
                      {it.error && (
                        <div className="mt-1 text-red-700 break-words">{it.error}</div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex justify-end">
              <Button variant="outline" onClick={async () => {
                try {
                  const data = await api.getRecentErrors(100);
                  const items = (data.items as ErrorItem[] | undefined) || [];
                  setRecentErrors(items);
                } catch {}
              }}>Refresh</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

function LiveKeys() {
  const { data, refetch } = useQuery({ queryKey: ["keys"], queryFn: api.getKeys, refetchInterval: 5000 });
  const agents: Array<{ id: string; api_key?: string | null }> = (data?.agents as any) || [];
  const mcp = (data?.mcp_token as string | undefined) || undefined;
  const toolsKeys: Array<{ name: string; api_key?: string | null }> = (data?.tools as any) || [];
  return (
    <div className="border rounded p-3 bg-white">
      <div className="flex items-center justify-between">
        <div className="font-semibold">Live API Keys</div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => refetch()}>Refresh</Button>
          <Button size="sm" onClick={async () => { try { await api.rotateMcpToken(); await refetch(); } catch {} }}>Rotate MCP Token</Button>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <div className="space-y-2">
          <div className="text-xs font-medium text-gray-500">Agents</div>
          {agents.length === 0 ? (
            <div className="text-xs text-gray-500">No agents yet</div>
          ) : (
            agents.map(a => (
              <div key={a.id} className="border rounded p-2">
                <div className="font-mono text-xs">{a.id}</div>
                <div className="mt-1 break-all text-xs bg-gray-50 p-2 rounded border">
                  {a.api_key || "(not set)"}
                </div>
              </div>
            ))
          )}
        </div>
        <div className="space-y-2">
          <div className="text-xs font-medium text-gray-500">Platform</div>
          <div className="border rounded p-2">
            <div className="text-xs">MCP Token</div>
            <div className="mt-1 break-all text-xs bg-gray-50 p-2 rounded border">{mcp || "(not set)"}</div>
          </div>
          <div className="border rounded p-2">
            <div className="text-xs">Tool Keys</div>
            {toolsKeys.length === 0 ? (
              <div className="text-xs text-gray-500">No tools yet</div>
            ) : (
              <ul className="mt-1 space-y-1">
                {toolsKeys.map(t => (
                  <li key={t.name} className="text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono">{t.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="break-all bg-gray-50 border rounded px-2 py-1">{t.api_key || "(not set)"}</span>
                        <Button size="sm" variant="outline" onClick={async () => { try { await api.rotateToolKey(t.name); } finally { try { await refetch(); } catch {} } }}>Rotate</Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function VisualKeywordsEditor({ agents, currentRules, onSave }: { agents: string[]; currentRules: any; onSave: (rules: any) => Promise<void> }) {
  const [selectedAgent, setSelectedAgent] = useStateReact<string>(agents[0] || "");
  const [keywordsMap, setKeywordsMap] = useStateReact<Record<string, string[]>>(() => {
    const base = ((currentRules?.keywords as Record<string, string[]>) || {});
    const out: Record<string, string[]> = {};
    agents.forEach(a => { out[a] = (base[a] || []).slice(0, 50); });
    return out;
  });
  const [inputVal, setInputVal] = useStateReact("");
  const canSave = useMemo(() => true, [keywordsMap]);

  const addKeyword = () => {
    const k = inputVal.trim();
    if (!k) return;
    setKeywordsMap(prev => {
      const arr = new Set([...(prev[selectedAgent] || [])]);
      arr.add(k);
      return { ...prev, [selectedAgent]: Array.from(arr).slice(0, 50) };
    });
    setInputVal("");
  };

  const removeKeyword = (k: string) => {
    setKeywordsMap(prev => ({ ...prev, [selectedAgent]: (prev[selectedAgent] || []).filter(x => x !== k) }));
  };

  return (
    <div className="border rounded p-3">
      <div className="text-sm font-medium mb-2">Routing Keywords</div>
      <p className="text-xs text-gray-600 mb-3">
        Tell the orchestrator which words to look for to pick an agent. For example, if a message includes
        the word "order" or "buy", you might route it to the <span className="font-mono">procurement</span> agent. You can add
        as many simple words as you like. Keep them short and clear.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <div className="text-xs text-gray-500 mb-1">Choose Agent (who should handle matched messages)</div>
          <select className="w-full border rounded p-2 text-sm" value={selectedAgent} onChange={(e) => setSelectedAgent(e.target.value)}>
            {agents.map((a: string) => (<option key={a} value={a}>{a}</option>))}
          </select>
        </div>
        <div className="md:col-span-2">
          <div className="text-xs text-gray-500 mb-1">Add Keyword (a word that appears in the user message)</div>
          <div className="flex gap-2">
            <input className="flex-1 border rounded p-2 text-sm" placeholder="e.g., order" value={inputVal} onChange={(e) => setInputVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addKeyword(); }} />
            <Button onClick={addKeyword} size="sm">Add</Button>
          </div>
          <div className="text-xs text-gray-500 mt-1">Example keywords: <span className="font-mono">order</span>, <span className="font-mono">buy</span>, <span className="font-mono">invoice</span>, <span className="font-mono">research</span>, <span className="font-mono">email</span></div>
          <div className="mt-2 flex flex-wrap gap-2">
            {(keywordsMap[selectedAgent] || []).map(k => (
              <span key={k} className="inline-flex items-center gap-1 text-xs bg-purple-50 border border-purple-200 px-2 py-1 rounded">
                {k}
                <button className="text-purple-700" onClick={() => removeKeyword(k)}>×</button>
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <Button size="sm" disabled={!canSave} onClick={async () => {
          const rules = { keywords: keywordsMap };
          await onSave(rules);
        }}>Save</Button>
      </div>
      <div className="text-xs text-gray-500 mt-1">
        Tips: Use simple words. If a message contains any of the keywords for an agent, the orchestrator will prefer that agent.
      </div>
    </div>
  );
}

function ToolsManager() {
  const { data, refetch } = useQuery({ queryKey: ["tools_db"], queryFn: api.getToolsDb });
  const items: Array<{ name: string; description?: string; module?: string; required_keys?: string[]; api_key?: string | null }> = (data?.tools as any) || [];
  const [selected, setSelected] = useStateReact<string | null>(null);
  const [editor, setEditor] = useStateReact<{ code: string; name: string; description?: string; module: string; required_keys?: string[] } | null>(null);
  const loadTool = async (name: string) => {
    const t = await api.getToolDb(name);
    setEditor({ code: t.code || '', name: t.name, description: t.description || '', module: t.module || 'gasable_hub.tools', required_keys: t.required_keys || [] });
  };
  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <div className="text-sm text-gray-500">No tools yet. Create one to get started.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((t) => (
            <Card key={t.name} className="cursor-pointer hover:shadow" onClick={async () => { setSelected(t.name); await loadTool(t.name); }}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Wrench className="h-4 w-4 text-green-600" />
                  {t.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="text-gray-700">{t.description || "No description"}</div>
                <div className="text-xs text-gray-500">Module: {t.module || "core"}</div>
                <div className="text-xs text-gray-500">Required Keys: {(t.required_keys || []).join(", ") || "(none)"}</div>
                <div className="text-xs">API Key:
                  <span className="ml-2 break-all bg-gray-50 border rounded px-2 py-1">{t.api_key || "(not set)"}</span>
                </div>
                <div className="flex gap-2 pt-2">
                  <Button size="sm" variant="outline" onClick={() => window.open(`/api/mcp_tools_db/${encodeURIComponent(t.name)}`, '_blank')}>View JSON</Button>
                  <Button size="sm" onClick={async () => { try { await api.rotateToolKey(t.name); } finally { await refetch(); } }}>Rotate Key</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {editor && (
        <div className="border rounded p-3 bg-white">
          <div className="flex items-center justify-between">
            <div className="font-semibold">Edit Tool: {editor.name}</div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditor(null)}>Close</Button>
              <Button size="sm" onClick={async () => { await api.updateTool({ name: editor.name, description: editor.description, module: editor.module, code: editor.code, required_keys: editor.required_keys }); await refetch(); }}>Save</Button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            <div className="space-y-2">
              <div className="text-xs text-gray-500">Description</div>
              <textarea className="w-full border rounded p-2 text-sm h-24" value={editor.description || ''} onChange={(e) => setEditor({ ...editor, description: e.target.value })} />
              <div className="text-xs text-gray-500">Module</div>
              <input className="w-full border rounded p-2 text-sm" value={editor.module} onChange={(e) => setEditor({ ...editor, module: e.target.value })} />
              <div className="text-xs text-gray-500">Required Keys (comma-separated)</div>
              <input className="w-full border rounded p-2 text-sm" value={(editor.required_keys || []).join(',')} onChange={(e) => setEditor({ ...editor, required_keys: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} />
            </div>
            <div className="space-y-2">
              <div className="text-xs text-gray-500">Code</div>
              <textarea className="w-full border rounded p-2 text-xs h-72 font-mono" value={editor.code} onChange={(e) => setEditor({ ...editor, code: e.target.value })} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function OrchestratorPromptEditor({ orchestratorData, onSaved }: { orchestratorData: any; onSaved: () => void }) {
  const [value, setValue] = useStateReact<string>("");
  useEffectReact(() => {
    setValue((orchestratorData?.system_prompt as string) || "");
  }, [orchestratorData]);
  return (
    <textarea
      className="w-full border rounded p-2 text-sm h-32"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={async () => {
        await api.setOrchestrator({ system_prompt: value, rules: (orchestratorData?.rules as Record<string, unknown>) || {} });
        onSaved();
      }}
    />
  );
}
