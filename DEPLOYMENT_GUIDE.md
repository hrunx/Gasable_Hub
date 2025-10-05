# Production Deployment Guide - Google Cloud Run

This guide explains how to deploy Gasable Hub to Google Cloud Run and access the modern React interface in production.

## 🚀 **Quick Answer: Which Port in Production?**

**In Production (Cloud Run): Only Port 8000**

The FastAPI backend (port 8000) will serve **both**:
- API endpoints (`/api/*`)
- React UI static files (at `/` and `/dashboard`)

Next.js development server (port 3000) is **only for development**.

---

## 📦 **Production Architecture**

```
User Browser
      ↓
Google Cloud Run (Port 8000)
      ├─ FastAPI Backend (Python)
      ├─ API Endpoints (/api/*)
      └─ Static React UI (/, /dashboard, /workflows/*)
```

---

## 🛠️ **Step 1: Build React for Production**

### Option A: Export as Static Site (Recommended)

1. Configure Next.js for static export:

```typescript
// gasable-ui/next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",  // Enable static export
  distDir: "../static/dashboard",  // Export to FastAPI static dir
  images: {
    unoptimized: true,  // Required for static export
  },
  trailingSlash: true,  // Better for static hosting
};

export default nextConfig;
```

2. Build the static site:

```bash
cd gasable-ui
npm run build
# This will export to ../static/dashboard/
```

### Option B: Standalone Build (Alternative)

Keep Next.js as a Node.js server and proxy through FastAPI.

---

## 🔧 **Step 2: Update FastAPI to Serve React**

The `/dashboard` route is already configured to redirect in development and serve static files in production:

```python
# webapp.py (already implemented)
@app.get("/dashboard", response_class=HTMLResponse)
async def dashboard(request: Request):
    """Redirect to new React dashboard or serve static build in production."""
    # In development, redirect to Next.js dev server
    if os.getenv("ENVIRONMENT", "development") == "development":
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url="http://localhost:3000")
    
    # In production, serve the Next.js static build
    try:
        import pathlib
        static_path = pathlib.Path("static/dashboard/index.html")
        if static_path.exists():
            return HTMLResponse(static_path.read_text())
    except Exception:
        pass
    
    # Fallback to old dashboard
    return templates.TemplateResponse("dashboard.html", {"request": request})
```

### Serve All React Routes

Add catch-all route for React Router:

```python
# Add to webapp.py

from fastapi.responses import FileResponse
import os
import pathlib

# Serve React app static files
app.mount("/static/dashboard", StaticFiles(directory="static/dashboard"), name="dashboard_static")

@app.get("/{full_path:path}")
async def serve_react_app(full_path: str):
    """Serve React app for client-side routing."""
    # API routes should not be caught here
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404)
    
    # Check if file exists in static dir
    file_path = pathlib.Path(f"static/dashboard/{full_path}")
    if file_path.is_file():
        return FileResponse(file_path)
    
    # For all other routes, serve index.html (React Router)
    index_path = pathlib.Path("static/dashboard/index.html")
    if index_path.exists():
        return FileResponse(index_path)
    
    raise HTTPException(status_code=404)
```

---

## 🐳 **Step 3: Update Dockerfile**

```dockerfile
# Dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Copy Python requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Copy pre-built React app
COPY static/dashboard ./static/dashboard

# Expose port
EXPOSE 8000

# Set production environment
ENV ENVIRONMENT=production
ENV PORT=8000

# Run FastAPI with uvicorn
CMD ["uvicorn", "webapp:app", "--host", "0.0.0.0", "--port", "8000"]
```

---

## 📋 **Step 4: Create .dockerignore**

```
# .dockerignore
gasable-ui/node_modules
gasable-ui/.next
gasable-ui/out
**/__pycache__
**/*.pyc
.git
.env.local
*.log
.venv
venv
```

---

## ☁️ **Step 5: Deploy to Google Cloud Run**

### 1. Build React App for Production

```bash
cd /Users/hrn/Desktop/gasable_mcp/gasable-ui

# Update next.config.ts as shown above
cat > next.config.ts << 'EOF'
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  distDir: "../static/dashboard",
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
};

export default nextConfig;
EOF

# Build
npm run build

# Verify files were exported
ls -la ../static/dashboard/
```

### 2. Set Up Google Cloud

```bash
# Install gcloud CLI if needed
# https://cloud.google.com/sdk/docs/install

# Login
gcloud auth login

# Set project
gcloud config set project YOUR_PROJECT_ID

# Enable required APIs
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
```

