"use client";

import { Handle, Position } from "@xyflow/react";
import { Wrench, Key, Info } from "lucide-react";

export type ToolNodeData = {
  label: string;
  toolName?: string;
  description?: string;
  required_keys?: string[];
  category?: string;
  auth?: {
    type?: string;
    provider?: string;
  };
};

export function ToolNode({ data, selected }: { data: ToolNodeData; selected?: boolean }) {
  const hasAuth = data.required_keys && data.required_keys.length > 0;
  const hasDescription = data.description && data.description.length > 0;
  
  return (
    <div
      className={`rounded-xl border bg-white shadow-lg p-4 w-72 transition-all ${
        selected ? "ring-2 ring-green-500 shadow-xl" : ""
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <Wrench className="h-5 w-5 text-green-600 flex-shrink-0" />
        <div className="font-semibold text-sm flex-1 truncate" title={data.label}>
          {data.label}
        </div>
        {hasAuth && (
          <div title="Requires credentials">
            <Key className="h-4 w-4 text-amber-500 flex-shrink-0" />
          </div>
        )}
      </div>
      
      {/* Tool name badge */}
      {data.toolName && (
        <div className="text-xs text-gray-600 bg-gray-50 rounded px-2 py-1 mb-2 font-mono truncate" title={data.toolName}>
          {data.toolName}
        </div>
      )}
      
      {/* Category badge */}
      {data.category && (
        <div className="text-xs text-blue-600 bg-blue-50 rounded px-2 py-1 mb-2 inline-block">
          {data.category}
        </div>
      )}
      
      {/* Description */}
      {hasDescription && (
        <div className="text-xs text-gray-600 mb-2 line-clamp-2" title={data.description}>
          {data.description}
        </div>
      )}
      
      {/* Auth requirements */}
      {hasAuth && (
        <div className="mt-2 pt-2 border-t border-gray-100">
          <div className="flex items-center gap-1 mb-1">
            <Key className="h-3 w-3 text-amber-600" />
            <span className="text-xs font-medium text-amber-700">Requires:</span>
          </div>
          <div className="text-xs text-amber-600 space-y-1">
            {data.required_keys!.slice(0, 3).map((key) => (
              <div key={key} className="truncate bg-amber-50 px-2 py-0.5 rounded" title={key}>
                {key}
              </div>
            ))}
            {data.required_keys!.length > 3 && (
              <div className="text-xs text-amber-500">
                +{data.required_keys!.length - 3} more
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Auth provider info */}
      {data.auth?.provider && (
        <div className="mt-2 text-xs text-gray-500 flex items-center gap-1">
          <Info className="h-3 w-3" />
          <span>Provider: {data.auth.provider}</span>
        </div>
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

