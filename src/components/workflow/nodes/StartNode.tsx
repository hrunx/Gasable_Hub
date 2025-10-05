"use client";

import { Handle, Position } from "@xyflow/react";
import { Play } from "lucide-react";

export type StartNodeData = {
  label: string;
};

export function StartNode({ data, selected }: { data: StartNodeData; selected?: boolean }) {
  return (
    <div
      className={`rounded-full border-2 border-gray-800 bg-gray-900 text-white shadow-lg p-4 transition-all ${
        selected ? "ring-2 ring-gray-600 shadow-xl" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <Play className="h-5 w-5" />
        <div className="font-semibold text-sm">{data.label}</div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-gray-800 !w-3 !h-3"
      />
    </div>
  );
}

