"use client";

import { use, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { WorkflowCanvas } from "@/components/workflow/WorkflowCanvas";
import { TemplateSelector } from "@/components/workflow/TemplateSelector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Save, Play, FileText, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { WorkflowTemplate } from "@/lib/workflow-templates";
import Link from "next/link";
import { Node, Edge } from "@xyflow/react";
import { useToast } from "@/hooks/use-toast";

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

  const saveWorkflow = useMutation({
    mutationFn: (graph: { nodes: Node[]; edges: Edge[] }) =>
      api.saveWorkflow({
        id: id === "new" ? undefined : id,
        display_name: workflowName,
        namespace: "global",
        graph,
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

  const handleTestRun = async () => {
    if (!currentGraph || currentGraph.nodes.length === 0) {
      toast({
        title: "No Workflow",
        description: "Please build a workflow before testing",
        variant: "destructive",
      });
      return;
    }

    setIsTestRunning(true);
    toast({
      title: "Test Run Started",
      description: "Executing workflow...",
    });

    try {
      // Execute the workflow by calling the orchestrate API with the start node
      const response = await fetch("http://localhost:8000/api/orchestrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: "test_user",
          message: "Test workflow execution",
          namespace: "global",
        }),
      });

      const data = await response.json();

      toast({
        title: "Test Run Complete",
        description: data.message || "Workflow executed successfully",
      });
    } catch {
      toast({
        title: "Test Run Failed",
        description: "Failed to execute workflow",
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
      <div className="flex-1">
        <WorkflowCanvas 
          onSave={handleSave}
          initialNodes={currentGraph?.nodes}
          initialEdges={currentGraph?.edges}
        />
      </div>
    </div>
  );
}

