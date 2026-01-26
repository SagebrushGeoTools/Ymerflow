#!/bin/bash

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

# Set PYTHONPATH to include project root so backend module can be found
export PYTHONPATH="$PROJECT_ROOT:$PYTHONPATH"

cd "$SCRIPT_DIR"

# Activate virtual environment if it exists (one level up)
if [ -d "../env" ]; then
    source ../env/bin/activate
fi

# Run database migrations
echo "Running database migrations..."
alembic -c alembic.ini upgrade head

# Start the server
echo "Starting Nagelfluh server..."
uvicorn backend.main:app --reload --app-dir "$PROJECT_ROOT"
