"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

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
        url = os.getenv("WEBHOOK_URL", "").strip() or "${(args.WEBHOOK_URL ?? '').replace(/"/g, '\\"')}"
        if not url:
            return {"status": "error", "error": "WEBHOOK_URL not set"}
        headers = {"Content-Type": "application/json"}
        extra = (os.getenv("WEBHOOK_AUTH", "").strip() or "${(args.WEBHOOK_AUTH ?? '').replace(/"/g, '\\"')}")
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
  {
    id: "slack_webhook",
    name: "Slack: Incoming Webhook",
    description: "Post a message to a Slack channel via incoming webhook.",
    fields: [
      { key: "SLACK_WEBHOOK_URL", label: "Webhook URL", placeholder: "https://hooks.slack.com/services/..." },
      { key: "TEXT", label: "Default Text (optional)", placeholder: "Hello from MCP" },
      { key: "USERNAME", label: "Username (optional)", placeholder: "Gasable Bot" },
      { key: "ICON_EMOJI", label: "Icon Emoji (optional)", placeholder: ":robot_face:" },
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
    def slack_post(text: str | None = None, ctx: Context | None = None) -> dict:
        """Post a message to Slack using an incoming webhook."""
        url = os.getenv("SLACK_WEBHOOK_URL", "").strip() or "${(args.SLACK_WEBHOOK_URL ?? '').replace(/"/g, '\\"')}"
        if not url:
            return {"status": "error", "error": "SLACK_WEBHOOK_URL not set"}
        payload = {
            "text": (text or "${(args.TEXT ?? '').replace(/"/g, '\\"')}").strip() or "(no text)",
        }
        username = (os.getenv("USERNAME", "").strip() or "${(args.USERNAME ?? '').replace(/"/g, '\\"')}")
        icon = (os.getenv("ICON_EMOJI", "").strip() or "${(args.ICON_EMOJI ?? '').replace(/"/g, '\\"')}")
        if username:
            payload["username"] = username
        if icon:
            payload["icon_emoji"] = icon
        try:
            r = requests.post(url, json=payload, timeout=30)
            r.raise_for_status()
            return {"status": "ok"}
        except Exception as e:
            return {"status": "error", "error": str(e)}
`
  },
  {
    id: "http_get_json",
    name: "HTTP GET JSON",
    description: "Fetch a JSON URL with optional auth header and return parsed JSON.",
    fields: [
      { key: "URL", label: "URL", placeholder: "https://api.example.com/data" },
      { key: "AUTH_HEADER", label: "Auth Header (optional)", placeholder: "Bearer xxxxx" },
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
    def http_get_json(url: str | None = None, ctx: Context | None = None) -> dict:
        """Perform an HTTP GET request and return JSON if available."""
        target = (url or "${(args.URL ?? '').replace(/"/g, '\\"')}").strip()
        if not target: return {"status":"error","error":"URL is required"}
        headers = {}
        auth = (os.getenv("AUTH_HEADER", "").strip() or "${(args.AUTH_HEADER ?? '').replace(/"/g, '\\"')}")
        if auth: headers["Authorization"] = auth
        try:
            r = requests.get(target, headers=headers, timeout=60)
            r.raise_for_status()
            if 'application/json' in r.headers.get('content-type',''):
                return {"status":"ok","json": r.json()}
            return {"status":"ok","text": r.text}
        except Exception as e:
            return {"status":"error","error": str(e)}
`
  },
  {
    id: "http_post_json",
    name: "HTTP POST JSON",
    description: "POST a JSON payload to a URL with optional auth header.",
    fields: [
      { key: "URL", label: "URL", placeholder: "https://api.example.com/endpoint" },
      { key: "AUTH_HEADER", label: "Auth Header (optional)", placeholder: "Bearer xxxxx" },
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
    def http_post_json(payload: dict, url: str | None = None, ctx: Context | None = None) -> dict:
        """POST JSON to the given URL and return the response."""
        target = (url or "${(args.URL ?? '').replace(/"/g, '\\"')}").strip()
        if not target: return {"status":"error","error":"URL is required"}
        headers={"Content-Type":"application/json"}
        auth = (os.getenv("AUTH_HEADER", "").strip() or "${(args.AUTH_HEADER ?? '').replace(/"/g, '\\"')}")
        if auth: headers["Authorization"] = auth
        try:
            r = requests.post(target, json=payload, headers=headers, timeout=60)
            r.raise_for_status()
            if 'application/json' in r.headers.get('content-type',''):
                return {"status":"ok","json": r.json()}
            return {"status":"ok","text": r.text}
        except Exception as e:
            return {"status":"error","error": str(e)}
