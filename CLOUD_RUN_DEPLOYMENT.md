# 🚀 Google Cloud Run Deployment Guide

## Overview

This guide explains how to deploy Gasable Hub to Google Cloud Run with both the Next.js frontend and FastAPI backend running in a single container.

---

## 📦 Architecture

**Single Container Deployment:**
- **Port 8000**: FastAPI backend (main entry point)
- **Port 3000**: Next.js standalone server (internal)
- **Proxy**: FastAPI proxies frontend requests to Next.js

```
Cloud Run Container
├── FastAPI (Port 8000) ← External Traffic
│   ├── /api/* → Backend APIs
│   └── /* → Proxy to Next.js
└── Next.js (Port 3000) ← Internal Only
    └── React Dashboard
```

---

## 🔧 Prerequisites

1. **Google Cloud Project**
   ```bash
   gcloud config set project YOUR_PROJECT_ID
   ```

2. **Enable APIs**
   ```bash
   gcloud services enable run.googleapis.com
   gcloud services enable cloudbuild.googleapis.com
   gcloud services enable containerregistry.googleapis.com
   ```

3. **Environment Variables** (Set in Cloud Run)
   ```bash
   ENVIRONMENT=production
   OPENAI_API_KEY=sk-proj-...
   DATABASE_URL=postgresql://...
   NETLIFY_DATABASE_URL=postgresql://...
   OPENAI_MODEL=gpt-4o-mini
   OPENAI_EMBED_MODEL=text-embedding-3-small
   ```

---

## 📝 Deployment Methods

### Method 1: Automated (via Cloud Build)

1. **Push to GitHub**
   ```bash
   git add -A
   git commit -m "deploy: Production ready"
   git push origin main
   ```

2. **Deploy via Cloud Build**
   ```bash
   gcloud builds submit --config cloudbuild.yaml
   ```

3. **Access your app**
   ```
   https://gasable-hub-[hash].europe-west1.run.app
   ```

### Method 2: Manual (via Docker)

> ⚠️ Replace `YOUR_PROJECT_ID` with your actual Google Cloud project ID. Using the
> placeholder value will cause Cloud Run to fail with
> `Image not found: gcr.io/PROJECT_ID/gasable-hub:latest`.

1. **Build Docker Image**
   ```bash
   docker build -t gcr.io/YOUR_PROJECT_ID/gasable-hub:latest .
   ```

2. **Push to Container Registry**
   ```bash
   docker push gcr.io/YOUR_PROJECT_ID/gasable-hub:latest
   ```

3. **Deploy to Cloud Run**
   ```bash
   gcloud run deploy gasable-hub \
     --image gcr.io/YOUR_PROJECT_ID/gasable-hub:latest \
     --region europe-west1 \
     --platform managed \
     --allow-unauthenticated \
     --port 8000 \
     --memory 2Gi \
     --cpu 2 \
     --timeout 300 \
     --set-env-vars ENVIRONMENT=production
   ```

#### Helper script (recommended)

To guard against accidentally using the placeholder project ID, run:

```bash
./scripts/deploy_cloud_run.sh YOUR_PROJECT_ID
```

The script resolves the project, builds the container image, and deploys it to
Cloud Run with the same flags as above. You can also export `PROJECT_ID` and run
the script without arguments.

### Method 3: Direct Source (Simplest)

```bash
gcloud run deploy gasable-hub \
  --source . \
  --region europe-west1 \
  --platform managed \
  --allow-unauthenticated \
  --port 8000 \
  --memory 2Gi \
  --cpu 2
```

---

## 🔐 Set Environment Variables

After deployment, set your secrets:

```bash
gcloud run services update gasable-hub \
  --region europe-west1 \
  --update-env-vars \
OPENAI_API_KEY=your-key-here,\
DATABASE_URL=your-db-url,\
NETLIFY_DATABASE_URL=your-supabase-url,\
ENVIRONMENT=production
```

---

## ✅ Verification

1. **Check Service Status**
   ```bash
   gcloud run services describe gasable-hub --region europe-west1
   ```

