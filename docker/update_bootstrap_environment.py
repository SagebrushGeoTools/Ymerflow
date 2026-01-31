#!/usr/bin/env python3
"""
Update the bootstrap environment's process_types in the database.

This script is called by docker/build.sh after building the base-runner image
to populate the bootstrap environment with discovered process types.

Usage:
    python docker/update_bootstrap_environment.py <process_schemas_json>
"""

import sys
import json
import os
from datetime import datetime
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

# Bootstrap environment ID (constant used across migrations)
BOOTSTRAP_ENV_ID = 'default-environment-00000000-0000-0000-0000-000000000000'


def get_database_url():
    """Get database URL from environment variable or use default."""
    return os.getenv('DATABASE_URL', 'sqlite:///./nagelfluh.db')


def update_bootstrap_environment(process_types):
    """Update or create the bootstrap environment with process types."""
    database_url = get_database_url()

    # Create synchronous engine (not async)
    engine = create_engine(database_url, echo=False)
    Session = sessionmaker(bind=engine)

    with Session() as session:
        # Check if bootstrap environment exists
        result = session.execute(
            text("SELECT COUNT(*) FROM environments WHERE id = :id"),
            {"id": BOOTSTRAP_ENV_ID}
        )
        exists = result.scalar() > 0

        if exists:
            # Update existing bootstrap environment
            print(f"Updating existing bootstrap environment: {BOOTSTRAP_ENV_ID}")
            session.execute(
                text("""
                    UPDATE environments
                    SET process_types = :process_types
                    WHERE id = :id
                """),
                {
                    "id": BOOTSTRAP_ENV_ID,
                    "process_types": json.dumps(process_types)
                }
            )
        else:
            # Create new bootstrap environment
            print(f"Creating new bootstrap environment: {BOOTSTRAP_ENV_ID}")
            now = datetime.utcnow().isoformat()
            session.execute(
                text("""
                    INSERT INTO environments (id, name, docker_image, process_id, process_types, created_at)
                    VALUES (:id, :name, :docker_image, NULL, :process_types, :created_at)
                """),
                {
                    "id": BOOTSTRAP_ENV_ID,
                    "name": "Bootstrap Environment",
                    "docker_image": "nagelfluh-base-runner:latest",
                    "process_types": json.dumps(process_types),
                    "created_at": now
                }
            )

        session.commit()

        # Verify the update
        result = session.execute(
            text("SELECT name, docker_image, process_types FROM environments WHERE id = :id"),
            {"id": BOOTSTRAP_ENV_ID}
        )
        row = result.fetchone()

        if row:
            stored_types = json.loads(row[2]) if row[2] else {}
            print(f"✓ Bootstrap environment updated successfully")
            print(f"  Name: {row[0]}")
            print(f"  Image: {row[1]}")
            print(f"  Process types: {list(stored_types.keys())}")
        else:
            print("✗ Failed to update bootstrap environment")
            sys.exit(1)


def main():
    if len(sys.argv) < 2:
        print("Usage: python docker/update_bootstrap_environment.py <process_schemas_json>")
        print("  process_schemas_json: JSON string or path to JSON file")
        sys.exit(1)

    process_schemas_arg = sys.argv[1]

    # Try to parse as JSON string first, then try as file path
    try:
        process_types = json.loads(process_schemas_arg)
    except json.JSONDecodeError:
        # Try reading as file path
        try:
            with open(process_schemas_arg, 'r') as f:
                process_types = json.load(f)
        except Exception as e:
            print(f"Error: Could not parse argument as JSON or read as file: {e}")
            sys.exit(1)

    print(f"Updating bootstrap environment with {len(process_types)} process type(s)...")
    update_bootstrap_environment(process_types)


if __name__ == "__main__":
    main()
