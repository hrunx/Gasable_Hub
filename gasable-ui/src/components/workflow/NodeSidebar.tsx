"use client";

import { Node, Edge } from "@xyflow/react";
import { Bot, Wrench, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

export function NodeSidebar({
  nodes,
  setNodes,
  edges,
}: {
  nodes: Node[];
  setNodes: (nodes: Node[] | ((nodes: Node[]) => Node[])) => void;
  edges: Edge[];
}) {
  const addNode = (type: string, label: string) => {
    const newNode: Node = {
      id: `${type}-${Date.now()}`,
      type,
      position: {
        x: Math.random() * 500 + 100,
        y: Math.random() * 400 + 200,
      },
      data: { label },
    };
    setNodes((nds) => [...nds, newNode]);
  };

  return (
    <div className="w-80 border-l bg-gray-50 p-4 overflow-y-auto">
      <h2 className="font-bold text-lg mb-4">Node Palette</h2>

      <div className="space-y-2">
        <Button
          onClick={() => addNode("agentNode", "New Agent")}
          className="w-full justify-start"
          variant="outline"
        >
          <Bot className="mr-2 h-4 w-4" />
          Add Agent
        </Button>

        <Button
          onClick={() => addNode("toolNode", "New Tool")}
          className="w-full justify-start"
          variant="outline"
        >
          <Wrench className="mr-2 h-4 w-4" />
          Add Tool
        </Button>

        <Button
          onClick={() => addNode("decisionNode", "Decision")}
          className="w-full justify-start"
          variant="outline"
        >
          <GitBranch className="mr-2 h-4 w-4" />
          Add Decision
        </Button>
      </div>

      <Separator className="my-6" />

      <div>
        <h3 className="font-semibold mb-2">Workflow Stats</h3>
        <div className="text-sm text-gray-600 space-y-1">
          <div>Nodes: {nodes.length}</div>
          <div>Connections: {edges.length}</div>
        </div>
      </div>

      <Separator className="my-6" />

      <div>
        <h3 className="font-semibold mb-2">Quick Guide</h3>
        <div className="text-xs text-gray-500 space-y-2">
          <p>• Drag nodes to position them</p>
          <p>• Connect nodes by dragging from handles</p>
          <p>• Click nodes to edit properties</p>
          <p>• Use mouse wheel to zoom</p>
        </div>
      </div>
    </div>
  );
}

