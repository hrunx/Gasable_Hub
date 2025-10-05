"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Send, Bot, User, Loader2, Sparkles } from "lucide-react";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  agent?: string;
  timestamp: Date;
}

interface Agent {
  id: string;
  display_name: string;
  namespace: string;
  tool_allowlist: string[];
}

interface ChatInterfaceProps {
  agents?: Agent[];
  selectedAgent?: string | null;
}

export function ChatInterface({ 
  agents = [], 
  selectedAgent: selectedAgentProp = null,
}: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const selectedAgent = selectedAgentProp; // Use prop for controlled component
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      role: "user",
      content: input,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    const messageContent = input;
    setInput("");
    setIsLoading(true);

    try {
      let response;
      let data;

      if (selectedAgent === null) {
        // Multi-Agent Mode: Use orchestrator to route to appropriate agent
        response = await fetch("http://localhost:8000/api/orchestrate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: "demo_user",
            message: messageContent,
            namespace: "global",
          }),
        });
        data = await response.json();
      } else {
        // Direct Agent Mode: Chat directly with selected agent
        response = await fetch("http://localhost:8000/api/orchestrate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: "demo_user",
            message: messageContent,
            namespace: "global",
            agent_preference: selectedAgent, // Force specific agent
          }),
        });
        data = await response.json();
      }

      const assistantMessage: Message = {
        role: "assistant",
        content: data.message || data.error || "Sorry, something went wrong.",
        agent: data.agent || selectedAgent,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch {
      const errorMessage: Message = {
        role: "assistant",
        content: "Failed to connect to the server. Please try again.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  // Clear messages when agent changes
  useEffect(() => {
    setMessages([]);
  }, [selectedAgent]);

  const getSelectedAgentName = () => {
    if (selectedAgent === null) return "Multi-Agent Orchestrator";
    const agent = agents.find((a) => a.id === selectedAgent);
    return agent?.display_name || selectedAgent;
  };

  return (
    <Card className="flex flex-col h-[600px]">
      {/* Header */}
      <div className="border-b p-4">
        <div className="flex items-center gap-2">
          {selectedAgent === null ? (
            <Sparkles className="h-5 w-5 text-purple-600" />
          ) : (
            <Bot className="h-5 w-5 text-blue-600" />
          )}
          <div className="flex-1">
            <h3 className="font-semibold">
              {getSelectedAgentName()}
            </h3>
            <p className="text-xs text-gray-500">
              {selectedAgent === null
                ? "AI will route to the best agent for your question"
                : "Chatting directly with this agent"}
            </p>
          </div>
          <Badge variant={selectedAgent === null ? "default" : "outline"}>
            {selectedAgent === null ? "Orchestrator" : "Direct"}
          </Badge>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 mt-8">
            {selectedAgent === null ? (
              <Sparkles className="h-12 w-12 mx-auto mb-2 opacity-50" />
            ) : (
              <Bot className="h-12 w-12 mx-auto mb-2 opacity-50" />
            )}
            <p>
              {selectedAgent === null
                ? "Ask anything - I'll route to the right agent"
                : `Chat with ${getSelectedAgentName()}`}
            </p>
            <p className="text-xs mt-2">
              {selectedAgent === null
                ? 'Try: "Research AI trends" or "Draft an email"'
                : "Ask questions specific to this agent's expertise"}
            </p>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex gap-3 ${
              msg.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            {msg.role === "assistant" && (
              <div className="flex-shrink-0">
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                  <Bot className="h-4 w-4 text-blue-600" />
                </div>
              </div>
            )}
            <div
              className={`max-w-[70%] rounded-lg p-3 ${
                msg.role === "user"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-900"
              }`}
            >
              {msg.agent && msg.role === "assistant" && (
                <div className="text-xs opacity-70 mb-1 flex items-center gap-1">
                  <Bot className="h-3 w-3" />
                  {msg.agent} agent
                </div>
              )}
              <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
              <div className="text-xs opacity-70 mt-1">
                {msg.timestamp.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            </div>
            {msg.role === "user" && (
              <div className="flex-shrink-0">
                <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
                  <User className="h-4 w-4 text-gray-600" />
                </div>
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
              <Bot className="h-4 w-4 text-blue-600" />
            </div>
            <div className="bg-gray-100 rounded-lg p-3">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t p-4">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === "Enter" && handleSend()}
            placeholder="Type your message..."
            disabled={isLoading}
          />
          <Button onClick={handleSend} disabled={isLoading || !input.trim()}>
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </Card>
  );
}

