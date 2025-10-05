import React from 'react'
import { createRoot } from 'react-dom/client'
import { WorkflowDesigner } from './workflow/WorkflowDesigner'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WorkflowDesigner />
  </React.StrictMode>
)
