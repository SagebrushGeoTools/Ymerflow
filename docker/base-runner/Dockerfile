FROM python:3.11-slim

WORKDIR /app

# Copy nagelfluh_runner package for utilities
RUN mkdir -p /app/nagelfluh_runner
COPY backend/utils/xyz_utils.py /app/nagelfluh_runner/xyz_utils.py
RUN touch /app/nagelfluh_runner/__init__.py

# Copy data files for mock XYZ generation
COPY data /app/data

# Copy and install nagelfluh_processes package
COPY docker/base-runner/nagelfluh_processes /app/nagelfluh_processes
RUN pip install -e /app/nagelfluh_processes

# Copy runner and schema generator scripts
COPY docker/base-runner/runner.py /app/runner.py
COPY docker/base-runner/get_schema.py /app/get_schema.py

# Generate process schemas JSON file
RUN python /app/get_schema.py

ENTRYPOINT ["python", "/app/runner.py"]
