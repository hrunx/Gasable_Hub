# Workflow UI Testing Guide

## Quick Start

### 1. Restart the Development Server
```bash
cd /Users/hrn/Desktop/gasable_mcp

# Stop any running servers
pkill -f "next dev" || true
pkill -f "python.*webapp.py" || true

# Start backend
python webapp.py &

# Start frontend (in another terminal)
npm run dev
```

### 2. Test Workflow Visualization

#### Access a Workflow
1. Navigate to `http://localhost:3000`
2. Click on "Workflows" or go to `/workflows`
3. Click on any workflow from your imported MCP workflows

#### What to Look For
✅ **Proper Layout**:
- Nodes should be arranged hierarchically (top to bottom)
- Connections should be clear and visible
- No overlapping nodes
- Proper spacing between nodes

✅ **Node Information Display**:
- Each tool node shows:
  - Node name/label
  - Tool name (in gray badge)
  - Category (in blue badge)
  - Description (2 lines max)
  - Required credentials (amber/yellow section)
  - Key icon if credentials needed
  - Auth provider information

✅ **Visual Quality**:
- Clean, professional appearance
- Smooth animations on edges
- Proper highlighting on selection
- Responsive layout

### 3. Test Credential Management

#### Trigger Credential Prompt
1. Open a workflow that requires API keys (e.g., Gmail, Notion, OpenAI workflows)
2. Click the "Test Run" button
3. If credentials are missing, you should see:
   - Toast notification: "Credentials Required: Please provide: [KEY_NAMES]"
   - Credential modal opens automatically

#### Credential Modal Features
✅ **Professional Design**:
- Large key icon header
- Clear title: "Credentials Required"
- Subtitle: "This workflow needs API keys to run"
- Individual labeled input fields for each key
- Security note at bottom
- Cancel and Save buttons

✅ **Functionality**:
- Type in password fields (hidden text)
- Validation on save (must provide at least one)
- Success toast: "Credentials Saved"
- Error toast if save fails
- Modal closes after successful save

#### Test Credential Storage
```bash
# Check if credentials were stored (backend must be running)
curl http://localhost:8000/api/keys
```

### 4. Test Workflow Execution

#### Run a Workflow
1. Open a workflow
2. Ensure all required credentials are provided
3. Click "Test Run"
4. Observe:
   - Loading spinner on button
   - Toast: "Test Run Started"
   - After completion: "Test Run Complete" or error message
   - Console log with execution results

#### Check Backend Logs
```bash
# Monitor backend logs
tail -f logs/gasable-hub.log

# Or if running in terminal, watch the output directly
```

### 5. Test Different Workflow Types

#### Simple Workflows
- Single tool execution
- Should show minimal layout

#### Complex Workflows
- Multiple connected nodes
- Branching/merging paths
- Should show clear hierarchical structure

#### Workflows Without Connections
- System should auto-generate simple chain
- Start → Node1 → Node2 → ...

### 6. Common Issues and Solutions

#### Issue: Nodes Still Scattered
**Possible Causes**:
- Nodes have valid positions in database (old data)
- Layout algorithm not triggered

**Solution**:
```sql
-- Reset node positions in database to trigger new layout
UPDATE public.gasable_workflows 
SET graph = jsonb_set(
  graph, 
  '{nodes}', 
  (
    SELECT jsonb_agg(
      jsonb_set(node, '{position}', '{"x":0,"y":0}'::jsonb)
    )
    FROM jsonb_array_elements(graph->'nodes') AS node
  )
);
```

#### Issue: No Node Descriptions Showing
**Possible Causes**:
- Node specs not in database
- Tool names don't match registry

**Check Node Registry**:
```sql
SELECT name, title, category, spec->>'doc' as description 
FROM public.nodes 
LIMIT 10;
```

**Verify Enrichment**:
```bash
# Test enriched endpoint directly
curl "http://localhost:8000/api/workflows/YOUR_WORKFLOW_ID?enrich=true" | jq '.graph.nodes[0].data'
```

#### Issue: Credential Modal Not Appearing
**Possible Causes**:
- Nodes don't have required_keys set
- Registry not inferring keys correctly

**Check Node Data**:
```sql
-- Check if nodes have auth info
SELECT spec->'auth' as auth_info 
FROM public.nodes 
WHERE name = 'YOUR_TOOL_NAME';
```

**Manual Test**:
- Open browser console
- Check `requiredTools` state
- Should see array of tools with required_keys

### 7. Browser Console Debugging

#### Useful Console Commands
```javascript
// Check current workflow state
window.localStorage.getItem('workflow-state')

// Check node data
document.querySelectorAll('[data-id]').forEach(el => {
  console.log(el.dataset.id, el.textContent)
})

// Monitor network requests
// Open DevTools → Network tab → Filter by "workflows"
```

### 8. Visual Regression Testing

#### Before/After Comparison
**Before** (Grid Layout):
```
[Start]  [Node1]  [Node2]
[Node3]  [Node4]  [Node5]
```

**After** (Hierarchical Layout):
```
    [Start]
       ↓
    [Node1]
    ↙   ↘
[Node2] [Node3]
    ↘   ↙
    [Node4]
```

### 9. Performance Testing

#### Large Workflows
1. Create/import workflow with 20+ nodes
2. Verify:
   - Layout completes in < 2 seconds
   - No UI freezing
   - Smooth interactions

#### Check Layout Performance
```javascript
// In browser console
console.time('layout');
// Trigger re-layout (zoom/pan/reload)
console.timeEnd('layout');
// Should be < 500ms
```

### 10. Mobile/Responsive Testing

#### Test on Different Screens
- Desktop: Full layout visible
- Tablet: Side panel collapsible
- Mobile: Single column layout

#### Browser Zoom
- Test at 50%, 100%, 150%, 200% zoom
- Nodes should remain readable
- Connections should scale properly

## Expected Results Summary

### ✅ Successful Implementation
- [x] Nodes arranged in hierarchical flow
- [x] All node information visible
- [x] Credential prompts work correctly
- [x] Workflow execution with validation
- [x] Professional n8n-like appearance
- [x] Smooth animations and interactions
- [x] No console errors
- [x] No linting errors

### 📊 Performance Metrics
- Layout calculation: < 500ms
- Page load: < 2s
- Smooth 60fps animations
- No memory leaks

### 🎨 Visual Quality
- Clean, modern design
- Consistent spacing
- Proper typography
- Good color contrast
- Professional badges and icons

## Next Steps After Testing

### If Everything Works
1. Commit changes with comprehensive message
2. Deploy to staging environment
3. User acceptance testing
4. Production deployment

### If Issues Found
1. Note specific failing scenarios
2. Check browser console for errors
3. Verify backend logs
4. Check network requests in DevTools
5. File detailed bug report

## Support

### Get Help
- Check `WORKFLOW_UI_IMPROVEMENTS.md` for technical details
- Review code comments in modified files
- Check backend logs for API errors
- Use browser DevTools for frontend debugging

### Key Files to Check
- `/src/app/workflows/[id]/page.tsx` - Main workflow page
- `/src/components/workflow/nodes/ToolNode.tsx` - Node display
- `/src/lib/layout.ts` - Layout algorithm
- `/webapp.py` - Backend enrichment logic
- `/gasable_nodes/registry.py` - Node registry

---

**Last Updated**: October 8, 2025
**Status**: ✅ Ready for Testing