### 3. Configure Environment Variables

Create `.env.production`:

```bash
# .env.production
DATABASE_URL=postgresql://user:pass@host:5432/gasable_db
OPENAI_API_KEY=your_openai_key
ENVIRONMENT=production
CORS_ORIGINS=https://your-app-name-hash.run.app
```

### 4. Deploy

```bash
cd /Users/hrn/Desktop/gasable_mcp

# Build and deploy in one command
gcloud run deploy gasable-hub \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --port 8000 \
  --memory 2Gi \
  --cpu 2 \
  --timeout 300 \
  --env-vars-file .env.production

# Or use Docker build
docker build -t gcr.io/YOUR_PROJECT_ID/gasable-hub .
docker push gcr.io/YOUR_PROJECT_ID/gasable-hub
gcloud run deploy gasable-hub \
  --image gcr.io/YOUR_PROJECT_ID/gasable-hub \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated
```

---

## 🌐 **Accessing the Dashboard in Production**

After deployment, you'll get a URL like:
```
https://gasable-hub-abc123-uc.a.run.app
```

### **All Routes Work Through Port 8000:**

- **Home/Chat**: `https://gasable-hub-abc123-uc.a.run.app/`
- **Dashboard**: `https://gasable-hub-abc123-uc.a.run.app/dashboard`
- **Workflows**: `https://gasable-hub-abc123-uc.a.run.app/workflows/new`
- **API**: `https://gasable-hub-abc123-uc.a.run.app/api/agents`

**No separate port needed!** Everything is served through the Cloud Run URL.

---

## 🔒 **Environment Variables for Production**

Set these in Cloud Run:

```bash
# Required
DATABASE_URL=postgresql://...
OPENAI_API_KEY=sk-...

# Optional
ENVIRONMENT=production
PG_EMBED_COL=embedding_1536
EMBED_DIM=1536
OPENAI_EMBED_MODEL=text-embedding-3-small
CORS_ORIGINS=https://your-domain.com
```

Set via Cloud Console or CLI:

```bash
gcloud run services update gasable-hub \
  --set-env-vars DATABASE_URL=postgresql://... \
  --set-env-vars OPENAI_API_KEY=sk-... \
  --set-env-vars ENVIRONMENT=production
```

---

## 🧪 **Testing Before Deployment**

Test the production setup locally:

```bash
cd /Users/hrn/Desktop/gasable_mcp

# Build React
cd gasable-ui
npm run build
cd ..

# Set production mode
export ENVIRONMENT=production

# Run FastAPI
source .venv/bin/activate
python -m uvicorn webapp:app --host 0.0.0.0 --port 8000

# Test
open http://localhost:8000/dashboard
curl http://localhost:8000/api/status
```

---

## 📊 **Production Checklist**

- [ ] React app built and exported to `static/dashboard/`
- [ ] `next.config.ts` configured for static export
- [ ] FastAPI routes updated to serve React files
- [ ] Dockerfile includes React build
- [ ] Environment variables configured
- [ ] Database connection string uses SSL
- [ ] CORS configured for production domain
- [ ] Tested locally with `ENVIRONMENT=production`
- [ ] Deployed to Cloud Run
- [ ] DNS configured (if using custom domain)

---

## 🐛 **Troubleshooting**

### Issue: 404 on React Routes

**Solution:** Ensure catch-all route is configured in FastAPI to serve `index.html` for all non-API routes.

### Issue: Static Assets Not Loading

**Solution:** Check that `/static/dashboard` is mounted and files exist:
```bash
ls -la static/dashboard/_next/
```

### Issue: API Calls Failing

**Solution:** Update `.env.local` in React to use relative URLs:
```typescript
// src/lib/api.ts
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";  // Empty = same origin
```

### Issue: Old Dashboard Still Showing

**Solution:** Clear browser cache or visit `/` instead of `/dashboard`

---

## 🚀 **Performance Tips**

1. **Enable CDN**: Use Cloud CDN for static assets
2. **Database Connection Pooling**: Use PgBouncer or similar
3. **Redis Caching**: Cache frequent queries
4. **Horizontal Scaling**: Increase Cloud Run instances
5. **Asset Optimization**: Minify/compress static files

---

## 📝 **Summary**

- **Development**: Two servers (3000 for React, 8000 for API)
- **Production**: One server (8000 serving everything)
- **Access**: `https://your-cloud-run-url.run.app/`
- **Dashboard**: Automatically redirects from `/dashboard`

**Everything runs on port 8000 in production!** 🎉

