FROM python:3.11-slim

# Prevent Python from writing .pyc files and buffering stdout/stderr
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=8080

WORKDIR /app

# System deps (build essentials for some libs, libpq for psycopg2)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps first for better layer caching
COPY requirements.txt ./
RUN pip install -r requirements.txt

# Copy application
COPY . .

# Expose Cloud Run port
EXPOSE 8080

# Start FastAPI via uvicorn; module is webapp:app. Honor Cloud Run PORT.
CMD ["sh", "-lc", "uvicorn webapp:app --host 0.0.0.0 --port ${PORT:-8080}"]


