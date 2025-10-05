"use client";

import { Node } from "@xyflow/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { X, Save } from "lucide-react";

interface NodeConfigSidebarProps {
  node: Node | null;
  onClose: () => void;
  onUpdate: (nodeId: string, data: Record<string, unknown>) => void;
}

export function NodeConfigSidebar({ node, onClose, onUpdate }: NodeConfigSidebarProps) {
  if (!node) return null;

  const nodeData = node.data as Record<string, unknown>;

  const handleSave = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const updates: Record<string, unknown> = {};
    
    formData.forEach((value, key) => {
      updates[key] = value;
    });
    
    onUpdate(node.id, updates);
  };

  return (
    <div className="fixed right-0 top-0 h-full w-80 bg-white border-l shadow-xl z-50 overflow-y-auto">
      <Card className="border-0 rounded-none h-full">
        <CardHeader className="border-b sticky top-0 bg-white z-10">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Configure Node</CardTitle>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-sm text-gray-500">Node ID: {node.id}</p>
        </CardHeader>

        <CardContent className="p-4">
          <form onSubmit={handleSave} className="space-y-4">
            {/* Agent Node Configuration */}
            {node.type === "agentNode" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="label">Node Label</Label>
                  <Input
                    id="label"
                    name="label"
                    defaultValue={(nodeData.label as string) || ""}
                    placeholder="Agent name"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="agentId">Agent</Label>
                  <Input
                    id="agentId"
                    name="agentId"
                    defaultValue={(nodeData.agentId as string) || ""}
                    placeholder="e.g., research, marketing"
                  />
                  <p className="text-xs text-gray-500">
                    ID of the agent to invoke
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="prompt">Input Prompt Template</Label>
                  <Textarea
                    id="prompt"
                    name="prompt"
                    defaultValue={(nodeData.prompt as string) || ""}
                    placeholder="Use {input} to reference previous output"
                    rows={3}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="timeout">Timeout (seconds)</Label>
                  <Input
                    id="timeout"
                    name="timeout"
                    type="number"
                    defaultValue={(nodeData.timeout as number) || 30}
                    min={5}
                    max={300}
                  />
                </div>
              </>
            )}

            {/* Tool Node Configuration */}
            {node.type === "toolNode" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="label">Node Label</Label>
                  <Input
                    id="label"
                    name="label"
                    defaultValue={(nodeData.label as string) || ""}
                    placeholder="Tool name"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="toolName">Tool Name</Label>
                  <Input
                    id="toolName"
                    name="toolName"
                    defaultValue={(nodeData.toolName as string) || ""}
                    placeholder="e.g., rag_search_tool"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="parameters">Parameters (JSON)</Label>
                  <Textarea
                    id="parameters"
                    name="parameters"
                    defaultValue={(nodeData.parameters as string) || "{}"}
                    placeholder='{"key": "value"}'
                    rows={4}
                  />
                </div>
              </>
            )}

            {/* Decision Node Configuration */}
            {node.type === "decisionNode" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="label">Node Label</Label>
                  <Input
                    id="label"
                    name="label"
                    defaultValue={(nodeData.label as string) || ""}
                    placeholder="Decision name"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="condition">Condition Type</Label>
                  <Select name="conditionType" defaultValue={(nodeData.conditionType as string) || "contains"}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="contains">Contains Text</SelectItem>
                      <SelectItem value="equals">Equals</SelectItem>
                      <SelectItem value="regex">Regex Match</SelectItem>
                      <SelectItem value="greater">Greater Than</SelectItem>
                      <SelectItem value="less">Less Than</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="conditionValue">Condition Value</Label>
                  <Input
                    id="conditionValue"
                    name="conditionValue"
                    defaultValue={(nodeData.conditionValue as string) || ""}
                    placeholder="Value to compare against"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    name="description"
                    defaultValue={(nodeData.description as string) || ""}
                    placeholder="Describe what this decision checks"
                    rows={3}
                  />
                </div>
              </>
            )}

            {/* Start Node Configuration */}
            {node.type === "startNode" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="label">Node Label</Label>
                  <Input
                    id="label"
                    name="label"
                    defaultValue={(nodeData.label as string) || "Start"}
                    placeholder="Start"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="initialInput">Initial Input</Label>
                  <Textarea
                    id="initialInput"
                    name="initialInput"
                    defaultValue={(nodeData.initialInput as string) || ""}
                    placeholder="Optional: Define initial workflow input"
                    rows={3}
                  />
                </div>
              </>
            )}

            {/* Common Configuration */}
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                name="notes"
                defaultValue={(nodeData.notes as string) || ""}
                placeholder="Add notes about this node"
                rows={3}
              />
            </div>

            <Button type="submit" className="w-full">
              <Save className="mr-2 h-4 w-4" />
              Save Configuration
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

