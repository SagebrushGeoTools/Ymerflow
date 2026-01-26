#!/bin/bash

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Change to parent directory so Python can find the 'backend' module
cd "$SCRIPT_DIR/.."

# Activate virtual environment if it exists
if [ -d "env" ]; then
    source env/bin/activate
fi

# Run database migrations
echo "Running database migrations..."
alembic -c backend/alembic.ini upgrade head

# Start the server
echo "Starting Nagelfluh server..."
uvicorn backend.main:app --reload
