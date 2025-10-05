"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  Connection,
  Edge,
  Node,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { AgentNode } from "./nodes/AgentNode";
import { ToolNode } from "./nodes/ToolNode";
import { DecisionNode } from "./nodes/DecisionNode";
import { StartNode } from "./nodes/StartNode";
import { NodeSidebar } from "./NodeSidebar";
import { NodeConfigSidebar } from "./NodeConfigSidebar";

const initialNodes: Node[] = [
  {
    id: "start",
    type: "startNode",
    position: { x: 400, y: 50 },
    data: { label: "Start" },
  },
];

const initialEdges: Edge[] = [];

export function WorkflowCanvas({
  onSave,
  initialNodes: providedInitialNodes,
  initialEdges: providedInitialEdges,
}: {
  onSave?: (graph: { nodes: Node[]; edges: Edge[] }) => void;
  initialNodes?: Node[];
  initialEdges?: Edge[];
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState(
    providedInitialNodes || initialNodes
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    providedInitialEdges || initialEdges
  );
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

  // Update nodes/edges when template is applied
  useEffect(() => {
    if (providedInitialNodes) {
      setNodes(providedInitialNodes);
    }
    if (providedInitialEdges) {
      setEdges(providedInitialEdges);
    }
  }, [providedInitialNodes, providedInitialEdges, setNodes, setEdges]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) =>
        addEdge({ ...connection, animated: true, type: "smoothstep" }, eds)
      );
    },
    [setEdges]
  );

  // Handle node click
  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
  }, []);

  // Handle node context menu (right-click)
  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      setSelectedNode(node);
    },
    []
  );

  // Update node configuration
  const handleNodeUpdate = useCallback(
    (nodeId: string, data: Record<string, unknown>) => {
      setNodes((nds) =>
        nds.map((node) =>
          node.id === nodeId
            ? { ...node, data: { ...node.data, ...data } }
            : node
        )
      );
      setSelectedNode(null);
    },
    [setNodes]
  );

  // Auto-save debounced
  useEffect(() => {
    const timer = setTimeout(() => {
      if (onSave && (nodes.length > 1 || edges.length > 0)) {
        onSave({ nodes, edges });
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [nodes, edges, onSave]);

  const nodeTypes = useMemo(
    () => ({
      agentNode: AgentNode,
      toolNode: ToolNode,
      decisionNode: DecisionNode,
      startNode: StartNode,
    }),
    []
  );

  return (
    <div className="flex h-full">
      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onNodeContextMenu={onNodeContextMenu}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.2}
          maxZoom={2}
          defaultEdgeOptions={{
            animated: true,
            type: "smoothstep",
          }}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          <Controls />
          <MiniMap pannable zoomable className="!bg-gray-50" />
        </ReactFlow>
      </div>
      <NodeSidebar
        nodes={nodes}
        setNodes={setNodes}
        edges={edges}
      />
      <NodeConfigSidebar
        node={selectedNode}
        onClose={() => setSelectedNode(null)}
        onUpdate={handleNodeUpdate}
      />
    </div>
  );
}

