import { Node, Edge } from "@xyflow/react";

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  nodes: Node[];
  edges: Edge[];
}

export const workflowTemplates: WorkflowTemplate[] = [
  {
    id: "customer-support",
    name: "Customer Support Flow",
    description: "Automated customer support with RAG search and agent routing",
    category: "Support",
    nodes: [
      {
        id: "start",
        type: "startNode",
        position: { x: 250, y: 50 },
        data: { label: "Customer Query" },
      },
      {
        id: "support-agent",
        type: "agentNode",
        position: { x: 200, y: 150 },
        data: {
          label: "Support Agent",
          agentId: "support",
          prompt: "{input}",
        },
      },
      {
        id: "decision",
        type: "decisionNode",
        position: { x: 200, y: 280 },
        data: {
          label: "Needs Escalation?",
          conditionType: "contains",
          conditionValue: "escalate",
        },
      },
      {
        id: "procurement",
        type: "agentNode",
        position: { x: 400, y: 380 },
        data: {
          label: "Procurement Agent",
          agentId: "procurement",
          prompt: "Handle order: {input}",
        },
      },
    ],
    edges: [
      { id: "e1", source: "start", target: "support-agent", animated: true },
      { id: "e2", source: "support-agent", target: "decision", animated: true },
      { id: "e3", source: "decision", target: "procurement", sourceHandle: "true", animated: true },
    ],
  },
  {
    id: "research-pipeline",
    name: "Research Pipeline",
    description: "Web research with content ingestion and synthesis",
    category: "Research",
    nodes: [
      {
        id: "start",
        type: "startNode",
        position: { x: 250, y: 50 },
        data: { label: "Research Topic" },
      },
      {
        id: "web-ingest",
        type: "toolNode",
        position: { x: 200, y: 150 },
        data: {
          label: "Ingest Web Content",
          toolName: "ingest_web",
          parameters: JSON.stringify({ max_results: 10 }),
        },
      },
      {
        id: "research-agent",
        type: "agentNode",
        position: { x: 200, y: 280 },
        data: {
          label: "Research Agent",
          agentId: "research",
          prompt: "Analyze and synthesize: {input}",
        },
      },
      {
        id: "rag-search",
        type: "toolNode",
        position: { x: 200, y: 410 },
        data: {
          label: "RAG Search",
          toolName: "rag_search_tool",
          parameters: JSON.stringify({ top_k: 15 }),
        },
      },
    ],
    edges: [
      { id: "e1", source: "start", target: "web-ingest", animated: true },
      { id: "e2", source: "web-ingest", target: "research-agent", animated: true },
      { id: "e3", source: "research-agent", target: "rag-search", animated: true },
    ],
  },
  {
    id: "marketing-campaign",
    name: "Marketing Campaign",
    description: "Content creation and email campaign automation",
    category: "Marketing",
    nodes: [
      {
        id: "start",
        type: "startNode",
        position: { x: 250, y: 50 },
        data: { label: "Campaign Brief" },
      },
      {
        id: "marketing-agent",
        type: "agentNode",
        position: { x: 200, y: 150 },
        data: {
          label: "Marketing Agent",
          agentId: "marketing",
          prompt: "Create campaign content: {input}",
        },
      },
      {
        id: "review-decision",
        type: "decisionNode",
        position: { x: 200, y: 280 },
        data: {
          label: "Content Approved?",
          conditionType: "contains",
          conditionValue: "approved",
        },
      },
      {
        id: "send-email",
        type: "toolNode",
        position: { x: 400, y: 380 },
        data: {
          label: "Send Email",
          toolName: "gmail.send",
          parameters: JSON.stringify({ subject: "Campaign Email" }),
        },
      },
    ],
    edges: [
      { id: "e1", source: "start", target: "marketing-agent", animated: true },
      { id: "e2", source: "marketing-agent", target: "review-decision", animated: true },
      { id: "e3", source: "review-decision", target: "send-email", sourceHandle: "true", animated: true },
    ],
  },
  {
    id: "document-processing",
    name: "Document Processing",
    description: "Ingest and analyze documents with RAG",
    category: "Data",
    nodes: [
      {
        id: "start",
        type: "startNode",
        position: { x: 250, y: 50 },
        data: { label: "Document Path" },
      },
      {
        id: "ingest-local",
        type: "toolNode",
        position: { x: 200, y: 150 },
        data: {
          label: "Ingest Documents",
          toolName: "ingest_local_tool",
          parameters: JSON.stringify({ path: "/docs" }),
        },
      },
      {
        id: "rag-search",
        type: "toolNode",
        position: { x: 200, y: 280 },
        data: {
          label: "Search Content",
          toolName: "rag_search_tool",
          parameters: JSON.stringify({ top_k: 12 }),
        },
      },
      {
        id: "support-agent",
        type: "agentNode",
        position: { x: 200, y: 410 },
        data: {
          label: "Analyze Results",
          agentId: "support",
          prompt: "Summarize findings: {input}",
        },
      },
    ],
    edges: [
      { id: "e1", source: "start", target: "ingest-local", animated: true },
      { id: "e2", source: "ingest-local", target: "rag-search", animated: true },
      { id: "e3", source: "rag-search", target: "support-agent", animated: true },
    ],
  },
  {
    id: "order-fulfillment",
    name: "Order Fulfillment",
    description: "Complete order processing with validation and placement",
    category: "E-commerce",
    nodes: [
      {
        id: "start",
        type: "startNode",
        position: { x: 250, y: 50 },
        data: { label: "Order Request" },
      },
      {
        id: "validate",
        type: "decisionNode",
        position: { x: 200, y: 150 },
        data: {
          label: "Valid Order?",
          conditionType: "contains",
          conditionValue: "valid",
        },
      },
      {
        id: "procurement",
        type: "agentNode",
        position: { x: 400, y: 250 },
        data: {
          label: "Procurement Agent",
          agentId: "procurement",
          prompt: "Process order: {input}",
        },
      },
      {
        id: "place-order",
        type: "toolNode",
        position: { x: 400, y: 380 },
        data: {
          label: "Place Order",
          toolName: "orders_place",
          parameters: JSON.stringify({}),
        },
      },
    ],
    edges: [
      { id: "e1", source: "start", target: "validate", animated: true },
      { id: "e2", source: "validate", target: "procurement", sourceHandle: "true", animated: true },
      { id: "e3", source: "procurement", target: "place-order", animated: true },
    ],
  },
];

