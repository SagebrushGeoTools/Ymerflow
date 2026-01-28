import os
import sys
import json
import importlib
import requests
from datetime import datetime


def get_storage_kwargs():
    """Get storage configuration for fsspec."""
    kwargs = {}
    if os.environ.get('STORAGE_ENDPOINT'):
        kwargs['client_kwargs'] = {'endpoint_url': os.environ['STORAGE_ENDPOINT']}
    return kwargs


def main():
    # Get config from env
    function_module = os.environ['FUNCTION_MODULE']
    function_name = os.environ['FUNCTION_NAME']
    process_id = os.environ['PROCESS_ID']
    version = os.environ['VERSION']
    project_id = os.environ['PROJECT_ID']
    parameters_json = os.environ['PARAMETERS_JSON']
    backend_url = os.environ['BACKEND_URL']
    storage_base = os.environ['STORAGE_BASE']

    # Parse parameters
    parameters = json.loads(parameters_json)

    print(f"Running {function_module}.{function_name}...")
    print(f"Process ID: {process_id}")
    print(f"Project ID: {project_id}")
    print(f"Storage base: {storage_base}")

    try:
        # Import and execute function
        module = importlib.import_module(function_module)
        func = getattr(module, function_name)

        # Inject storage context into parameters
        storage_context = {
            'process_id': process_id,
            'project_id': project_id,
            'storage_base': storage_base,
            'storage_kwargs': get_storage_kwargs()
        }

        # Execute process function with storage context
        result = func(storage_context=storage_context, **parameters)

        print(f"Execution completed successfully")
        print(f"Result: {result}")

        # Report outputs to backend if any were generated
        if result and isinstance(result, dict) and 'outputs' in result:
            print(f"Reporting outputs to backend: {result['outputs']}")
            # TODO: POST to backend to register outputs
            # requests.post(f"{backend_url}/process/{process_id}/outputs", json=result['outputs'])

        sys.exit(0)

    except Exception as e:
        print(f"ERROR: {str(e)}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
