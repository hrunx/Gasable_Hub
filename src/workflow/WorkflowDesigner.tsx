import React, { useEffect, useMemo, useState } from 'react'
import ReactFlow, { addEdge, Background, Controls, MiniMap, useEdgesState, useNodesState, Connection, Edge, Node } from 'reactflow'
import axios from 'axios'

export function WorkflowDesigner() {
  const [namespace, setNamespace] = useState('global')
  const [agents, setAgents] = useState<Array<{id:string; display_name:string}>>([])
  const [wfId, setWfId] = useState('default')
  const [wfName, setWfName] = useState('Default Workflow')

  const initialNodes = useMemo<Node[]>(() => ([
    { id: 'start', type: 'input', position: { x: 50, y: 50 }, data: { label: 'Start' } },
    { id: 'support', position: { x: 300, y: 50 }, data: { label: 'support' } },
    { id: 'procurement', position: { x: 300, y: 200 }, data: { label: 'procurement' } },
    { id: 'end', type: 'output', position: { x: 600, y: 125 }, data: { label: 'End' } },
  ]), [])
  const initialEdges = useMemo<Edge[]>(() => ([
    { id: 'e1', source: 'start', target: 'support' },
    { id: 'e2', source: 'support', target: 'procurement', label: 'if order intent' },
    { id: 'e3', source: 'support', target: 'end', label: 'otherwise' },
    { id: 'e4', source: 'procurement', target: 'end' },
  ]), [])

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  useEffect(() => {
    axios.get('/api/agents').then(({ data }) => {
      setAgents((data.agents || []).map((a:any)=>({ id:a.id, display_name:a.display_name || a.id })))
    }).catch(()=>{})
  }, [])

  const onConnect = (params: Connection) => setEdges((eds) => addEdge({ ...params }, eds))

  async function save() {
    const graph = { nodes, edges }
    await axios.post('/api/workflows', { id: wfId, display_name: wfName, namespace, graph })
    alert('Workflow saved')
  }

  return (
    <div style={{ height: '100vh', width: '100vw', display: 'grid', gridTemplateColumns: '280px 1fr' }}>
      <div style={{ padding: 12, borderRight: '1px solid #ccc' }}>
        <h3>Agents</h3>
        <ul>
          {agents.map(a => (
            <li key={a.id} style={{ fontFamily: 'monospace' }}>{a.id}</li>
          ))}
        </ul>
        <hr />
        <div style={{ display: 'grid', gap: 8 }}>
          <input value={wfId} onChange={e=>setWfId(e.target.value)} placeholder="workflow id" />
          <input value={wfName} onChange={e=>setWfName(e.target.value)} placeholder="display name" />
          <input value={namespace} onChange={e=>setNamespace(e.target.value)} placeholder="namespace" />
          <button onClick={save}>Save</button>
        </div>
      </div>
      <div>
        <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}>
          <MiniMap />
          <Controls />
          <Background />
        </ReactFlow>
      </div>
    </div>
  )
}
