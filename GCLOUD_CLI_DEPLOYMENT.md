## Google Cloud CLI Deployment (Gasable Hub)

This guide walks through deploying the combined Next.js + FastAPI app to Cloud Run via the gcloud CLI using a service account.

### Prerequisites
- Google Cloud project (note region vs global: Cloud Run lives in a region like `europe-west1`; Cloud Build is global).
- Service account JSON key with project-level IAM:
  - roles/serviceusage.serviceUsageAdmin
  - roles/run.admin
  - roles/cloudbuild.builds.editor
  - roles/artifactregistry.writer
  - roles/storage.admin (for Container Registry classic)
- gcloud CLI installed (`gcloud --version`)
- Docker (optional, for local build/push)

### 1) Authenticate and set project
```bash
export PATH="$HOME/.local/google-cloud-sdk/bin:$PATH"
PROJECT_ID=gen-lang-client-0521740592
SA_KEY=service_acc(gasablehub).json

# Authenticate with service account
gcloud auth activate-service-account --key-file "$SA_KEY"
# Set project
gcloud config set project "$PROJECT_ID"
```

### 2) Enable required APIs (run as project OWNER user once)
```bash
gcloud auth login --brief
gcloud config set project "$PROJECT_ID"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com containerregistry.googleapis.com
```

### 3) Build and deploy (Cloud Build)
Option A: Cloud Build using `cloudbuild.yaml` (build + push + deploy)
```bash
gcloud builds submit --config cloudbuild.yaml
```

Option B: Cloud Build to build only, then deploy manually
```bash
gcloud builds submit --tag gcr.io/$PROJECT_ID/gasable-hub:latest

gcloud run deploy gasable-hub \
  --image gcr.io/$PROJECT_ID/gasable-hub:latest \
  --region europe-west1 \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --memory 2Gi \
  --cpu 2 \
  --timeout 300
```

Option C: Source-based deploy (simplest, Cloud Build runs under the hood)
```bash
gcloud run deploy gasable-hub \
  --source . \
  --region europe-west1 \
  --platform managed \
  --allow-unauthenticated \
  --port 8080
```

### 4) Set environment variables
Use your local `.env` to update Cloud Run:
```bash
set -a && [ -f .env ] && . ./.env || true && set +a
cat > /tmp/env.yaml <<EOF
ENVIRONMENT: "${ENVIRONMENT:-production}"
DATABASE_URL: "${DATABASE_URL}"
NETLIFY_DATABASE_URL: "${NETLIFY_DATABASE_URL}"
SUPABASE_DB_URL: "${SUPABASE_DB_URL}"
OPENAI_API_KEY: "${OPENAI_API_KEY}"
OPENAI_MODEL: "${OPENAI_MODEL}"
OPENAI_EMBED_MODEL: "${OPENAI_EMBED_MODEL}"
EMBED_DIM: "${EMBED_DIM}"
PG_EMBED_COL: "${PG_EMBED_COL}"
API_TOKEN: "${API_TOKEN}"
EOF

gcloud run services update gasable-hub \
  --region europe-west1 \
  --env-vars-file /tmp/env.yaml
```

### 5) Verify
```bash
gcloud run services describe gasable-hub --region europe-west1 --format="value(status.url)"
gcloud run logs tail gasable-hub --region europe-west1
```

### Speeding up builds
- Added `.dockerignore` to exclude `node_modules`, `.venv`, `.next`, logs, storage, and secrets → reduces context upload time.
- If using source deploy, first run `npm run build` locally to avoid large Next.js compile times in Cloud Build.

### Region vs Global
- Cloud Run service is regional (e.g., `europe-west1`).
- Cloud Build is a global service; its dashboard shows builds under `global`. This is expected.

### Troubleshooting
- Permission denied enabling APIs: grant roles above to the service account using an OWNER user.
- pgvector HNSW > 2000 dims: migrations now skip unsafe HNSW; use IVFFlat or 1536-dim embeddings.
- gcloud grpc errors: set `CLOUDSDK_PYTHON` to a Python with grpc installed or reinstall gcloud.
- Container Registry vs Artifact Registry: prefer AR (`europe-west1-docker.pkg.dev`); configure Docker auth with:
  ```bash
  gcloud auth configure-docker europe-west1-docker.pkg.dev
  ```
