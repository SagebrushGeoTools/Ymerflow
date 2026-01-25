#!/bin/bash

# Activate virtual environment if it exists
if [ -d "env" ]; then
    source env/bin/activate
fi

# Run database migrations
echo "Running database migrations..."
alembic upgrade head

# Start the server
echo "Starting Nagelfluh server..."
uvicorn backend.main:app --reload