2. **View Logs**
   ```bash
   gcloud run logs read gasable-hub --region europe-west1 --limit 50
   ```

3. **Test Endpoints**
   ```bash
   # Health check
   curl https://YOUR-SERVICE-URL/api/status
   
   # Dashboard (should show HTML)
   curl https://YOUR-SERVICE-URL/
   
   # Agents API
   curl https://YOUR-SERVICE-URL/api/agents
   ```

---

## 🐛 Troubleshooting

### Issue: "Dashboard unavailable" or blank page

**Solution 1**: Check Next.js is running
```bash
gcloud run logs read gasable-hub --region europe-west1 | grep -i next
```

**Solution 2**: Verify environment variable
```bash
gcloud run services describe gasable-hub --region europe-west1 --format="value(spec.template.spec.containers[0].env)"
```

**Solution 3**: Check memory/CPU
```bash
# Increase resources
gcloud run services update gasable-hub \
  --region europe-west1 \
  --memory 4Gi \
  --cpu 4
```

### Issue: "Connection timeout" errors

**Solution**: Increase timeout
```bash
gcloud run services update gasable-hub \
  --region europe-west1 \
  --timeout 600
```

### Issue: Database connection errors

**Solution**: Check DATABASE_URL format
```
postgresql://user:password@host:port/database?sslmode=require
```

---

## 📊 Monitoring

### View Live Logs
```bash
gcloud run logs tail gasable-hub --region europe-west1
```

### Check Metrics
```bash
gcloud run services describe gasable-hub \
  --region europe-west1 \
  --format="value(status.url)"
```

### Cloud Console
1. Go to: https://console.cloud.google.com/run
2. Select your service
3. View: Metrics, Logs, Revisions

---

## 💰 Cost Optimization

**Current Configuration:**
- Memory: 2Gi
- CPU: 2
- Estimated cost: ~$30-50/month for moderate traffic

**Reduce Costs:**
```bash
# Lower resources for testing
gcloud run services update gasable-hub \
  --region europe-west1 \
  --memory 1Gi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 3
```

---

## 🔄 Updates & Rollbacks

### Deploy New Version
```bash
git push origin main
gcloud builds submit --config cloudbuild.yaml
```

### Rollback to Previous Version
```bash
# List revisions
gcloud run revisions list --service gasable-hub --region europe-west1

# Rollback
gcloud run services update-traffic gasable-hub \
  --region europe-west1 \
  --to-revisions REVISION_NAME=100
```

---

## 🌍 Custom Domain

1. **Map Domain**
   ```bash
   gcloud run domain-mappings create \
     --service gasable-hub \
     --domain your-domain.com \
     --region europe-west1
   ```

2. **Update DNS** (as instructed by Cloud Run)

3. **SSL** is automatic via Google-managed certificates

---

## 📚 Key Files

- **`Dockerfile`** - Multi-stage build for Next.js + Python
- **`start-production.sh`** - Startup script for Cloud Run
- **`cloudbuild.yaml`** - Automated CI/CD configuration
- **`next.config.ts`** - Next.js standalone mode
- **`src/lib/api.ts`** - Relative URLs in production

---

## ✅ Production Checklist

Before deploying to production:

- [ ] Set all environment variables in Cloud Run
- [ ] Configure database connection (SSL mode)
- [ ] Set up monitoring/alerting
- [ ] Configure custom domain (optional)
- [ ] Test all API endpoints
- [ ] Test dashboard loads correctly
- [ ] Verify agent chat works
- [ ] Check workflow builder functions
- [ ] Monitor logs for errors
- [ ] Set up backup/disaster recovery

---

## 🆘 Support

**Your Deployment URL**: https://chart-gasable-hub-3644-593853561959.europe-west1.run.app

**Common Commands**:
```bash
# Restart service
gcloud run services update gasable-hub --region europe-west1

# View current config
gcloud run services describe gasable-hub --region europe-west1

# Scale up
gcloud run services update gasable-hub --region europe-west1 --min-instances 1

# Delete service
gcloud run services delete gasable-hub --region europe-west1
```

---

**Status**: ✅ Ready for deployment!
