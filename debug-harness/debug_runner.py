#!/usr/bin/env python3
"""Debug wrapper for runner.py that adds pdb post-mortem debugging."""

import os
import sys
import pdb
import traceback

# Ensure unbuffered output for pdb
sys.stdout = os.fdopen(sys.stdout.fileno(), 'w', buffering=1)
sys.stderr = os.fdopen(sys.stderr.fileno(), 'w', buffering=1)

# Add the runner directory to the path
sys.path.insert(0, '/app')

def main():
    """Run the original runner with pdb post-mortem on exception."""
    print("=" * 80)
    print("DEBUG RUNNER - Running with pdb post-mortem enabled")
    print("=" * 80)
    print()

    # Display environment configuration
    print("Environment Configuration:")
    print(f"  PROCESS_TYPE: {os.environ.get('PROCESS_TYPE', 'NOT SET')}")
    print(f"  PROCESS_ID: {os.environ.get('PROCESS_ID', 'NOT SET')}")
    print(f"  VERSION: {os.environ.get('VERSION', 'NOT SET')}")
    print(f"  PROJECT_ID: {os.environ.get('PROJECT_ID', 'NOT SET')}")
    print(f"  STORAGE_BASE: {os.environ.get('STORAGE_BASE', 'NOT SET')}")
    print(f"  STORAGE_ENDPOINT: {os.environ.get('STORAGE_ENDPOINT', 'NOT SET')}")
    print()
    print("Parameters JSON:")
    print(os.environ.get('PARAMETERS_JSON', 'NOT SET'))
    print()
    print("=" * 80)
    print()

    try:
        # Import and run the original runner
        import runner
        runner.main()

    except Exception:
        # Get exception info for post-mortem debugging
        exc_type, exc_value, exc_tb = sys.exc_info()

        print()
        print("=" * 80)
        print("ERROR OCCURRED - Entering pdb post-mortem")
        print("=" * 80)
        print()
        print(f"Exception type: {exc_type.__name__}")
        print(f"Exception message: {str(exc_value)}")
        print()
        print("Full traceback:")
        traceback.print_exception(exc_type, exc_value, exc_tb)
        print()
        print("=" * 80)
        print("Starting pdb post-mortem debugger...")
        print("Commands:")
        print("  w        - show current stack frame")
        print("  u        - move up one stack frame")
        print("  d        - move down one stack frame")
        print("  l        - list code around current line")
        print("  p <var>  - print variable value")
        print("  pp <var> - pretty-print variable value")
        print("  bt       - show full traceback")
        print("  q        - quit debugger")
        print("=" * 80)
        print()
        sys.stdout.flush()
        sys.stderr.flush()

        # Ensure we have a proper traceback for post-mortem
        try:
            pdb.post_mortem(exc_tb)
        except Exception as pdb_error:
            print(f"Failed to start pdb: {pdb_error}")
            print("Dropping to interactive shell instead...")
            import code
            code.interact(local=locals())

        sys.exit(1)

if __name__ == '__main__':
    main()
