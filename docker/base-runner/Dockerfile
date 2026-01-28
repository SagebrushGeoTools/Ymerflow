FROM python:3.11-slim

WORKDIR /app

# Install dependencies
RUN pip install fsspec s3fs gcsfs requests

# Copy runner script
COPY runner.py /app/runner.py

# Create nagelfluh_runner package directory
RUN mkdir -p /app/nagelfluh_runner

# Copy fake process implementations
COPY fake_processes.py /app/nagelfluh_runner/fake_processes.py

# Create __init__.py
RUN touch /app/nagelfluh_runner/__init__.py

ENTRYPOINT ["python", "/app/runner.py"]
