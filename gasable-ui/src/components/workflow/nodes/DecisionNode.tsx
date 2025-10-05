"use client";

import { Handle, Position } from "@xyflow/react";
import { GitBranch } from "lucide-react";

export type DecisionNodeData = {
  label: string;
  prompt?: string;
  conditions?: string[];
};

export function DecisionNode({ data, selected }: { data: DecisionNodeData; selected?: boolean }) {
  return (
    <div
      className={`rounded-xl border bg-white shadow-lg p-4 w-64 transition-all ${
        selected ? "ring-2 ring-purple-500 shadow-xl" : ""
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <GitBranch className="h-5 w-5 text-purple-600" />
        <div className="font-semibold text-sm">{data.label}</div>
      </div>
      {data.prompt && (
        <div className="text-xs text-gray-500 bg-gray-50 rounded px-2 py-1">
          {data.prompt}
        </div>
      )}
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-purple-500 !w-3 !h-3"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="yes"
        className="!bg-purple-500 !w-3 !h-3 !-bottom-1 !left-1/4"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="no"
        className="!bg-purple-500 !w-3 !h-3 !-bottom-1 !right-1/4"
      />
    </div>
  );
}

