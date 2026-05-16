FROM gcr.io/kaniko-project/executor:v1.24.0 AS kaniko

FROM python:3.11-slim-trixie

WORKDIR /app

# Install crane for extracting files from container images.
# Also install C++ build tools and libboost-dev (1.83 in Trixie) needed to
# compile pyinterp from source (requires Boost >= 1.79).
RUN apt-get update && apt-get install -y --no-install-recommends \
        git curl tar \
        build-essential cmake libboost-dev libeigen3-dev && \
    curl -sL "https://github.com/google/go-containerregistry/releases/download/v0.19.0/go-containerregistry_Linux_x86_64.tar.gz" | tar -xz -C /usr/local/bin crane && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy Kaniko executor from the official kaniko image
COPY --from=kaniko /kaniko/executor /kaniko-executor

RUN echo "Version 11"

# Copy nagelfluh_runner package for utilities
RUN mkdir -p /app/nagelfluh_runner
COPY backend/utils/xyz_utils.py /app/nagelfluh_runner/xyz_utils.py
RUN touch /app/nagelfluh_runner/__init__.py

# Copy and install nagelfluh_processes package
COPY docker/base-runner/nagelfluh_processes /app/nagelfluh_processes
RUN pip install --no-cache-dir -e /app/nagelfluh_processes

# Copy and install aem_processes package
COPY docker/base-runner/aem_processes /app/aem_processes
RUN pip install --no-cache-dir -e '/app/aem_processes[all]'

# Copy and install mag_processes package
COPY docker/base-runner/mag_processes /app/mag_processes
RUN pip install --no-cache-dir -e /app/mag_processes

# Copy runner and schema generator scripts
COPY docker/base-runner/runner.py /app/runner.py
COPY docker/base-runner/get_schema.py /app/get_schema.py

# Generate process schemas JSON file
RUN python /app/get_schema.py

ENTRYPOINT ["python", "-u", "/app/runner.py"]
