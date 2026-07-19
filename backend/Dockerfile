FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl git openssl && \
    rm -rf /var/lib/apt/lists/*

# NOTE: no cluster/storage-plugin tooling is installed here anymore — this image is
# provider-agnostic. The minikube CLI + docker.io were dropped (bootstrap-provision runs host-side
# now, and nothing the backend pod runs shells out to docker/minikube). minio-client was dropped
# too: the ymerflow-minikube plugin now ships the `mc` binary as its OWN package data (downloaded by
# its setup.py, called by path from minio_service.py) — so a storage plugin's runtime binaries
# travel with the plugin, not baked into core's image. A deployment using a different storage/
# cluster plugin pulls in whatever THAT plugin bundles instead. See
# docs/plans/done/generic-deployment-orchestration.md.

WORKDIR /app

# Install the backend package (editable) from source. Editable keeps widget_schemas.json and the
# alembic tree resolvable by path and avoids enumerating package_data for them.
COPY setup.py setup.py
COPY backend/ backend/
RUN pip install --no-cache-dir -e .

# Server-side backend plugins (unchanged mechanism) — installed AFTER the backend so their
# lazily-imported host modules are present in the image. Listed in BACKEND_PLUGINS — passed in
# as a build-arg by prod/runall-production.sh from config.env. Same list, same installer as dev. Local
# paths (e.g. plugins/billing) install from the COPY'd source, so PRIVATE plugins need no git creds
# in the image. The build context is the project root, so plugins/ is available to COPY.
ARG BACKEND_PLUGINS=""
COPY plugins/ plugins/
COPY scripts/install-backend-plugins.sh scripts/install-backend-plugins.sh
RUN BACKEND_PLUGINS="$BACKEND_PLUGINS" bash scripts/install-backend-plugins.sh

COPY docker/update_bootstrap_environment.py update_bootstrap_environment.py

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
