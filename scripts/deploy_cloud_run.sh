#!/usr/bin/env bash
# Build and deploy Gasable Hub to Cloud Run, ensuring the project ID is set.
# Usage: ./scripts/deploy_cloud_run.sh [PROJECT_ID]

set -euo pipefail

SERVICE_NAME=${SERVICE_NAME:-gasable-hub}
REGION=${REGION:-europe-west1}
TAG=${TAG:-latest}

resolved_project=${1:-${PROJECT_ID:-}}
if [[ -z "${resolved_project}" ]]; then
  resolved_project=$(gcloud config get-value project 2>/dev/null || true)
fi

if [[ -z "${resolved_project}" || "${resolved_project}" == "PROJECT_ID" || "${resolved_project}" == "YOUR_PROJECT_ID" ]]; then
  echo "Error: Google Cloud project ID is required. Provide it as an argument or via PROJECT_ID env." >&2
  exit 1
fi

IMAGE="gcr.io/${resolved_project}/${SERVICE_NAME}:${TAG}"

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  echo "Building container image ${IMAGE}..."
  gcloud builds submit --tag "${IMAGE}"
else
  echo "Skipping image build (SKIP_BUILD=1)."
fi

echo "Deploying ${SERVICE_NAME} to Cloud Run in ${REGION}..."
exec gcloud run deploy "${SERVICE_NAME}" \
  --image "${IMAGE}" \
  --region "${REGION}" \
  --platform managed \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 2 \
  --timeout 300
