# Gasable Hub - Modern Dashboard

A next-generation workflow orchestration platform built with React, TypeScript, and React Flow. This replaces the legacy HTML dashboard with a modern, n8n-style drag-and-drop interface.

## 🚀 Features

- **Visual Workflow Builder**: Drag-and-drop interface powered by React Flow
- **Custom Nodes**: Agent, Tool, Decision, and Start nodes
- **Real-time Auto-save**: Workflows save automatically as you build
- **Agent Management**: Create and manage AI agents with tool permissions
- **MCP Tools Integration**: Browse and use all available MCP tools
- **Modern UI**: Built with shadcn/ui + Tailwind CSS
- **Type-Safe**: Full TypeScript support

## 📦 Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Graph Editor**: React Flow (@xyflow/react)
- **UI Components**: shadcn/ui + Tailwind CSS
- **State Management**: TanStack Query (React Query)
- **Form Validation**: Zod
- **Icons**: Lucide React

## 🛠️ Setup

### Prerequisites

- Node.js 18+ (included with your system)
- Running backend API at `http://localhost:8000` (gasable_mcp webapp.py)

### Installation

```bash
cd gasable-ui
npm install
```

### Environment Variables

Create `.env.local`:

```bash
NEXT_PUBLIC_API_URL=http://localhost:8000
```

### Development

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000)

### Production Build

```bash
npm run build
npm start
```

## 📁 Project Structure

```
gasable-ui/
├── src/
│   ├── app/                    # Next.js App Router pages
│   │   ├── page.tsx           # Dashboard home (agents/tools/workflows)
│   │   ├── workflows/
│   │   │   └── [id]/page.tsx # Workflow canvas editor
│   │   ├── layout.tsx         # Root layout
│   │   └── providers.tsx      # React Query provider
│   ├── components/
│   │   ├── ui/                # shadcn components (button, card, etc.)
│   │   └── workflow/
│   │       ├── WorkflowCanvas.tsx    # Main React Flow canvas
│   │       ├── NodeSidebar.tsx       # Node palette
│   │       └── nodes/                # Custom node components
│   │           ├── AgentNode.tsx
│   │           ├── ToolNode.tsx
│   │           ├── DecisionNode.tsx
│   │           └── StartNode.tsx
│   └── lib/
│       ├── api.ts             # API client functions
│       └── utils.ts           # Utility functions
├── public/                    # Static assets
├── package.json
├── tsconfig.json
├── tailwind.config.ts
└── .env.local                # Environment variables
```

## 🎨 Key Components

### Dashboard (/)

- Overview cards showing agent, tool, and workflow counts
- Tabbed interface for browsing:
  - **Agents**: View all AI agents with their tools and capabilities
  - **Tools**: Browse MCP tools available for workflows
  - **Workflows**: List and create workflows

### Workflow Builder (/workflows/new or /workflows/[id])

- Visual canvas with drag-and-drop nodes
- Node types:
  - **Start Node**: Entry point for workflows
  - **Agent Node**: AI agent execution with configurable prompts
  - **Tool Node**: MCP tool invocation
  - **Decision Node**: Conditional routing
- Auto-save functionality
- Mini-map for navigation
- Zoom controls

## 🔌 API Integration

The dashboard connects to the FastAPI backend at `localhost:8000`:

- `GET /api/agents` - List agents
- `POST /api/agents` - Create/update agent
- `GET /api/workflows` - List workflows
- `GET /api/workflows/:id` - Get workflow
- `POST /api/workflows` - Save workflow
- `GET /api/mcp_tools` - List MCP tools
- `GET /api/status` - System status

## 🎯 Usage

### Creating a Workflow

1. Navigate to the dashboard
2. Click "New Workflow" or go to `/workflows/new`
3. Drag nodes from the sidebar onto the canvas
4. Connect nodes by dragging from handles
5. The workflow auto-saves as you build

### Managing Agents

1. Go to the "Agents" tab
2. View existing agents and their tool permissions
3. Click "New Agent" to create (coming soon)

## 🚀 Next Steps

- [ ] Implement agent creation/editing form
- [ ] Add workflow execution/testing
- [ ] Real-time collaboration with Y.js
- [ ] Workflow run history and logs
- [ ] Advanced node configuration panels
- [ ] Export/import workflows
- [ ] Workflow templates

## 📝 Contributing

This is a production-ready foundation. To extend:

1. Add new node types in `src/components/workflow/nodes/`
2. Register them in `WorkflowCanvas.tsx` nodeTypes
3. Implement execution logic in the backend orchestrator
4. Add UI forms for node configuration

## 🐛 Troubleshooting

**Dashboard shows 0 agents/tools:**
- Ensure backend API is running at `localhost:8000`
- Check API endpoints return data: `curl http://localhost:8000/api/agents`

**Workflow won't save:**
- Check browser console for errors
- Verify POST `/api/workflows` endpoint is accessible
- Ensure database connection is healthy

**Build errors:**
- Clear `.next` folder: `rm -rf .next`
- Reinstall dependencies: `rm -rf node_modules && npm install`
- Check TypeScript errors: `npm run build`

## 📚 Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [React Flow Documentation](https://reactflow.dev)
- [shadcn/ui Components](https://ui.shadcn.com)
- [TanStack Query](https://tanstack.com/query/latest)

## 📄 License

Part of the Gasable Hub project. See main repository for license details.
