FROM python:3.11-slim

WORKDIR /app

# Install dependencies
RUN pip install fsspec s3fs gcsfs requests libaarhusxyz pandas projnames msgpack msgpack-numpy geopandas

# Copy runner script
COPY docker/base-runner/runner.py /app/runner.py

# Create nagelfluh_runner package directory
RUN mkdir -p /app/nagelfluh_runner

# Copy fake process implementations and utilities
COPY docker/base-runner/fake_processes.py /app/nagelfluh_runner/fake_processes.py

# Copy xyz_utils for proper msgpack generation
COPY backend/utils/xyz_utils.py /app/nagelfluh_runner/xyz_utils.py

# Copy data files for mock XYZ generation
COPY data /app/data

# Create __init__.py
RUN touch /app/nagelfluh_runner/__init__.py

ENTRYPOINT ["python", "/app/runner.py"]
