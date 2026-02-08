# Process Type Development

Process types are the core computational units in Nagelfluh. They are implemented as Python classes and registered via setuptools entrypoints, allowing for a plugin-based architecture.

## Entrypoint Group

All process types must be registered in the **`nagelfluh.process_types`** entrypoint group.

## Process Type Class Structure

Each process type class must implement two class methods:

### `schema()` Method

Returns JSON Schema for process parameter validation and UI form generation.

```python
@classmethod
def schema(cls):
    """Return JSON Schema for process parameters.

    Returns:
        dict: JSON Schema object defining parameter validation
    """
    return {
        "type": "object",
        "properties": {
            "input_data": {
                "type": "string",
                "format": "uri",
                "x-format": "dataset",  # Shows dataset selector in UI
                "title": "Input Dataset"
            },
            "parameter1": {
                "type": "number",
                "default": 1.0,
                "title": "Parameter 1",
                "description": "Description shown in form"
            },
            "option": {
                "type": "string",
                "enum": ["choice1", "choice2"],
                "default": "choice1",
                "title": "Select Option"
            }
        },
        "required": ["input_data"]
    }
```

#### Dataset References

To allow a process to reference another process's output dataset, use:

```python
"my_param": {
    "type": "string",
    "format": "uri",
    "x-format": "dataset",  # Triggers custom dataset selector widget
    "title": "Input Data"
}
```

The frontend will automatically render a searchable dataset selector for this field. The value will be a dataset URL like `http://localhost:8000/dataset/{id}`.

#### Supported Schema Features

- Basic types: `string`, `number`, `integer`, `boolean`, `array`, `object`
- Validation: `minimum`, `maximum`, `minLength`, `maxLength`, `pattern`, `enum`
- UI hints: `title`, `description`, `default`
- Custom formats: `x-format: "dataset"` for dataset selection

### `run()` Method

Executes the process with the provided parameters.

```python
@classmethod
def run(cls, storage_context=None, **kwargs):
    """Execute the process.

    Args:
        storage_context (dict): Storage configuration with keys:
            - process_id (str): Current process ID
            - project_id (str): Project ID
            - storage_base (str): Storage base URL (e.g., s3://nagelfluh-project-abc)
            - storage_kwargs (dict): fsspec kwargs (e.g., endpoint_url for MinIO)
        **kwargs: Process parameters from JSON Schema

    Returns:
        dict: Result with 'status' and optional 'outputs':
            {
                "status": "success",
                "outputs": {
                    "output_name": "s3://path/to/dataset"
                }
            }
    """
    # Your process implementation here
    print(f"Running my_process with params: {kwargs}")

    # Example: Write output dataset
    outputs = {}
    if storage_context:
        dataset_url = write_dataset(
            storage_context['storage_base'],
            storage_context['process_id'],
            storage_context['storage_kwargs']
        )
        outputs['result'] = dataset_url

    return {"status": "success", "outputs": outputs}
```

#### Storage Context

The `storage_context` parameter provides everything needed to access storage:

- **`process_id`**: Unique identifier for this process execution
- **`project_id`**: Project identifier for multi-tenancy
- **`storage_base`**: Base URL for the project bucket (e.g., `s3://nagelfluh-project-abc123`)
- **`storage_kwargs`**: Additional arguments for fsspec (e.g., `{"client_kwargs": {"endpoint_url": "http://minio:9000"}}` for MinIO)

#### Reading Input Datasets

Process parameters may contain dataset URLs. To read them:

```python
import fsspec

def run(cls, storage_context=None, input_data=None, **kwargs):
    # input_data is a URL like "http://localhost:8000/dataset/xyz"
    # Extract the dataset ID and construct storage path

    # Or fetch via HTTP from backend:
    import requests
    response = requests.get(input_data)
    data = response.content

    # Or read directly from storage if you know the path:
    with fsspec.open(
        f"{storage_context['storage_base']}/processes/.../datasets/.../root.msgpack",
        "rb",
        **storage_context['storage_kwargs']
    ) as f:
        data = f.read()
```

