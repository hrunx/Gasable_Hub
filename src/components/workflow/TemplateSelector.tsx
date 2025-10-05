"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { workflowTemplates, WorkflowTemplate } from "@/lib/workflow-templates";
import { FileText, Zap } from "lucide-react";

interface TemplateSelectorProps {
  open: boolean;
  onClose: () => void;
  onSelect: (template: WorkflowTemplate) => void;
}

export function TemplateSelector({ open, onClose, onSelect }: TemplateSelectorProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<WorkflowTemplate | null>(null);

  const handleSelect = () => {
    if (selectedTemplate) {
      onSelect(selectedTemplate);
      onClose();
      setSelectedTemplate(null);
    }
  };

  const categories = Array.from(new Set(workflowTemplates.map((t) => t.category)));

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
          {categories.map((category) => (
            <div key={category}>
              <h3 className="text-sm font-semibold text-gray-700 mb-3">{category}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {workflowTemplates
                  .filter((t) => t.category === category)
                  .map((template) => (
                    <Card
                      key={template.id}
                      className={`cursor-pointer transition-all hover:shadow-lg ${
                        selectedTemplate?.id === template.id
                          ? "ring-2 ring-blue-500"
                          : ""
                      }`}
                      onClick={() => setSelectedTemplate(template)}
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
                            {template.nodes.length} nodes
                          </Badge>
                          <Badge variant="outline">{template.edges.length} connections</Badge>
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

