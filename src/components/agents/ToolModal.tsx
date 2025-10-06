"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";

interface ToolModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tool?: { name: string; description?: string; module?: string } | null;
}

// Starter catalog entries for common tools (extensible)
const TOOL_TEMPLATES: Array<{ id: string; name: string; description: string; code: (args: Record<string,string>) => string; fields: Array<{ key: string; label: string; placeholder?: string }>}> = [
  {
    id: "n8n_webhook",
    name: "n8n Webhook Trigger",
    description: "Invoke an n8n workflow via a webhook URL.",
    fields: [
      { key: "WEBHOOK_URL", label: "Webhook URL", placeholder: "https://your-n8n/webhook/xyz" },
      { key: "WEBHOOK_AUTH", label: "Auth Header (optional)", placeholder: "Bearer xxxxx" },
    ],
    code: (args) => `from __future__ import annotations

import os, requests
try:
    from mcp.server.fastmcp import Context  # type: ignore
except Exception:
    class Context:  # type: ignore
        pass

def register(mcp):
    @mcp.tool()
    def n8n_trigger(payload: dict, ctx: Context | None = None) -> dict:
        """Send a JSON payload to n8n webhook and return response JSON."""
        url = os.getenv("WEBHOOK_URL", "").strip() or "${args.WEBHOOK_URL or ''}"
        if not url:
            return {"status": "error", "error": "WEBHOOK_URL not set"}
        headers = {"Content-Type": "application/json"}
        extra = (os.getenv("WEBHOOK_AUTH", "").strip() or "${args.WEBHOOK_AUTH or ''}")
        if extra:
            headers["Authorization"] = extra
        try:
            r = requests.post(url, json=payload, headers=headers, timeout=60)
            r.raise_for_status()
            return {"status": "ok", "result": r.json() if 'application/json' in r.headers.get('content-type','') else r.text}
        except Exception as e:
            return {"status": "error", "error": str(e)}
`
  },
];

export function ToolModal({ open, onOpenChange, tool }: ToolModalProps) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"view" | "catalog" | "ai">(tool ? "view" : "catalog");
  const [name, setName] = useState(tool?.name || "");
  const [description, setDescription] = useState(tool?.description || "");
  const [module, setModule] = useState(tool?.module || "gasable_hub.tools");
  const [code, setCode] = useState<string>("");
  const [selectedTemplate, setSelectedTemplate] = useState<string>(TOOL_TEMPLATES[0]?.id || "");
  const [templateValues, setTemplateValues] = useState<Record<string,string>>({});
  const selected = useMemo(() => TOOL_TEMPLATES.find(t => t.id === selectedTemplate), [selectedTemplate]);

  useEffect(() => {
    if (open) {
      setMode(tool ? "view" : "catalog");
      setName(tool?.name || "");
      setDescription(tool?.description || "");
      setModule(tool?.module || "gasable_hub.tools");
      setCode("");
      setSelectedTemplate(TOOL_TEMPLATES[0]?.id || "");
      setTemplateValues({});
    }
  }, [open, tool]);

  const createTool = useMutation({
    mutationFn: async () => {
      const body = {
        name,
        description,
        module,
        code: code || (selected ? selected.code(templateValues) : ""),
      };
      if (!body.name || !body.code) throw new Error("Name and code are required");
      const res = await fetch("/api/mcp_tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to create tool");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tools"] });
      onOpenChange(false);
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{tool ? tool.name : "New Tool"}</DialogTitle>
          <DialogDescription>
            {mode === "view" ? "Tool details" : mode === "catalog" ? "Create from catalog or write code" : "Describe your tool and AI will draft it"}
          </DialogDescription>
        </DialogHeader>

        {mode === "view" && (
          <div className="space-y-3">
            <div className="text-sm"><b>Name:</b> {tool?.name}</div>
            <div className="text-sm"><b>Module:</b> {tool?.module || "gasable_hub.tools"}</div>
            <div className="text-sm"><b>Description:</b> {tool?.description || "N/A"}</div>
            <div className="pt-2">
              <Button variant="outline" size="sm" onClick={() => setMode("catalog")}>Create Another Tool</Button>
            </div>
          </div>
        )}

        {mode !== "view" && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="orders_place, n8n_trigger" />
              </div>
              <div className="space-y-2">
                <Label>Module</Label>
                <Input value={module} onChange={(e) => setModule(e.target.value)} placeholder="gasable_hub.tools" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What the tool does" />
            </div>

            <div className="flex items-center gap-4">
              <Button type="button" variant={mode === "catalog" ? "default" : "outline"} onClick={() => setMode("catalog")}>Catalog</Button>
              <Button type="button" variant={mode === "ai" ? "default" : "outline"} onClick={() => setMode("ai")}>AI Builder</Button>
              <Button type="button" variant={code ? "default" : "outline"} onClick={() => setMode("catalog")}>Code</Button>
            </div>

            {mode === "catalog" && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>Template</Label>
                  <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TOOL_TEMPLATES.map(t => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {selected && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {selected.fields.map(f => (
                      <div key={f.key} className="space-y-2">
                        <Label>{f.label}</Label>
                        <Input value={templateValues[f.key] || ""} onChange={(e) => setTemplateValues({ ...templateValues, [f.key]: e.target.value })} placeholder={f.placeholder} />
                      </div>
                    ))}
                  </div>
                )}
                <div className="space-y-2">
                  <Label>Generated Code (editable)</Label>
                  <Textarea rows={10} value={code || (selected ? selected.code(templateValues) : "")} onChange={(e) => setCode(e.target.value)} />
                </div>
              </div>
            )}

            {mode === "ai" && (
              <div className="space-y-3">
                <Label>Describe the tool you want</Label>
                <Textarea rows={4} placeholder="e.g., A tool that posts JSON to a webhook with auth header, returns JSON" onChange={() => { /* Future: call LLM to draft code */ }} />
                <div className="text-xs text-gray-500">AI drafting can be wired to your LLM later; for now use Catalog or paste code.</div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          {mode !== "view" && (
            <Button onClick={() => createTool.mutate()} disabled={createTool.isPending}>
              {createTool.isPending ? "Creating..." : "Create Tool"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


