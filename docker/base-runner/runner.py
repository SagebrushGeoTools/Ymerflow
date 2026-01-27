import os
import sys
import json
import importlib
import requests
from datetime import datetime


def main():
    # Get config from env
    function_module = os.environ['FUNCTION_MODULE']
    function_name = os.environ['FUNCTION_NAME']
    process_id = os.environ['PROCESS_ID']
    version = os.environ['VERSION']
    parameters_json = os.environ['PARAMETERS_JSON']
    backend_url = os.environ['BACKEND_URL']

    # Parse parameters
    parameters = json.loads(parameters_json)

    print(f"Running {function_module}.{function_name}...")

    try:
        # Import and execute function
        module = importlib.import_module(function_module)
        func = getattr(module, function_name)

        # Execute
        result = func(**parameters)

        print(f"Execution completed successfully")
        print(f"Result: {result}")

        # TODO: Upload outputs to backend (for now, no real outputs)

        sys.exit(0)

    except Exception as e:
        print(f"ERROR: {str(e)}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
