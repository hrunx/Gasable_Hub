"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bot, Wrench, Workflow, Plus, Activity, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import Link from "next/link";
import { ChatInterface } from "@/components/chat/ChatInterface";
import { AgentModal } from "@/components/agents/AgentModal";

export default function Home() {
  const router = useRouter();
  const [agentModalOpen, setAgentModalOpen] = useState(false);
  const [selectedAgentForModal, setSelectedAgentForModal] = useState<{
    id: string;
    display_name: string;
    namespace: string;
    system_prompt: string;
    tool_allowlist: string[];
  } | null>(null);
  const [selectedChatAgent, setSelectedChatAgent] = useState<string | null>(null);

  const { data: agentsData } = useQuery({
    queryKey: ["agents"],
    queryFn: api.getAgents,
  });

  const { data: toolsData } = useQuery({
    queryKey: ["tools"],
    queryFn: api.getTools,
  });

  const { data: workflowsData } = useQuery({
    queryKey: ["workflows"],
    queryFn: api.getWorkflows,
  });

  const { data: statusData } = useQuery({
    queryKey: ["status"],
    queryFn: api.getStatus,
    refetchInterval: 5000,
  });

  const { data: connectionsData } = useQuery({
    queryKey: ["connections"],
    queryFn: api.getConnections,
    refetchInterval: 10000,
  });

  const agents = agentsData?.agents || [];
  const tools = toolsData?.tools || [];
  const workflows = workflowsData?.workflows || [];
  const connections = connectionsData?.connections || [];
  const isHealthy = statusData?.db?.status === "ok";

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Gasable Hub</h1>
            <p className="text-sm text-gray-500">Mission Control</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge 
              variant={isHealthy ? "default" : "destructive"}
              className={isHealthy ? "bg-green-500 hover:bg-green-600 text-white" : ""}
            >
              <Activity className="mr-1 h-3 w-3" />
              {isHealthy ? "✓ Online" : "⚠ Degraded"}
            </Badge>
            <Badge variant="outline" className="text-xs font-normal">
              {agents.length} Agents
            </Badge>
            <Badge variant="outline" className="text-xs font-normal">
              {tools.length} Tools
            </Badge>
            <Badge variant="outline" className="text-xs font-normal">
              {connections.length} Connections
            </Badge>
            <Link href="/workflows/new">
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                New Workflow
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Agents</CardTitle>
              <Bot className="h-4 w-4 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{agents.length}</div>
              <p className="text-xs text-gray-500">Active AI agents</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Tools</CardTitle>
              <Wrench className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{tools.length}</div>
              <p className="text-xs text-gray-500">MCP tools available</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Workflows</CardTitle>
              <Workflow className="h-4 w-4 text-purple-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{workflows.length}</div>
              <p className="text-xs text-gray-500">Configured workflows</p>
            </CardContent>
          </Card>
        </div>

        {/* Main Tabs */}
        <Tabs defaultValue="chat" className="space-y-4">
          <TabsList>
            <TabsTrigger value="chat">AI Chat</TabsTrigger>
            <TabsTrigger value="agents">Agents</TabsTrigger>
            <TabsTrigger value="tools">Tools</TabsTrigger>
            <TabsTrigger value="workflows">Workflows</TabsTrigger>
          </TabsList>

          <TabsContent value="chat" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <ChatInterface 
                  agents={agents}
                  selectedAgent={selectedChatAgent}
                />
              </div>
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Select Agent</CardTitle>
                    <p className="text-xs text-gray-500 mt-1">
                      Choose how you want to chat
                    </p>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {/* Multi-Agent Orchestrator Option */}
                      <button
                        onClick={() => setSelectedChatAgent(null)}
                        className={`w-full flex items-center gap-2 text-sm p-3 rounded transition-colors ${
                          selectedChatAgent === null
                            ? "bg-purple-100 border-2 border-purple-500 text-purple-900"
                            : "bg-gray-50 hover:bg-purple-50 border border-transparent hover:border-purple-200"
                        }`}
                      >
                        <Sparkles className="h-4 w-4 text-purple-600" />
                        <div className="text-left flex-1">
                          <div className="font-semibold">Multi-Agent (Orchestrator)</div>
                          <div className="text-xs opacity-70">AI routes to best agent</div>
                        </div>
                        {selectedChatAgent === null && (
                          <Badge variant="default" className="text-xs">Active</Badge>
                        )}
                      </button>

                      {/* Individual Agents */}
                      <div className="pt-2 border-t">
                        <div className="text-xs font-semibold text-gray-500 mb-2">Direct Agent Chat</div>
                        {agents.map((agent: { id: string; display_name: string; namespace: string; tool_allowlist: string[] }) => (
                          <button
                            key={agent.id}
                            onClick={() => setSelectedChatAgent(agent.id)}
                            className={`w-full flex items-center gap-2 text-sm p-2 mb-1 rounded transition-colors ${
                              selectedChatAgent === agent.id
                                ? "bg-blue-100 border-2 border-blue-500 text-blue-900"
                                : "bg-gray-50 hover:bg-blue-50 border border-transparent hover:border-blue-200"
                            }`}
                          >
                            <Bot className="h-4 w-4 text-blue-600" />
                            <span className="font-medium flex-1 text-left">{agent.display_name}</span>
                            {selectedChatAgent === agent.id && (
                              <Badge variant="outline" className="text-xs">Active</Badge>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Quick Actions</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Button 
                      variant="outline" 
                      className="w-full justify-start"
              onClick={() => {
                setSelectedAgentForModal(null);
                setAgentModalOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Create Agent
            </Button>
                    <Link href="/workflows/new" className="block">
                      <Button variant="outline" className="w-full justify-start">
                        <Workflow className="mr-2 h-4 w-4" />
                        New Workflow
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="agents" className="space-y-4">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">AI Agents</h2>
              <Button 
                size="sm"
                onClick={() => {
                  setSelectedAgentForModal(null);
                  setAgentModalOpen(true);
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                New Agent
              </Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {agents.map((agent: { id: string; display_name: string; namespace: string; tool_allowlist: string[]; system_prompt?: string }) => (
                <Card 
                  key={agent.id}
                  className="cursor-pointer hover:shadow-lg transition-shadow"
                  onClick={() => {
                    setSelectedAgentForModal({
                      ...agent,
                      system_prompt: agent.system_prompt || ""
                    });
                    setAgentModalOpen(true);
                  }}
                >
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Bot className="h-5 w-5 text-blue-600" />
                      {agent.display_name}
                    </CardTitle>
                    <CardDescription>ID: {agent.id}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div>
                        <span className="text-sm font-medium">Namespace:</span>
                        <Badge variant="outline" className="ml-2">{agent.namespace}</Badge>
                      </div>
                      <div>
                        <span className="text-sm font-medium">Tools:</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {(agent.tool_allowlist || []).map((tool: string) => (
                            <Badge key={tool} variant="secondary" className="text-xs">
                              {tool}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="tools" className="space-y-4">
            <h2 className="text-xl font-semibold mb-4">MCP Tools</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {tools.map((tool: { name: string; description?: string; module?: string }) => (
                <Card key={tool.name}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Wrench className="h-4 w-4 text-green-600" />
                      {tool.name}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-gray-600">
                      {tool.description || "No description available"}
                    </p>
                    <div className="mt-2">
                      <Badge variant="outline" className="text-xs">{tool.module || "core"}</Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="workflows" className="space-y-4">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">Workflows</h2>
              <Link href="/workflows/new">
                <Button size="sm">
                  <Plus className="mr-2 h-4 w-4" />
                  Create Workflow
                </Button>
              </Link>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {workflows.length === 0 ? (
                <Card className="col-span-2">
                  <CardContent className="py-12 text-center">
                    <Workflow className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                    <h3 className="text-lg font-medium mb-2">No workflows yet</h3>
                    <p className="text-gray-500 mb-4">Create your first workflow to get started</p>
                    <Link href="/workflows/new">
                      <Button>
                        <Plus className="mr-2 h-4 w-4" />
                        Create Workflow
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              ) : (
                workflows.map((workflow: { id: string; display_name: string; namespace: string }) => (
                  <Card key={workflow.id} className="cursor-pointer hover:shadow-lg transition-shadow"
                    onClick={() => router.push(`/workflows/${workflow.id}`)}>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Workflow className="h-5 w-5 text-purple-600" />
                        {workflow.display_name}
                      </CardTitle>
                      <CardDescription>{workflow.namespace}</CardDescription>
                    </CardHeader>
                  </Card>
                ))
              )}
            </div>
          </TabsContent>
        </Tabs>

        {/* Agent Modal */}
        <AgentModal
          open={agentModalOpen}
          onOpenChange={setAgentModalOpen}
          agent={selectedAgentForModal}
        />
      </div>
    </div>
  );
}