`
  },
  {
    id: "zapier_webhook",
    name: "Zapier Webhook",
    description: "Send a JSON payload to a Zapier Catch Hook.",
    fields: [
      { key: "ZAPIER_HOOK_URL", label: "Zapier Hook URL", placeholder: "https://hooks.zapier.com/hooks/catch/..." },
      { key: "AUTH_HEADER", label: "Auth Header (optional)", placeholder: "Bearer xxxxx" },
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
    def zapier_trigger(payload: dict, ctx: Context | None = None) -> dict:
        """Send a JSON payload to Zapier catch hook and return response."""
        url = os.getenv("ZAPIER_HOOK_URL", "").strip() or "${(args.ZAPIER_HOOK_URL ?? '').replace(/"/g, '\\"')}"
        if not url: return {"status":"error","error":"ZAPIER_HOOK_URL not set"}
        headers={"Content-Type":"application/json"}
        auth = (os.getenv("AUTH_HEADER", "").strip() or "${(args.AUTH_HEADER ?? '').replace(/"/g, '\\"')}")
        if auth: headers["Authorization"] = auth
        try:
            r = requests.post(url, json=payload, headers=headers, timeout=60)
            r.raise_for_status()
            return {"status":"ok","result": r.json() if 'application/json' in r.headers.get('content-type','') else r.text}
        except Exception as e:
            return {"status":"error","error": str(e)}
`
  },
  {
    id: "supabase_db_read",
    name: "Supabase: Database Read",
    description: "Run a read-only SQL query on a Supabase Postgres database.",
    fields: [
      { key: "SUPABASE_DB_URL", label: "Database URL", placeholder: "postgresql://..." },
      { key: "SUPABASE_SERVICE_ROLE", label: "Service Role (optional)", placeholder: "service_role_key" },
      { key: "SQL", label: "SQL (default)", placeholder: "SELECT 1" },
    ],
    code: (args) => `from __future__ import annotations

import os
import psycopg2
import psycopg2.extras
try:
    from mcp.server.fastmcp import Context  # type: ignore
except Exception:
    class Context:  # type: ignore
        pass

def register(mcp):
    @mcp.tool()
    def supabase_db_read(sql: str | None = None, ctx: Context | None = None) -> dict:
        """Execute a read-only SQL query against Supabase Postgres and return rows.

        Args:
          sql: SQL to execute (SELECT only). If omitted, defaults to provided template.
        """
        url = os.getenv("SUPABASE_DB_URL", "").strip() or "${(args.SUPABASE_DB_URL ?? '').replace(/"/g, '\\"')}"
        if not url:
            return {"status": "error", "error": "SUPABASE_DB_URL is required"}
        q = (sql or "${((args.SQL ?? 'SELECT 1').replace(/`/g,'').replace(/\n/g,' '))}").strip()
        if not q.lower().startswith("select"):
            return {"status": "error", "error": "Only read-only SELECT queries are allowed"}
        try:
            conn = psycopg2.connect(url, cursor_factory=psycopg2.extras.DictCursor)
            with conn.cursor() as cur:
                cur.execute(q)
                rows = [dict(r) for r in cur.fetchall()]
            conn.close()
            return {"status": "ok", "rows": rows}
        except Exception as e:
            return {"status": "error", "error": str(e)}
