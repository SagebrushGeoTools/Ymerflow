FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl git openssl docker.io && \
    rm -rf /var/lib/apt/lists/*

# Install minio-client for bucket/user management
RUN curl -sSL https://dl.min.io/client/mc/release/linux-amd64/mc \
    -o /usr/local/bin/minio-client && \
    chmod +x /usr/local/bin/minio-client

# Install the minikube CLI — needed only when this image is run as the bootstrap-provision
# container for plugins/ymerflow-minikube's MinikubeClusterProvider/MinioProtocolHandler/
# DockerV2ProtocolHandler.bootstrap() (see docs/plans/minikube-provisioning-plugin.md, Design
# decision 2): `minikube start`/`stop`/`delete` inside this container control the HOST's real
# Minikube via the host's Docker socket, mounted in at `docker run` time — this image ships the
# CLI once rather than needing a separate bootstrap-only image. `docker.io` above provides the
# `docker` CLI minikube's docker driver shells out to (talking to the mounted host socket, not a
# nested daemon — no dockerd is started in this image).
RUN ARCH="$(dpkg --print-architecture)" && \
    case "$ARCH" in amd64) MK_ARCH=amd64 ;; arm64) MK_ARCH=arm64 ;; *) echo "unsupported arch: $ARCH" >&2; exit 1 ;; esac && \
    curl -fsSLo /usr/local/bin/minikube "https://storage.googleapis.com/minikube/releases/latest/minikube-linux-${MK_ARCH}" && \
    chmod +x /usr/local/bin/minikube

WORKDIR /app

# Install the backend package (editable) from source. Editable keeps widget_schemas.json and the
# alembic tree resolvable by path and avoids enumerating package_data for them.
COPY setup.py setup.py
COPY backend/ backend/
RUN pip install --no-cache-dir -e .

# dev/setup-minikube-remote.sh.in + dev/lib/provision-nagelfluh-jobs.sh are read at runtime by
# GET /static/assets/setup-minikube-remote.sh (backend/routers/admin.py) to render the remote
# cluster registration script — see docs/plans/remote-cluster-provisioning-and-registry.md.
COPY dev/ dev/

# Server-side backend plugins (unchanged mechanism) — installed AFTER the backend so their
# lazily-imported host modules are present in the image. Listed in BACKEND_PLUGINS — passed in
# as a build-arg by prod/runall-minikube.sh from config.env. Same list, same installer as dev. Local
# paths (e.g. plugins/billing) install from the COPY'd source, so PRIVATE plugins need no git creds
# in the image. The build context is the project root, so plugins/ is available to COPY.
ARG BACKEND_PLUGINS=""
COPY plugins/ plugins/
COPY scripts/install-backend-plugins.sh scripts/install-backend-plugins.sh
RUN BACKEND_PLUGINS="$BACKEND_PLUGINS" bash scripts/install-backend-plugins.sh

COPY docker/update_bootstrap_environment.py update_bootstrap_environment.py

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
