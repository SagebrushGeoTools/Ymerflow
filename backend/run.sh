#!/bin/bash

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
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
uvicorn main:app --reload
