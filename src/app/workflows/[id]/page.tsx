"use client";

import { use, useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { WorkflowCanvas } from "@/components/workflow/WorkflowCanvas";
import { TemplateSelector } from "@/components/workflow/TemplateSelector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Save, Play, FileText, Loader2, Key, Wrench, Info } from "lucide-react";
import { api } from "@/lib/api";
import { WorkflowTemplate } from "@/lib/workflow-templates";
import Link from "next/link";
import { Node, Edge } from "@xyflow/react";
import { useToast } from "@/hooks/use-toast";
import { getLayoutedElements, nodesHavePositions } from "@/lib/layout";

export default function WorkflowPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { toast } = useToast();
  const [workflowName, setWorkflowName] = useState("Untitled Workflow");
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [currentGraph, setCurrentGraph] = useState<{ nodes: Node[]; edges: Edge[] } | null>(null);
  const [isTestRunning, setIsTestRunning] = useState(false);
  const [requiredTools, setRequiredTools] = useState<Array<{ name: string; description?: string; required_keys: string[]; auth?: { type?: string; provider?: string } }>>([]);
  const [keyPromptOpen, setKeyPromptOpen] = useState(false);
  const [pendingKeys, setPendingKeys] = useState<Record<string, string>>({});
  const [description, setDescription] = useState<string>("");

  const saveWorkflow = useMutation({
    mutationFn: (graph: { nodes: Node[]; edges: Edge[] }) =>
      api.saveWorkflow({
        id: id === "new" ? undefined : id,
        display_name: workflowName,
        namespace: "global",
        graph,
        description,
      }),
  });

  const handleSave = (graph: { nodes: Node[]; edges: Edge[] }) => {
    setCurrentGraph(graph);
    saveWorkflow.mutate(graph);
  };

  const handleTemplateSelect = (template: WorkflowTemplate) => {
    setWorkflowName(template.name);
    setCurrentGraph({ nodes: template.nodes, edges: template.edges });
    toast({
      title: "Template Loaded",
      description: `${template.name} has been applied to your workflow`,
    });
  };

  // Normalize a saved graph (nodes/edges) to XYFlow format with layout
  function normalizeGraph(graph: any): { nodes: Node[]; edges: Edge[] } {
    const nodesIn: any[] = Array.isArray(graph?.nodes) ? graph.nodes : [];
    const edgesIn: any[] = Array.isArray(graph?.edges) ? graph.edges : [];
    const outNodes: Node[] = [];
    const outEdges: Edge[] = [];
    
    // If there is no explicit start, create one
    const hasStart = nodesIn.some((n) => (n?.type || '').toLowerCase() === 'start' || n?.id === 'start');
    if (!hasStart) {
      outNodes.push({ id: 'start', type: 'startNode', position: { x: 200, y: 50 }, data: { label: 'Start' } });
    }
    
    // Convert nodes to XYFlow format
    for (const n of nodesIn) {
      const id = String(n?.id || `${(n?.type || 'node')}_${outNodes.length + 1}`);
      const typeStr = String(n?.type || 'toolNode').toLowerCase();
      
      // Map type names
      let type: string = 'toolNode';
      if (typeStr === 'start' || typeStr === 'startnode') type = 'startNode';
      else if (typeStr === 'decision' || typeStr === 'decisionnode') type = 'decisionNode';
      else if (typeStr === 'agent' || typeStr === 'agentnode') type = 'agentNode';
      else if (typeStr === 'tool' || typeStr === 'toolnode') type = 'toolNode';
      
      // Build data object with enriched information
      const data: any = { 
        label: n?.data?.label || n?.label || n?.name || id,
      };
      
      // Add toolName from various possible sources
      if (n?.data?.toolName) data.toolName = n.data.toolName;
      else if (n?.tool) data.toolName = n.tool;
      else if (n?.type && type === 'toolNode') data.toolName = n.type;
      
      // Add description from various sources
      if (n?.data?.description) data.description = n.data.description;
      else if (n?.description) data.description = n.description;
      
      // Add other enriched data
      if (n?.required_keys) data.required_keys = n.required_keys;
      if (n?.auth) data.auth = n.auth;
      if (n?.category) data.category = n.category;
      if (n?.params) data.params = n.params;
      
      // Preserve existing position if valid
      const hasPos = n?.position && typeof n.position.x === 'number' && typeof n.position.y === 'number';
      const position = hasPos ? n.position : { x: 0, y: 0 }; // Will be layouted later
      
      outNodes.push({ id, type, position, data });
    }
    
    // Convert edges to XYFlow format
    for (const e of edgesIn) {
      const src = String(e?.source || e?.from || '');
      const dst = String(e?.target || e?.to || '');
      if (!src || !dst) continue;
      outEdges.push({ 
        id: e?.id || `${src}->${dst}`, 
        source: src, 
        target: dst, 
        animated: true, 
        type: 'smoothstep',
        label: e?.label,
      });
    }
    
    // If no edges exist, try to create simple chain
    if (outEdges.length === 0 && outNodes.length > 1) {
      const startNode = outNodes.find((n) => n.id === 'start' || n.type === 'startNode');
      const otherNodes = outNodes.filter((n) => n.id !== 'start' && n.type !== 'startNode');
      
      if (startNode && otherNodes.length > 0) {
        outEdges.push({ 
          id: `${startNode.id}->${otherNodes[0].id}`, 
          source: startNode.id, 
          target: otherNodes[0].id, 
          animated: true, 
          type: 'smoothstep' 
        });
        
        // Chain remaining nodes
        for (let i = 0; i < otherNodes.length - 1; i++) {
          outEdges.push({ 
            id: `${otherNodes[i].id}->${otherNodes[i + 1].id}`, 
            source: otherNodes[i].id, 
            target: otherNodes[i + 1].id, 
            animated: true, 
            type: 'smoothstep' 
          });
        }
      }
    }
    
    // Apply dagre layout if nodes don't have valid positions OR force re-layout
    let finalNodes = outNodes;
    if (outEdges.length > 0) {
      // Always apply layout for imported workflows to ensure proper spacing
      finalNodes = getLayoutedElements(outNodes, outEdges, {
        rankdir: 'TB',
        nodeWidth: 320,
        nodeHeight: 240,
        ranksep: 250,
        nodesep: 200,
      });
    }
    
    return { nodes: finalNodes, edges: outEdges };
  }

  // Load existing workflow by id and prefill canvas
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!id || id === "new") return;
      try {
        // Fetch workflow with enriched node data
        const wf = await api.getWorkflowEnriched(id);
        const name = (wf.display_name as string) || id;
        const graphRaw = (wf.graph as { nodes?: Node[]; edges?: Edge[] }) || { nodes: [], edges: [] };
        const graph = normalizeGraph(graphRaw);
        
        if (!cancelled) {
          setWorkflowName(name);
          setDescription((wf.description as string) || "");
          setCurrentGraph({ nodes: (graph.nodes || []) as Node[], edges: (graph.edges || []) as Edge[] });
          
          // Collect all required credentials from enriched nodes
          const requiredCreds = new Map<string, { name: string; description?: string; required_keys: string[]; auth?: any }>();
          
          console.log("Processing graph nodes for requirements:", graph.nodes);
          
          for (const n of (graph.nodes || []) as any[]) {
            const data = n?.data || {};
            const toolName = data.toolName || n?.tool || n?.name;
            const reqKeys = data.required_keys || n?.required_keys || [];
            const description = data.description || n?.description;
            const auth = data.auth || n?.auth;
            
            console.log("Node:", {
              id: n?.id,
              toolName,
              reqKeys,
              hasAuth: !!auth,
            });
            
            // Add to requirements even if no keys (to show what tools are used)
            if (toolName) {
              if (!requiredCreds.has(toolName)) {
                requiredCreds.set(toolName, {
                  name: toolName,
                  description: description || undefined,
                  required_keys: reqKeys,
                  auth: auth || undefined,
                });
              } else {
                // Merge keys if tool appears multiple times
                const existing = requiredCreds.get(toolName)!;
                existing.required_keys = Array.from(new Set([...existing.required_keys, ...reqKeys]));
              }
            }
          }
          
          const toolsList = Array.from(requiredCreds.values());
          console.log("Final required tools list:", toolsList);
          
          if (!cancelled) {
            setRequiredTools(toolsList);
            
            // Collect all unique required keys
            const allKeys = new Set<string>();
            for (const tool of toolsList) {
              for (const key of tool.required_keys) {
                allKeys.add(key);
              }
            }
            
            console.log("All required keys:", Array.from(allKeys));
            
            // Prompt for keys if any are required
            if (allKeys.size > 0) {
              setPendingKeys(Object.fromEntries(Array.from(allKeys).map(k => [k, ""])));
              // Don't auto-open, wait for test run
            }
          }
        }
      } catch (err) {
        console.error("Failed to load workflow:", err);
        // ignore; page will remain empty state
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const handleTestRun = async () => {
    if (!currentGraph || currentGraph.nodes.length === 0) {
      toast({
        title: "No Workflow",
        description: "Please build a workflow before testing",
        variant: "destructive",
      });
      return;
    }

    // Check if any credentials are required
    const needKeys = new Set<string>();
    for (const tool of requiredTools) {
      for (const key of tool.required_keys) {
        needKeys.add(key);
      }
    }

    // Prompt for credentials if needed
    if (needKeys.size > 0) {
      // Check if credentials are already provided
      const missingKeys = Array.from(needKeys).filter(k => !pendingKeys[k]);
      if (missingKeys.length > 0) {
        toast({
          title: "Credentials Required",
          description: `Please provide: ${missingKeys.join(", ")}`,
          variant: "destructive",
        });
        setKeyPromptOpen(true);
        return;
      }
    }

    setIsTestRunning(true);
    toast({
      title: "Test Run Started",
      description: "Executing workflow...",
    });

    try {
      // Execute the workflow directly
      const response = await fetch(`/api/workflows/${id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputs: {},
          context: { test: true },
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Workflow execution failed");
      }

      const data = await response.json();

      toast({
        title: "Test Run Complete",
        description: "Workflow executed successfully",
      });
      
      // Log result for debugging
      console.log("Workflow result:", data);
    } catch (err: any) {
      toast({
        title: "Test Run Failed",
        description: err.message || "Failed to execute workflow",
        variant: "destructive",
      });
    } finally {
      setIsTestRunning(false);
    }
  };

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white border-b px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </Link>
          <Input
            value={workflowName}
            onChange={(e) => setWorkflowName(e.target.value)}
            className="w-64"
            placeholder="Workflow name"
          />
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="hidden md:block w-96"
            placeholder="Describe what this workflow does and required keys"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTemplateModalOpen(true)}
          >
            <FileText className="mr-2 h-4 w-4" />
            Templates
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleTestRun}
            disabled={isTestRunning || !currentGraph}
          >
            {isTestRunning ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            Test Run
          </Button>
          <Button size="sm" disabled={saveWorkflow.isPending}>
            <Save className="mr-2 h-4 w-4" />
            {saveWorkflow.isPending ? "Saving..." : "Save"}
          </Button>
        </div>
      </header>

      {/* Template Selector */}
      <TemplateSelector
        open={templateModalOpen}
        onClose={() => setTemplateModalOpen(false)}
        onSelect={handleTemplateSelect}
      />

      {/* Canvas */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <WorkflowCanvas 
            onSave={handleSave}
            initialNodes={currentGraph?.nodes}
            initialEdges={currentGraph?.edges}
          />
        </div>
        <div className="border rounded p-4 bg-white overflow-y-auto max-h-[calc(100vh-200px)]">
          <div className="flex items-center gap-2 mb-3">
            <Key className="h-5 w-5 text-blue-600" />
            <div className="text-base font-semibold">Workflow Requirements</div>
          </div>
          {requiredTools.length === 0 ? (
            <div className="text-sm text-gray-500 bg-gray-50 rounded p-3">
              No credential requirements detected for this workflow.
            </div>
          ) : (
            <div className="space-y-3">
              {requiredTools.map((t, idx) => (
                <div key={`${t.name}-${idx}`} className="border border-amber-200 bg-amber-50 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Wrench className="h-4 w-4 text-amber-700" />
                    <div className="text-sm font-semibold text-amber-900">{t.name}</div>
                  </div>
                  {t.description && (
                    <div className="text-xs text-gray-700 mb-2 line-clamp-3">{t.description}</div>
                  )}
                  {t.required_keys.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-amber-200">
                      <div className="text-xs font-medium text-amber-800 mb-1">Required API Keys:</div>
                      <div className="space-y-1">
                        {t.required_keys.map((key) => (
                          <div key={key} className="text-xs bg-white rounded px-2 py-1 font-mono text-amber-900 border border-amber-300">
                            {key}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {t.auth?.provider && (
                    <div className="mt-2 text-xs text-gray-600 flex items-center gap-1">
                      <Info className="h-3 w-3" />
                      <span>Provider: {t.auth.provider}</span>
                    </div>
                  )}
                </div>
              ))}
              <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded">
                <div className="text-xs text-blue-800">
                  <strong>💡 Tip:</strong> Click "Test Run" to execute this workflow. You'll be prompted for any missing credentials.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Enhanced Keys Prompt Modal */}
      {keyPromptOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-lg p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-amber-100 rounded-lg">
                <Key className="h-6 w-6 text-amber-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Credentials Required</h3>
                <p className="text-sm text-gray-600">This workflow needs API keys to run</p>
              </div>
            </div>
            
            <div className="space-y-4 max-h-96 overflow-y-auto mb-6">
              {Object.keys(pendingKeys).map((k) => (
                <div key={k} className="space-y-2">
                  <label htmlFor={`key-${k}`} className="text-sm font-medium text-gray-700 flex items-center gap-2">
                    <Key className="h-4 w-4 text-gray-400" />
                    {k}
                  </label>
                  <Input 
                    id={`key-${k}`}
                    type="password" 
                    placeholder={`Enter ${k}`}
                    value={pendingKeys[k] || ''} 
                    onChange={(e) => setPendingKeys(prev => ({ ...prev, [k]: e.target.value }))}
                    className="font-mono text-sm"
                  />
                </div>
              ))}
            </div>
            
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
              <p className="text-xs text-blue-800">
                <strong>Note:</strong> These credentials will be securely stored and used for this workflow execution.
                You can manage them later in the API settings.
              </p>
            </div>
            
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setKeyPromptOpen(false)}>
                Cancel
              </Button>
              <Button 
                onClick={async () => {
                  try {
                    const entries = Object.entries(pendingKeys).filter(([_, v]) => !!v);
                    if (entries.length === 0) {
                      toast({
                        title: "No credentials provided",
                        description: "Please enter at least one credential",
                        variant: "destructive",
                      });
                      return;
                    }
                    for (const [name, value] of entries) {
                      await fetch('/api/secrets', { 
                        method: 'POST', 
                        headers: { 'Content-Type': 'application/json' }, 
                        body: JSON.stringify({ name, value }) 
                      });
                    }
                    toast({
                      title: "Credentials Saved",
                      description: "Your API keys have been securely stored",
                    });
                    setKeyPromptOpen(false);
                  } catch (err) {
                    toast({
                      title: "Save Failed",
                      description: "Failed to save credentials",
                      variant: "destructive",
                    });
                  }
                }}
                className="bg-green-600 hover:bg-green-700"
              >
                <Key className="mr-2 h-4 w-4" />
                Save Credentials
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

