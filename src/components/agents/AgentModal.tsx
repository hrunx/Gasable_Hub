"use client";

import { useState } from "react";
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
    answer_model: agent?.answer_model || "gpt-4o",
    rerank_model: agent?.rerank_model || "gpt-4o-mini",
    top_k: agent?.top_k || 12,
  });

  const [selectedTools, setSelectedTools] = useState<string[]>(
    agent?.tool_allowlist || []
  );

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
    saveAgent.mutate({
      ...formData,
      tool_allowlist: selectedTools,
    });
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
          {/* Agent ID */}
          <div className="space-y-2">
            <Label htmlFor="id">
              Agent ID <span className="text-red-500">*</span>
            </Label>
            <Input
              id="id"
              value={formData.id}
              onChange={(e) =>
                setFormData({ ...formData, id: e.target.value.toLowerCase().replace(/\s+/g, "_") })
              }
              placeholder="e.g., research, marketing, support"
              required
              disabled={!!agent}
            />
            <p className="text-xs text-gray-500">
              Unique identifier (lowercase, no spaces)
            </p>
          </div>

          {/* Display Name */}
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

          {/* Answer Model */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="answer_model">Answer Model</Label>
              <Select
                value={formData.answer_model}
                onValueChange={(value) =>
                  setFormData({ ...formData, answer_model: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                  <SelectItem value="gpt-4o-mini">GPT-4o Mini</SelectItem>
                  <SelectItem value="gpt-5-mini">GPT-5 Mini</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="rerank_model">Rerank Model</Label>
              <Select
                value={formData.rerank_model}
                onValueChange={(value) =>
                  setFormData({ ...formData, rerank_model: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                  <SelectItem value="gpt-4o-mini">GPT-4o Mini</SelectItem>
                  <SelectItem value="gpt-5-mini">GPT-5 Mini</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Top K */}
          <div className="space-y-2">
            <Label htmlFor="top_k">Top K Results</Label>
            <Input
              id="top_k"
              type="number"
              value={formData.top_k}
              onChange={(e) =>
                setFormData({ ...formData, top_k: parseInt(e.target.value) })
              }
              min={1}
              max={50}
            />
            <p className="text-xs text-gray-500">
              Number of context chunks to retrieve for RAG
            </p>
          </div>

          <DialogFooter>
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
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