`
  },
];

export function ToolModal({ open, onOpenChange, tool }: ToolModalProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [mode, setMode] = useState<"view" | "catalog" | "ai">(tool ? "view" : "catalog");
  const [name, setName] = useState(tool?.name || "");
  const [description, setDescription] = useState(tool?.description || "");
  const [module, setModule] = useState(tool?.module || "gasable_hub.tools");
  const [code, setCode] = useState<string>("");
  const [requiredKeys, setRequiredKeys] = useState<string[]>([]);
  const [aiPrompt, setAiPrompt] = useState<string>("");
  const [aiDraft, setAiDraft] = useState<{ summary: string; required_keys: string[]; code: string; docs?: Array<{ title: string; body: string }> } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
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

  useEffect(() => {
    // Heuristic: if name/description mentions supabase, switch template
    const s = `${name} ${description}`.toLowerCase();
    if (s.includes("supabase")) setSelectedTemplate("supabase_db_read");
  }, [name, description]);

  const createTool = useMutation({
    mutationFn: async () => {
      const payload: any = {
        name: name.trim(),
        description: description.trim(),
        module: module.trim() || "gasable_hub.tools",
        code: (code || (selected ? selected.code(templateValues) : (aiDraft?.code || ""))).trim(),
        required_keys: requiredKeys.length ? requiredKeys : (aiDraft?.required_keys || []),
      };
      if (!payload.name || !payload.code) throw new Error("Name and code are required");
      return api.createTool(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tools"] });
      toast({ title: "Tool created", description: `${name} is ready to use` });
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Failed to create tool", description: msg, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full sm:max-w-[95vw] md:max-w-2xl lg:max-w-3xl max-h-[85vh] overflow-y-auto">
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
                <Textarea rows={4} value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} placeholder="e.g., Read and write to Supabase database with safe, parameterized SQL" />
                <div className="flex gap-2">
                  <Button type="button" variant="default" disabled={aiLoading || !aiPrompt.trim()} onClick={async () => {
                    setAiLoading(true);
                    try {
                      // Call backend LLM draft endpoint for a proper plan and code
                      const res = await api.draftTool(aiPrompt.trim());
                      const summary = String(res.summary || "Tool draft");
                      const req = Array.isArray(res.required_keys) ? res.required_keys as string[] : [];
                      const codeResp = String(res.code || "");
                      setAiDraft({ summary, required_keys: req, code: codeResp, docs: Array.isArray(res.docs) ? res.docs : [] });
                      setRequiredKeys(req);
                      if (!code) setCode(codeResp);
                      toast({ title: "Draft ready", description: "Review the proposed tool and edit as needed." });
                    } catch (e) {
                      // Fallback to heuristic templates
                      const wantsSupabase = /supabase|postgres/i.test(aiPrompt);
                      const inferredKeys = wantsSupabase ? ["SUPABASE_DB_URL", "SUPABASE_SERVICE_ROLE"] : [];
                      const candidate = selected ? selected.code(templateValues) : code;
                      const draftCode = (candidate && candidate.trim()) || (wantsSupabase ? TOOL_TEMPLATES.find(t => t.id === "supabase_db_read")?.code({ SUPABASE_DB_URL: "", SUPABASE_SERVICE_ROLE: "", SQL: "SELECT 1" }) || "" : "");
                      setAiDraft({ summary: "Draft generated based on your description.", required_keys: inferredKeys, code: draftCode });
                      setRequiredKeys(inferredKeys);
                      toast({ title: "AI draft fallback used", description: "Backend LLM unavailable; used a template.", variant: "destructive" });
                    } finally {
                      setAiLoading(false);
                    }
                  }}>Draft</Button>
                </div>
                {aiLoading && (<div className="text-xs text-gray-500">Analyzing your request and preparing a draft...</div>)}
                {aiDraft && (
                  <div className="space-y-2 border rounded p-3 bg-gray-50">
                    <div className="text-sm font-medium">Proposed Tool</div>
                    <div className="text-xs text-gray-700">{aiDraft.summary}</div>
                    {aiDraft.docs && aiDraft.docs.length > 0 && (
                      <div className="mt-2 space-y-1">
                        <div className="text-xs font-semibold">Documentation</div>
                        {aiDraft.docs.map((d, i) => (
                          <div key={i} className="text-xs text-gray-600">
                            <span className="font-medium">{d.title}:</span> {d.body}
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="text-xs mt-2">
                      <div className="font-semibold">Required Keys (optional to set now)</div>
                      <div className="flex flex-wrap gap-2 mt-1">
                        {(requiredKeys.length ? requiredKeys : aiDraft.required_keys).map(k => (
                          <span key={k} className="inline-flex items-center gap-1 bg-yellow-50 border border-yellow-200 px-2 py-1 rounded text-xs">
                            {k}
                          </span>
                        ))}
                      </div>
                      <div className="text-gray-500 mt-1">You can set these later under API Keys; leave blank to use environment or defaults.</div>
                    </div>
                    <div className="space-y-2 mt-2">
                      <Label>Generated Code (editable)</Label>
                      <Textarea rows={10} value={code || aiDraft.code} onChange={(e) => setCode(e.target.value)} />
                    </div>
                    <div className="space-y-2 mt-2">
                      <Label>Provide Keys (optional)</Label>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {(requiredKeys.length ? requiredKeys : aiDraft.required_keys).map(k => (
                          <div key={k} className="space-y-1">
                            <Label className="text-xs">{k}</Label>
                            <Input placeholder={`Enter ${k}`} onChange={(e) => {
                              setTemplateValues({ ...templateValues, [k]: e.target.value });
                            }} />
                          </div>
                        ))}
                      </div>
                      <div className="text-xs text-gray-500">Values are optional. Tools read from environment if not provided.</div>
                    </div>
                  </div>
                )}
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


export default ToolModal;