#### Writing Output Datasets

Outputs must be written to the storage path and returned as URLs:

```python
import fsspec
import os

def run(cls, storage_context=None, **kwargs):
    # Construct output path
    dataset_id = "my-output-dataset"
    output_path = (
        f"{storage_context['storage_base']}/"
        f"processes/{storage_context['process_id']}/"
        f"datasets/{dataset_id}/root.msgpack"
    )

    # Write data
    with fsspec.open(output_path, "wb", **storage_context['storage_kwargs']) as f:
        f.write(result_data)

    # Return as output
    return {
        "status": "success",
        "outputs": {
            "result": output_path  # Or convert to http:// URL
        }
    }
```

## Registering a New Process Type

### 1. Create Your Process Class

```python
# mypackage/processes.py

class my_custom_process:
    """Description of what this process does."""

    @classmethod
    def schema(cls):
        return {
            "type": "object",
            "properties": {
                "input": {
                    "type": "string",
                    "format": "uri",
                    "x-format": "dataset",
                    "title": "Input Dataset"
                },
                "threshold": {
                    "type": "number",
                    "default": 0.5,
                    "minimum": 0,
                    "maximum": 1,
                    "title": "Threshold"
                }
            },
            "required": ["input"]
        }

    @classmethod
    def run(cls, storage_context=None, **kwargs):
        print(f"Running with parameters: {kwargs}")
        # ... process implementation ...
        return {"status": "success"}
```

### 2. Register in setup.py

```python
from setuptools import setup

setup(
    name="mypackage",
    version="0.1.0",
    packages=["mypackage"],
    entry_points={
        "nagelfluh.process_types": [
            "my_custom_process=mypackage.processes:my_custom_process",
        ],
    },
)
```

The entrypoint name (`my_custom_process`) becomes the process type identifier in the UI.

### 3. Install in Docker Image

Add to your `Dockerfile`:

```dockerfile
COPY mypackage /app/mypackage
RUN pip install -e /app/mypackage
```

Or add to `requirements.txt`:

```
git+https://github.com/yourorg/mypackage.git
```

## Schema Generation

When the Docker image is built, all process type schemas are automatically collected:

- **Script**: `/app/get_schema.py` runs during Docker build
- **Output**: `/app/process_schemas.json`
- **Format**: `{"process_type_name": {...schema...}, ...}`
- **Usage**: Backend reads this file to list available process types without executing process code

The `get_schema.py` script:
1. Uses `pkg_resources` to discover all entrypoints in `nagelfluh.process_types`
2. Loads each class
3. Calls `cls.schema()`
4. Writes JSON file with all schemas

## Example Process Types

See `docker/base-runner/nagelfluh_processes/fake_processes.py` for reference implementations:

### FFT Process

```python
class fft:
    """Fast Fourier Transform analysis."""

    @classmethod
    def schema(cls):
        return {
            "type": "object",
            "properties": {
                "input_data": {
                    "type": "string",
                    "format": "uri",
                    "x-format": "dataset",
                    "title": "Input Dataset"
                }
            },
            "required": ["input_data"]
        }

    @classmethod
    def run(cls, storage_context=None, **kwargs):
        print("Running FFT analysis...")
        import time
        time.sleep(2)
        return {"status": "success"}
```

### Inversion Process

```python
class inversion:
    """Geophysical inversion with regularization."""

    @classmethod
    def schema(cls):
        return {
            "type": "object",
            "properties": {
                "input_data": {
                    "type": "string",
                    "format": "uri",
                    "x-format": "dataset",
                    "title": "AEM Data"
                },
                "alpha": {
                    "type": "number",
                    "default": 0.01,
                    "minimum": 0,
                    "title": "Regularization Parameter"
                },
                "max_iterations": {
                    "type": "integer",
                    "default": 100,
                    "minimum": 1,
                    "title": "Maximum Iterations"
                }
            },
            "required": ["input_data"]
        }

    @classmethod
    def run(cls, storage_context=None, **kwargs):
        print(f"Running inversion with alpha={kwargs['alpha']}")
        import time
        time.sleep(5)
        return {"status": "success"}
```

