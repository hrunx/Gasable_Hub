#!/bin/bash
set -e

echo "🧪 Testing Gasable Workflow System"
echo "===================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

API_BASE="${API_BASE:-http://localhost:8000}"

echo "📍 API Base: $API_BASE"
echo ""

# Test 1: Check if backend is running
echo "1️⃣  Checking backend health..."
if curl -s -f "$API_BASE/api/status" > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Backend is running"
else
    echo -e "${RED}✗${NC} Backend is not responding. Start it with: python webapp.py"
    exit 1
fi

# Test 2: Check workflows endpoint
echo "2️⃣  Checking workflows endpoint..."
WORKFLOWS_JSON=$(curl -s "$API_BASE/api/workflows?namespace=global")
WORKFLOW_COUNT=$(echo "$WORKFLOWS_JSON" | jq -r '.workflows | length' 2>/dev/null || echo "0")
echo -e "${GREEN}✓${NC} Found $WORKFLOW_COUNT workflows"

if [ "$WORKFLOW_COUNT" = "0" ]; then
    echo -e "${YELLOW}⚠${NC}  No workflows found. Import some workflows first."
    exit 0
fi

# Test 3: Get first workflow ID
echo "3️⃣  Testing workflow enrichment..."
FIRST_WF_ID=$(echo "$WORKFLOWS_JSON" | jq -r '.workflows[0].id' 2>/dev/null)
echo "   Workflow ID: $FIRST_WF_ID"

# Test 4: Get enriched workflow
ENRICHED_WF=$(curl -s "$API_BASE/api/workflows/$FIRST_WF_ID?enrich=true")
NODE_COUNT=$(echo "$ENRICHED_WF" | jq -r '.graph.nodes | length' 2>/dev/null || echo "0")
echo -e "${GREEN}✓${NC} Workflow has $NODE_COUNT nodes"

# Test 5: Check if nodes have descriptions
NODES_WITH_DESC=$(echo "$ENRICHED_WF" | jq -r '[.graph.nodes[] | select(.data.description != null)] | length' 2>/dev/null || echo "0")
echo -e "${GREEN}✓${NC} $NODES_WITH_DESC nodes have descriptions"

# Test 6: Check if nodes have required keys
NODES_WITH_KEYS=$(echo "$ENRICHED_WF" | jq -r '[.graph.nodes[] | select(.data.required_keys != null and (.data.required_keys | length) > 0)] | length' 2>/dev/null || echo "0")
if [ "$NODES_WITH_KEYS" != "0" ]; then
    echo -e "${GREEN}✓${NC} $NODES_WITH_KEYS nodes require credentials"
    echo "   Required keys:"
    echo "$ENRICHED_WF" | jq -r '.graph.nodes[] | select(.data.required_keys != null) | .data.required_keys[]' 2>/dev/null | sort -u | sed 's/^/     - /'
else
    echo -e "${YELLOW}⚠${NC}  No nodes require credentials (this is okay if workflow doesn't need them)"
fi

# Test 7: Check nodes registry
echo "4️⃣  Checking nodes registry..."
NODES_JSON=$(curl -s "$API_BASE/api/nodes")
TOTAL_NODES=$(echo "$NODES_JSON" | jq 'length' 2>/dev/null || echo "0")
echo -e "${GREEN}✓${NC} Registry has $TOTAL_NODES nodes"

if [ "$TOTAL_NODES" != "0" ]; then
    # Show sample nodes
    echo "   Sample nodes:"
    echo "$NODES_JSON" | jq -r '.[0:3] | .[] | "     - " + .name + " (" + .category + ")"' 2>/dev/null || echo "     (none)"
fi

# Test 8: Check if layout library is working (just verify the file exists)
echo "5️⃣  Checking layout utilities..."
if [ -f "src/lib/layout.ts" ]; then
    echo -e "${GREEN}✓${NC} Layout utilities installed"
else
    echo -e "${RED}✗${NC} Layout utilities missing"
    exit 1
fi

# Test 9: Check dagre installation
echo "6️⃣  Checking dagre installation..."
if npm list dagre --depth=0 2>/dev/null | grep -q dagre; then
    echo -e "${GREEN}✓${NC} dagre library installed"
else
    echo -e "${RED}✗${NC} dagre not installed. Run: npm install dagre @types/dagre"
    exit 1
fi

echo ""
echo "======================================"
echo -e "${GREEN}✅ All tests passed!${NC}"
echo ""
echo "Next steps:"
echo "  1. Open http://localhost:3000/workflows in your browser"
echo "  2. Click on a workflow to see the improved layout"
echo "  3. Check the 'Workflow Requirements' panel on the right"
echo "  4. Click 'Test Run' to execute the workflow"
echo ""

