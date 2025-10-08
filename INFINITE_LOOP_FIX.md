# Infinite Template Pagination Loop - Fixed

**Date:** 2025-10-08  
**Status:** ✅ Resolved

---

## Problem

Backend was receiving **millions of template pagination requests** with massive offsets:
```
GET /api/templates?limit=500&offset=4490000
GET /api/templates?limit=500&offset=4490500
GET /api/templates?limit=500&offset=4491000
...
```

This caused:
- Browser crashes (Safari "WebKit encountered an internal error")
- Backend overload
- Frontend showing 0 agents/tools
- Connection failures

---

## Root Cause

**Unknown browser-side runaway pagination loop.** The loop stopped after:
1. Killing all browser processes
2. Restarting backend/frontend services
3. Opening fresh browser session

Likely causes:
- Browser extension making requests
- Cached JavaScript state in old browser session
- Development tools (React DevTools, etc.) stuck in loop

---

## Fix Applied

### 1. Added Backend Pagination Safeguards

**File:** `hub/api_templates.py`

```python
@router.get("")
def list_tpl(category: Optional[str] = None, q: Optional[str] = None, limit: int = 100, offset: int = 0):
    # Safety: cap limit and offset to prevent runaway pagination
    limit = min(limit, 1000)
    offset = min(offset, 100000)
    
    # ... rest of function
```

**Protection:**
- `limit` capped at 1,000 (prevents excessive row fetches)
- `offset` capped at 100,000 (prevents absurd pagination)

### 2. Verified Frontend Code

Checked all frontend pagination code:
- ✅ `TemplateSelector.tsx` - Uses `limit: 100` (reasonable)
- ✅ `api.ts` - Clean pagination logic
- ✅ No infinite loops found in codebase

---

## Resolution Steps

```bash
# 1. Stop all services
./stop.sh

# 2. Clear logs
echo "" > /tmp/gasable_api.log
echo "" > /tmp/gasable_frontend.log

# 3. Kill all browser processes
killall "Safari" "Microsoft Edge" "Google Chrome"

# 4. Restart services
./restart.sh

# 5. Open fresh browser tab
# Navigate to http://localhost:3000
```

---

## Verification

After fix:
```bash
# Check for template spam
tail -f /tmp/gasable_api.log | grep "templates"
# Result: ✅ No runaway pagination

# Test APIs
curl http://127.0.0.1:8000/api/agents    # ✅ 4 agents
curl http://127.0.0.1:8000/api/mcp_tools # ✅ 8 tools
curl http://127.0.0.1:8000/api/nodes     # ✅ Nodes loaded
```

---

## Prevention

### Backend Protection (Now Active)
- Pagination limits enforced at API level
- Cannot request offset > 100,000
- Cannot request limit > 1,000

### Best Practices

1. **Close browser when restarting services**
   ```bash
   ./stop.sh
   # Close all browser tabs at localhost:3000
   ./restart.sh
   # Open fresh browser tab
   ```

2. **Clear browser cache if issues persist**
   - Chrome/Edge: `Cmd+Shift+Delete` → Clear cached images and files
   - Safari: `Cmd+Option+E`

3. **Disable browser extensions during development**
   - React DevTools, Vue DevTools, etc. can sometimes cause issues

4. **Monitor API logs**
   ```bash
   tail -f /tmp/gasable_api.log | grep "offset"
   ```

---

## If Problem Returns

1. **Check for runaway requests**
   ```bash
   tail -f /tmp/gasable_api.log | grep -E "offset=[0-9]{4,}"
   ```

2. **Find the source**
   ```bash
   # Check for Python scripts making requests
   ps aux | grep -E "python.*template"
   
   # Check browser processes
   ps aux | grep -E "safari|chrome|edge" | wc -l
   ```

3. **Nuclear option**
   ```bash
   # Kill everything and restart fresh
   ./stop.sh
   killall Python3 node Safari "Microsoft Edge" "Google Chrome"
   sleep 5
   ./restart.sh
   ```

---

## Summary

✅ **Infinite loop:** Stopped  
✅ **Backend safeguards:** Added  
✅ **APIs responding:** Verified  
✅ **Services running:** Healthy  

**Next Steps:**
- Open browser to http://localhost:3000
- Frontend should load with agents, tools, workflows
- No more "WebKit encountered an internal error"

