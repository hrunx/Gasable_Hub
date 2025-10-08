"use client";

import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { WorkflowTemplate } from "@/lib/workflow-templates";
import { api } from "@/lib/api";
import { FileText, Zap } from "lucide-react";

interface TemplateSelectorProps {
  open: boolean;
  onClose: () => void;
  onSelect: (template: WorkflowTemplate) => void;
}

export function TemplateSelector({ open, onClose, onSelect }: TemplateSelectorProps) {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; description: string; category: string }>>([]);
  const [detailsCache, setDetailsCache] = useState<Record<string, WorkflowTemplate>>({});
  const [loadingList, setLoadingList] = useState(false);
  const [loadingSlug, setLoadingSlug] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoadingList(true);
      setErrorMsg(null);
      try {
        const rows = await api.listTemplates({ limit: 100 });
        if (cancelled) return;
        setTemplates(
          Array.isArray(rows)
            ? rows.map((r: any) => ({
                id: r.slug,
                name: r.name,
                description: r.description || "",
                category: r.category || "General",
              }))
            : []
        );
      } catch (err) {
        if (!cancelled) {
          setTemplates([]);
          setErrorMsg(err instanceof Error ? err.message : "Failed to load templates");
        }
      } finally {
        if (!cancelled) {
          setLoadingList(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setSelectedSlug(null);
      setLoadingSlug(null);
    }
  }, [open]);

  const selectedTemplate: WorkflowTemplate | null = useMemo(() => {
    if (!selectedSlug) return null;
    return detailsCache[selectedSlug] ?? null;
  }, [selectedSlug, detailsCache]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const tpl of templates) {
      cats.add(tpl.category);
    }
    return Array.from(cats);
  }, [templates]);

  const ensureTemplateDetails = async (slug: string) => {
    if (detailsCache[slug]) {
      return detailsCache[slug];
    }
    setLoadingSlug(slug);
    try {
      const full = await api.getTemplate(slug);
      const graph = full?.graph || {};
      const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
      const edges = Array.isArray(graph?.edges) ? graph.edges : [];
      const template: WorkflowTemplate = {
        id: slug,
        name: full?.name || slug,
        description: full?.description || "",
        category: full?.category || "General",
        nodes,
        edges,
      };
      setDetailsCache((prev) => ({ ...prev, [slug]: template }));
      return template;
    } catch (error) {
      const template = templates.find((t) => t.id === slug);
      const fallback: WorkflowTemplate = {
        id: slug,
        name: template?.name || slug,
        description: template?.description || "",
        category: template?.category || "General",
        nodes: [],
        edges: [],
      };
      setDetailsCache((prev) => ({ ...prev, [slug]: fallback }));
      return fallback;
    } finally {
      setLoadingSlug((prev) => (prev === slug ? null : prev));
    }
  };

  const handleSelect = () => {
    if (selectedSlug) {
      const cached = detailsCache[selectedSlug];
      if (cached) {
        onSelect(cached);
        onClose();
        setSelectedSlug(null);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Choose a Workflow Template</DialogTitle>
          <DialogDescription>
            Start with a pre-built workflow and customize it to your needs
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {loadingList && <div className="text-sm text-gray-500">Loading templates…</div>}
          {errorMsg && <div className="text-sm text-red-600">{errorMsg}</div>}
          {categories.map((category) => (
            <div key={category}>
              <h3 className="text-sm font-semibold text-gray-700 mb-3">{category}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {templates
                  .filter((t) => t.category === category)
                  .map((template) => (
                    <Card
                      key={template.id}
                      className={`cursor-pointer transition-all hover:shadow-lg ${
                        selectedSlug === template.id
                          ? "ring-2 ring-blue-500"
                          : ""
                      }`}
                      onClick={async () => {
                        setSelectedSlug(template.id);
                        await ensureTemplateDetails(template.id);
                      }}
                    >
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Zap className="h-4 w-4 text-yellow-500" />
                          {template.name}
                        </CardTitle>
                        <CardDescription>{template.description}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="flex gap-2 text-xs text-gray-500">
                          <Badge variant="outline">
                            <FileText className="h-3 w-3 mr-1" />
                            {detailsCache[template.id]?.nodes.length ?? "—"} nodes
                          </Badge>
                          <Badge variant="outline">
                            {detailsCache[template.id]?.edges.length ?? "—"} connections
                          </Badge>
                          {loadingSlug === template.id && (
                            <Badge variant="secondary">Loading…</Badge>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSelect} disabled={!selectedTemplate}>
            Use Template
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
