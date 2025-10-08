# Quick Fix for 500 Errors

## Problem
Frontend showing 500 errors from all backend endpoints

## Quick Solution

### Option 1: Check Browser Console for CORS
Open browser DevTools (F12) → Console tab
Look for errors mentioning "CORS" or "Cross-Origin"

### Option 2: Hard Refresh
```
Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows/Linux)
```

### Option 3: Check What Port Frontend is Using
Open browser DevTools → Network tab
Click any failing request
Check if it's calling `http://localhost:8000` or something else

### Option 4: Restart Everything Fresh
```bash
cd /Users/hrn/Desktop/gasable_mcp
./restart.sh stop
sleep 3
./restart.sh
```

### Option 5: Check Backend Directly
Open new browser tab:
```
http://localhost:8000/api/status
```

Should see:
```json
{"db":{"status":"ok"},"pids":{...}}
```

### Option 6: Check Frontend .env or API_BASE
The frontend might be configured to hit wrong backend URL

Check src/lib/api.ts line 1-5 for API_BASE configuration

## If Still Failing

Share screenshot of:
1. Browser DevTools → Console tab
2. Browser DevTools → Network tab (click failing request → Preview/Response)
3. Output of: `cat /tmp/gasable_api.log | tail -20`

