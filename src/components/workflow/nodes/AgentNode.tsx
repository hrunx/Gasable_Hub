"use client";

import { Handle, Position } from "@xyflow/react";
import { Bot } from "lucide-react";

export type AgentNodeData = {
  label: string;
  agentId?: string;
  systemPrompt?: string;
};

export function AgentNode({ data, selected }: { data: AgentNodeData; selected?: boolean }) {
  return (
    <div
      className={`rounded-xl border bg-white shadow-lg p-4 w-64 transition-all ${
        selected ? "ring-2 ring-blue-500 shadow-xl" : ""
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <Bot className="h-5 w-5 text-blue-600" />
        <div className="font-semibold text-sm">{data.label}</div>
      </div>
      {data.agentId && (
        <div className="text-xs text-gray-500 bg-gray-50 rounded px-2 py-1">
          ID: {data.agentId}
        </div>
      )}
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-blue-500 !w-3 !h-3"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-blue-500 !w-3 !h-3"
      />
    </div>
  );
}

