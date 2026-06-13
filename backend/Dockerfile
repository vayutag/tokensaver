# syntax=docker/dockerfile:1

###############################################################################
# MarkItDown Website Backend - FastAPI application image
#
# Uses a slim Python 3.11 base image, installs dependencies, runs as a
# non-root user, exposes port 8000, and defines a container HEALTHCHECK that
# probes the GET /api/health endpoint for orchestration readiness/liveness.
###############################################################################

FROM python:3.11-slim AS base

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------
# - PYTHONDONTWRITEBYTECODE: don't write .pyc files
# - PYTHONUNBUFFERED: stream logs straight to stdout/stderr (no buffering)
# - PIP_NO_CACHE_DIR / PIP_DISABLE_PIP_VERSION_CHECK: leaner, quieter builds
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    APP_HOME=/app \
    TEMP_STORAGE_PATH=/app/temp

WORKDIR ${APP_HOME}

# ---------------------------------------------------------------------------
# System dependencies
# ---------------------------------------------------------------------------
# - curl is used by the container HEALTHCHECK to probe the health endpoint.
# - Common runtime libraries required by some MarkItDown converters.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl \
        libmagic1 \
    && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
# Python dependencies (cached layer)
# ---------------------------------------------------------------------------
# Copy only requirements first so the dependency layer is cached and only
# rebuilt when requirements.txt changes.
COPY requirements.txt ./
RUN pip install --upgrade pip \
    && pip install -r requirements.txt

# ---------------------------------------------------------------------------
# Application code
# ---------------------------------------------------------------------------
COPY app ./app

# ---------------------------------------------------------------------------
# Non-root user and writable temp storage
# ---------------------------------------------------------------------------
# Create an unprivileged user and a temp storage directory it owns, then drop
# privileges. Running as non-root limits the blast radius of any compromise.
RUN useradd --create-home --uid 10001 appuser \
    && mkdir -p ${TEMP_STORAGE_PATH} \
    && chown -R appuser:appuser ${APP_HOME}

USER appuser

# ---------------------------------------------------------------------------
# Networking
# ---------------------------------------------------------------------------
EXPOSE 8000

# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------
# Probe the FastAPI health endpoint. Container orchestrators use this signal to
# determine readiness/liveness. --start-period gives the app time to boot.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl --fail --silent http://localhost:8000/api/health || exit 1

# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------
# Bind to 0.0.0.0 so the service is reachable from outside the container.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
