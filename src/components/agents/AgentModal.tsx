"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { X } from "lucide-react";

interface AgentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent?: {
    id: string;
    display_name: string;
    namespace: string;
    system_prompt: string;
    tool_allowlist: string[];
    answer_model?: string;
    rerank_model?: string;
    top_k?: number;
  } | null;
}

export function AgentModal({ open, onOpenChange, agent }: AgentModalProps) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    id: agent?.id || "",
    display_name: agent?.display_name || "",
    namespace: agent?.namespace || "global",
    system_prompt: agent?.system_prompt || "",
    tool_allowlist: agent?.tool_allowlist || [],
    answer_model: agent?.answer_model || "gpt-5",
    rerank_model: agent?.rerank_model || "gpt-5-mini",
    top_k: agent?.top_k || 12,
    rag_settings: (agent as any)?.rag_settings || {
      rerank: true,
      expansions: 1,
      k_dense_fuse: 8,
      mmr_lambda: 0.6,
    },
  });
  const [apiKey, setApiKey] = useState<string | undefined>(agent ? (agent as { api_key?: string }).api_key : undefined);

  const [selectedTools, setSelectedTools] = useState<string[]>(
    agent?.tool_allowlist || []
  );

  // Keep modal fields in sync when editing an existing agent
  useEffect(() => {
    if (open) {
      setFormData({
        id: agent?.id || "",
        display_name: agent?.display_name || "",
        namespace: agent?.namespace || "global",
        system_prompt: agent?.system_prompt || "",
        tool_allowlist: agent?.tool_allowlist || [],
        answer_model: agent?.answer_model || "gpt-5",
        rerank_model: agent?.rerank_model || "gpt-5-mini",
        top_k: agent?.top_k || 12,
        rag_settings: (agent as any)?.rag_settings || {
          rerank: true,
          expansions: 1,
          k_dense_fuse: 8,
          mmr_lambda: 0.6,
        },
      });
      setSelectedTools(agent?.tool_allowlist || []);
      setApiKey(agent ? (agent as { api_key?: string }).api_key : undefined);
    }
  }, [agent, open]);

  // Fetch available tools
  const { data: toolsData } = useQuery({
    queryKey: ["tools"],
    queryFn: api.getTools,
  });

  const tools = toolsData?.tools || [];

  const saveAgent = useMutation({
    mutationFn: api.saveAgent,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      onOpenChange(false);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Auto-generate ID from name on create
    const id = agent?.id
      ? agent.id
      : (formData.display_name || "")
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "");

    saveAgent.mutate(
      {
        ...formData,
        id,
        answer_model: "gpt-5",
        rerank_model: "gpt-5-mini",
        top_k: 12,
        rag_settings: formData.rag_settings,
        tool_allowlist: selectedTools,
      },
      {
        onSuccess: async () => {
          // After saving agent config, sync OpenAI assistants to reflect changes
          try {
            await api.syncAssistants();
            queryClient.invalidateQueries({ queryKey: ["agents"] });
          } catch {
            // Best-effort: ignore sync failure in UI
          }
        },
      }
    );
  };

  const toggleTool = (toolName: string) => {
    setSelectedTools((prev) =>
      prev.includes(toolName)
        ? prev.filter((t) => t !== toolName)
        : [...prev, toolName]
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {agent ? "Edit Agent" : "Create New Agent"}
          </DialogTitle>
          <DialogDescription>
            Configure an AI agent with custom system prompts and tool permissions
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Agent Name */}
          <div className="space-y-2">
            <Label htmlFor="display_name">
              Display Name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="display_name"
              value={formData.display_name}
              onChange={(e) =>
                setFormData({ ...formData, display_name: e.target.value })
              }
              placeholder="e.g., Research Agent, Marketing Specialist"
              required
            />
          </div>

          {/* (ID is auto-generated; hidden from non-technical users) */}

          {/* Namespace */}
          <div className="space-y-2">
            <Label htmlFor="namespace">Namespace</Label>
            <Select
              value={formData.namespace}
              onValueChange={(value) =>
                setFormData({ ...formData, namespace: value })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="global">Global</SelectItem>
                <SelectItem value="dev">Development</SelectItem>
                <SelectItem value="prod">Production</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* System Prompt */}
          <div className="space-y-2">
            <Label htmlFor="system_prompt">
              System Prompt <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="system_prompt"
              value={formData.system_prompt}
              onChange={(e) =>
                setFormData({ ...formData, system_prompt: e.target.value })
              }
              placeholder="You are a helpful assistant that..."
              rows={6}
              required
            />
            <p className="text-xs text-gray-500">
              Define the agent&apos;s role, behavior, and capabilities
            </p>
          </div>

          {/* Tool Allowlist */}
          <div className="space-y-2">
            <Label>
              Tool Permissions <span className="text-red-500">*</span>
            </Label>
            <div className="border rounded-lg p-3 max-h-48 overflow-y-auto">
              <div className="space-y-2">
                {tools.map((tool: { name: string; description?: string }) => (
                  <label
                    key={tool.name}
                    className="flex items-start gap-2 cursor-pointer hover:bg-gray-50 p-2 rounded"
                  >
                    <input
                      type="checkbox"
                      checked={selectedTools.includes(tool.name)}
                      onChange={() => toggleTool(tool.name)}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <div className="font-medium text-sm">{tool.name}</div>
                      {tool.description && (
                        <div className="text-xs text-gray-500">
                          {tool.description}
                        </div>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              {selectedTools.map((tool) => (
                <Badge key={tool} variant="secondary" className="text-xs">
                  {tool}
                  <button
                    type="button"
                    onClick={() => toggleTool(tool)}
                    className="ml-1 hover:text-red-500"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          </div>

          {/* Models and Top K are set to safe defaults and hidden */}
          {/* RAG Settings */}
          <div className="space-y-3 mt-4">
            <Label>RAG Settings</Label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!!formData.rag_settings.rerank}
                    onChange={(e) => setFormData({
                      ...formData,
                      rag_settings: { ...formData.rag_settings, rerank: e.target.checked }
                    })}
                  />
                  Enable LLM Rerank
                </label>
                <p className="text-xs text-gray-500">Improves result quality by reordering context with AI. Turn off for maximum speed.</p>
              </div>

              <div className="space-y-1">
                <Label>Query Expansions</Label>
                <Input
                  type="number"
                  min={0}
                  max={3}
                  value={formData.rag_settings.expansions}
                  onChange={(e) => setFormData({
                    ...formData,
                    rag_settings: { ...formData.rag_settings, expansions: parseInt(e.target.value || '0') }
                  })}
                />
                <p className="text-xs text-gray-500">Extra phrasing variants to broaden retrieval. 0–1 recommended for speed.</p>
              </div>

              <div className="space-y-1">
                <Label>Dense Fuse (per expansion)</Label>
                <Input
                  type="number"
                  min={4}
                  max={16}
                  value={formData.rag_settings.k_dense_fuse}
                  onChange={(e) => setFormData({
                    ...formData,
                    rag_settings: { ...formData.rag_settings, k_dense_fuse: parseInt(e.target.value || '8') }
                  })}
                />
                <p className="text-xs text-gray-500">How many top dense results to keep per expanded query.</p>
              </div>

              <div className="space-y-1">
                <Label>MMR Lambda</Label>
                <Input
                  type="number"
                  step="0.05"
                  min={0}
                  max={1}
                  value={formData.rag_settings.mmr_lambda}
                  onChange={(e) => setFormData({
                    ...formData,
                    rag_settings: { ...formData.rag_settings, mmr_lambda: parseFloat(e.target.value || '0.6') }
                  })}
                />
                <p className="text-xs text-gray-500">Balance between relevance and diversity (higher = relevance).</p>
              </div>
            </div>
          </div>

          <DialogFooter>
            {agent && (
              <div className="mr-auto flex items-center gap-2 text-xs">
                <span className="font-medium">API Key:</span>
                <span className="px-2 py-1 bg-gray-100 rounded border select-all">
                  {apiKey || "(not set)"}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    if (!agent) return;
                    try {
                      const res = await fetch(`/api/agents/${agent.id}/rotate_key`, { method: "POST" });
                      const data = await res.json();
                      if (data.api_key) {
                        setApiKey(data.api_key);
                        navigator.clipboard?.writeText(data.api_key).catch(() => {});
                      }
                    } catch {}
                  }}
                >
                  {apiKey ? "Rotate" : "Generate"}
                </Button>
              </div>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saveAgent.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saveAgent.isPending}>
              {saveAgent.isPending ? "Saving..." : agent ? "Update Agent" : "Create Agent"}
            </Button>
            <Button
              type="button"
              disabled={saveAgent.isPending}
              onClick={(e) => {
                // Submit then provision assistants
                e.preventDefault();
                const fakeEvt = { preventDefault() {} } as unknown as React.FormEvent;
                handleSubmit(fakeEvt);
              }}
            >
              Create & Provision
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