### Import Data Process

```python
class import_data:
    """Import external data files."""

    @classmethod
    def schema(cls):
        return {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "title": "File Path"
                },
                "format": {
                    "type": "string",
                    "enum": ["csv", "geotiff", "xyz"],
                    "default": "csv",
                    "title": "File Format"
                }
            },
            "required": ["file_path"]
        }

    @classmethod
    def run(cls, storage_context=None, **kwargs):
        print(f"Importing {kwargs['file_path']} as {kwargs['format']}")
        return {"status": "success"}
```

## Best Practices

### Error Handling

Always catch exceptions and return appropriate status:

```python
@classmethod
def run(cls, storage_context=None, **kwargs):
    try:
        # ... process logic ...
        return {"status": "success", "outputs": {...}}
    except ValueError as e:
        print(f"ERROR: Invalid input - {e}")
        return {"status": "failed", "error": str(e)}
    except Exception as e:
        print(f"ERROR: Unexpected error - {e}")
        return {"status": "failed", "error": str(e)}
```

### Logging

Use `print()` for logging - stdout is captured and streamed to the UI:

```python
print("Starting process...")
print(f"Processing {n} items...")
print(f"Progress: {i}/{n} ({100*i/n:.1f}%)")
print("Complete!")
```

### Progress Updates

For long-running processes, print progress regularly:

```python
for i, item in enumerate(data):
    process_item(item)
    if i % 100 == 0:
        print(f"Processed {i}/{len(data)} items")
```

### Resource Efficiency

- Clean up temporary files
- Release memory when possible
- Use streaming for large datasets
- Respect the deadline parameter

### Schema Design

- Provide sensible defaults
- Use descriptive titles and descriptions
- Group related parameters in nested objects
- Use enums for fixed choices
- Mark required fields appropriately
- Use appropriate number ranges (minimum/maximum)

## Testing Process Types

### Local Testing

Test your process class locally before deploying:

```python
# test_process.py
from mypackage.processes import my_custom_process

# Test schema
schema = my_custom_process.schema()
print("Schema:", schema)

# Test run
result = my_custom_process.run(
    storage_context={
        'process_id': 'test',
        'project_id': 'test-project',
        'storage_base': 'file:///tmp/test-storage',
        'storage_kwargs': {}
    },
    input="test-data",
    threshold=0.7
)
print("Result:", result)
```

### Docker Testing

Test in Docker container locally:

```bash
# Build image
./docker/build.sh

# Run test
docker run --rm \
  -e PROCESS_TYPE=my_custom_process \
  -e PROCESS_ID=test \
  -e VERSION=1 \
  -e PROJECT_ID=test-project \
  -e PARAMETERS_JSON='{"threshold": 0.7}' \
  -e STORAGE_BASE=file:///tmp/storage \
  nagelfluh-base-runner:latest
```

## Advanced Topics

### Multiple Outputs

Return multiple datasets:

```python
return {
    "status": "success",
    "outputs": {
        "primary_result": "s3://.../dataset1",
        "diagnostics": "s3://.../dataset2",
        "metadata": "s3://.../dataset3"
    }
}
```

### Conditional Outputs

Outputs can vary based on parameters:

```python
outputs = {"result": result_url}
if kwargs.get("save_intermediate"):
    outputs["intermediate"] = intermediate_url
return {"status": "success", "outputs": outputs}
```

### Nested Schema Parameters

Use nested objects for complex configurations:

```python
"properties": {
    "solver": {
        "type": "object",
        "properties": {
            "method": {"type": "string", "enum": ["conjugate_gradient", "lbfgs"]},
            "tolerance": {"type": "number", "default": 1e-6},
            "max_iterations": {"type": "integer", "default": 1000}
        }
    }
}
```

Access in run():

```python
def run(cls, storage_context=None, solver=None, **kwargs):
    method = solver["method"]
    tolerance = solver["tolerance"]
    ...
```
