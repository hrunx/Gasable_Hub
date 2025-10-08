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
import { useToast } from "@/hooks/use-toast";

interface RagSettings {
  rerank: boolean;
  expansions: number;
  k_dense_fuse: number;
  mmr_lambda: number;
}

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
    rag_settings?: RagSettings;
    api_key?: string;
  } | null;
}

export function AgentModal({ open, onOpenChange, agent }: AgentModalProps) {
  const queryClient = useQueryClient();
  const [rewriteLoading, setRewriteLoading] = useState(false);
  const { toast } = useToast();
  const [showRagDetails, setShowRagDetails] = useState(false);
  const [formData, setFormData] = useState({
    id: agent?.id || "",
    display_name: agent?.display_name || "",
    namespace: agent?.namespace || "global",
    system_prompt: agent?.system_prompt || "",
    tool_allowlist: agent?.tool_allowlist || [],
    answer_model: agent?.answer_model || "gpt-5",
    rerank_model: agent?.rerank_model || "gpt-5-mini",
    top_k: agent?.top_k || 12,
    rag_settings: agent?.rag_settings || {
      rerank: true,
      expansions: 1,
      k_dense_fuse: 8,
      mmr_lambda: 0.6,
    },
  });
  const [apiKey, setApiKey] = useState<string | undefined>(agent?.api_key);

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
        rag_settings: agent?.rag_settings || {
          rerank: true,
          expansions: 1,
          k_dense_fuse: 8,
          mmr_lambda: 0.6,
        },
      });
      setSelectedTools(agent?.tool_allowlist || []);
      setApiKey(agent?.api_key);
    }
  }, [agent, open]);

  // Fetch available tools
  const { data: toolsData } = useQuery({
    queryKey: ["tools"],
    queryFn: api.getTools,
  });

  const tools = toolsData?.tools || [];

  // Debounced autosave when editing an existing agent
  useEffect(() => {
    if (!open || !agent) return;
    const id = agent.id;
    const handle = setTimeout(() => {
      const payload = {
        ...formData,
        id,
        answer_model: "gpt-5",
        rerank_model: "gpt-5-mini",
        top_k: 12,
        rag_settings: formData.rag_settings,
        tool_allowlist: selectedTools,
      } as any;
      api
        .saveAgent(payload)
        .then(() => {
          try { queryClient.invalidateQueries({ queryKey: ["agents"] }); } catch {}
        })
        .catch(() => {
          // silent during typing; explicit error shown on manual save
        });
    }, 800);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, agent?.id, formData.display_name, formData.system_prompt, formData.namespace, JSON.stringify(formData.rag_settings), JSON.stringify(selectedTools)]);

  const saveAgent = useMutation({
    mutationFn: api.saveAgent,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      toast({ title: agent ? "Agent updated" : "Agent created", description: formData.display_name });
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Failed to save agent", description: msg, variant: "destructive" });
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
          .replace(/^_+|_+$/g, "") ||
        `agent_${Math.random().toString(36).slice(2, 8)}`;

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
            toast({ title: "Assistants synced", description: "OpenAI assistants were updated" });
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
      <DialogContent className="w-full sm:max-w-[95vw] md:max-w-3xl lg:max-w-4xl xl:max-w-5xl max-h-[85vh] overflow-y-auto">
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
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={async () => {
                  const txt = formData.system_prompt || "";
                  if (!txt.trim()) {
                    toast({ title: "Add a prompt first", description: "Write a system prompt to improve.", variant: "destructive" });
                    return;
                  }
                  try {
                    setRewriteLoading(true);
                    const { rewritten } = await api.rewritePrompt(txt);
                    const nextText = (rewritten || txt).trim();
                    setFormData({ ...formData, system_prompt: nextText });
                    if (nextText === txt.trim()) {
                      toast({ title: "No changes suggested", description: "AI kept your prompt as-is." });
                    } else {
                      toast({ title: "Prompt improved", description: "AI refined your system prompt." });
                    }
                  } catch (e) {
                    toast({ title: "Failed to improve", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
                  }
                  finally { setRewriteLoading(false); }
                }}
              >
                {rewriteLoading ? "Improving..." : "Improve with AI"}
              </Button>
              <p className="text-xs text-gray-500">AI will rewrite the prompt for clarity and safety.</p>
            </div>
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
          {/* RAG Settings - simplified presets for non-technical users */}
          <div className="space-y-3 mt-4">
            <Label>Results Quality</Label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[
                { key: 'fast', title: 'Fast', hint: 'Quickest responses', val: { rerank: false, expansions: 0, k_dense_fuse: 6, mmr_lambda: 0.5 } },
                { key: 'balanced', title: 'Balanced', hint: 'Good quality + speed', val: { rerank: true, expansions: 1, k_dense_fuse: 8, mmr_lambda: 0.6 } },
                { key: 'accurate', title: 'Accurate', hint: 'Best quality', val: { rerank: true, expansions: 2, k_dense_fuse: 12, mmr_lambda: 0.7 } },
              ].map(p => (
                <button
                  key={p.key}
                  type="button"
                  className={`border rounded p-3 text-left hover:bg-gray-50 ${JSON.stringify(formData.rag_settings)===JSON.stringify(p.val) ? 'border-blue-500' : 'border-gray-200'}`}
                  onClick={() => {
                    setFormData({ ...formData, rag_settings: p.val as any });
                    setShowRagDetails(true);
                  }}
                >
                  <div className="font-medium text-sm">{p.title}</div>
                  <div className="text-xs text-gray-500">{p.hint}</div>
                </button>
              ))}
            </div>
            {showRagDetails && (
              <div className="mt-3 border rounded p-3 bg-gray-50">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">Technical RAG Settings</div>
                  <button
                    type="button"
                    className="text-xs underline"
                    onClick={() => setShowRagDetails(false)}
                  >Hide</button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Rerank</Label>
                    <div className="flex items-center gap-2 p-2 border rounded bg-white">
                      <input
                        type="checkbox"
                        checked={!!formData.rag_settings?.rerank}
                        onChange={(e) => setFormData({ ...formData, rag_settings: { ...(formData.rag_settings || {}), rerank: e.target.checked } })}
                      />
                      <span className="text-xs">Enable reranker</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Expansions</Label>
                    <Input
                      type="number"
                      value={formData.rag_settings?.expansions ?? 0}
                      onChange={(e) => setFormData({ ...formData, rag_settings: { ...(formData.rag_settings || {}), expansions: Number(e.target.value) } })}
                      min={0}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Dense Fuse (k)</Label>
                    <Input
                      type="number"
                      value={formData.rag_settings?.k_dense_fuse ?? 8}
                      onChange={(e) => setFormData({ ...formData, rag_settings: { ...(formData.rag_settings || {}), k_dense_fuse: Number(e.target.value) } })}
                      min={1}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">MMR Lambda</Label>
                    <Input
                      type="number"
                      value={formData.rag_settings?.mmr_lambda ?? 0.6}
                      onChange={(e) => setFormData({ ...formData, rag_settings: { ...(formData.rag_settings || {}), mmr_lambda: Number(e.target.value) } })}
                      min={0}
                      max={1}
                      step={0.05}
                    />
                  </div>
                </div>
                <div className="text-xs text-gray-600 mt-2">
                  Applied: {JSON.stringify(formData.rag_settings)}
                </div>
              </div>
            )}
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
                        // Refresh agents list so API tab reflects new key immediately
                        try { queryClient.invalidateQueries({ queryKey: ["agents"] }); } catch {}
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
              {saveAgent.isPending ? "Saving..." : agent ? "Save Changes" : "Create Agent"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

