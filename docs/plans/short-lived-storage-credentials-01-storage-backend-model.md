# Short-Lived, Per-Project Storage Credentials — Phase 1: `StorageBackend` model + bootstrap migration

Part of [short-lived-storage-credentials-00-overview.md](short-lived-storage-credentials-00-overview.md) — read that first for
goal, background, and architecture summary. This is Phase 1 of 4; no dependencies on other phases.

Pure schema + data migration; no behavior change (everything still resolves to the one bootstrap
row created here).

## 1.1 Model

**New file: `backend/models/storage_backend.py`**

```python
from sqlalchemy import Column, String, DateTime, JSON
from datetime import datetime
import uuid

from backend.database import Base


class StorageBackend(Base):
    __tablename__ = "storage_backends"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), nullable=False)
    protocol = Column(String(32), nullable=False)          # s3, gcs, az, file
    endpoint = Column(String(255), nullable=True)           # MinIO URL; empty for real cloud
    bucket_prefix = Column(String(255), nullable=False)
    credential_strategy = Column(String(32), nullable=False, default="static-key")
    # Strategy-specific connection config (e.g. MinIO admin alias, GCP SA email to
    # impersonate, AWS role ARN). Opaque to everything except the strategy implementation.
    config = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "protocol": self.protocol,
            "endpoint": self.endpoint,
            "bucket_prefix": self.bucket_prefix,
            "credential_strategy": self.credential_strategy,
            "created_at": self.created_at.isoformat(),
        }
```

Add `Project.storage_backend_id` (nullable FK, `backend/models/project.py`):

```python
storage_backend_id = Column(String(36), ForeignKey("storage_backends.id"), nullable=True)
storage_backend = relationship("StorageBackend")
```

Nullable because historical rows are backfilled in a second step (1.2), not because it's ever
expected to be unset for a project going forward.

## 1.2 Bootstrap migration

Follows the same pattern as `3e9d7f5a8c2d_add_bootstrap_environment.py` (fixed well-known UUID,
idempotency check) and `e2f3a4b5c6d7_seed_initial_admin.py` (`from backend.config import
settings` read live inside `upgrade()`):

```python
"""seed default storage backend from config.env"""
from alembic import op
import sqlalchemy as sa
from datetime import datetime
import os

revision = '<new>'
down_revision = '<add_storage_backends_table>'

DEFAULT_ID = 'default-storage-backend-00000000-0000-0000-0000-000000000000'


def upgrade() -> None:
    from backend.config import settings
    conn = op.get_bind()

    exists = conn.execute(
        sa.text("SELECT COUNT(*) FROM storage_backends WHERE id = :id"),
        {"id": DEFAULT_ID},
    ).scalar()

    if not exists:
        conn.execute(sa.text("""
            INSERT INTO storage_backends
                (id, name, protocol, endpoint, bucket_prefix, credential_strategy, config, created_at)
            VALUES
                (:id, 'Default Storage Backend', :protocol, :endpoint, :bucket_prefix,
                 'static-key', '{}', :created_at)
        """), {
            "id": DEFAULT_ID,
            "protocol": settings.storage_protocol,
            "endpoint": settings.storage_endpoint,
            "bucket_prefix": settings.storage_bucket_prefix,
            "created_at": datetime.utcnow().isoformat(),
        })

    conn.execute(sa.text("""
        UPDATE projects SET storage_backend_id = :id WHERE storage_backend_id IS NULL
    """), {"id": DEFAULT_ID})


def downgrade() -> None:
    pass  # cannot cleanly undo a backfill
```

This matches `config.env` in every environment because `settings` reads real environment
variables (with `config.env` only as local-dev fallback) — the same values the running backend
already uses today, in dev and in prod-minikube (where the k8s ConfigMap overrides
`STORAGE_ENDPOINT` / `STORAGE_PROTOCOL`).

**Existing projects are backfilled to this row in the same migration** — `storage_backend_id` is a
new FK on a table with live data, unlike per-job fields, so it cannot be left `NULL` for rows that
already have a working bucket.

## Next

Once this phase lands, continue with
[short-lived-storage-credentials-02-hooks-run-first-select-storage.md](short-lived-storage-credentials-02-hooks-run-first-select-storage.md).
