"use client";

import { Handle, Position } from "@xyflow/react";
import { Wrench } from "lucide-react";

export type ToolNodeData = {
  label: string;
  toolName?: string;
  description?: string;
};

export function ToolNode({ data, selected }: { data: ToolNodeData; selected?: boolean }) {
  return (
    <div
      className={`rounded-xl border bg-white shadow-lg p-4 w-64 transition-all ${
        selected ? "ring-2 ring-green-500 shadow-xl" : ""
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <Wrench className="h-5 w-5 text-green-600" />
        <div className="font-semibold text-sm">{data.label}</div>
      </div>
      {data.toolName && (
        <div className="text-xs text-gray-500 bg-gray-50 rounded px-2 py-1 mb-1">
          Tool: {data.toolName}
        </div>
      )}
      {data.description && (
        <div className="text-xs text-gray-400 truncate">{data.description}</div>
      )}
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-green-500 !w-3 !h-3"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-green-500 !w-3 !h-3"
      />
    </div>
  );
}

