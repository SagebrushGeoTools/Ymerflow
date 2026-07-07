FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl git && \
    rm -rf /var/lib/apt/lists/*

# Install minio-client for bucket/user management
RUN curl -sSL https://dl.min.io/client/mc/release/linux-amd64/mc \
    -o /usr/local/bin/minio-client && \
    chmod +x /usr/local/bin/minio-client

WORKDIR /app

COPY backend/requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Server-side backend plugins (nagelfluh.hooks entry points), listed in BACKEND_PLUGINS — passed in
# as a build-arg by prod/runall-minikube.sh from config.env. Same list, same installer as dev. Local
# paths (e.g. plugins/billing) install from the COPY'd source, so PRIVATE plugins need no git creds
# in the image. The build context is the project root, so plugins/ is available to COPY.
ARG BACKEND_PLUGINS=""
COPY plugins/ plugins/
COPY scripts/install-backend-plugins.sh scripts/install-backend-plugins.sh
RUN BACKEND_PLUGINS="$BACKEND_PLUGINS" bash scripts/install-backend-plugins.sh

COPY backend/ backend/
COPY docker/update_bootstrap_environment.py update_bootstrap_environment.py

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
