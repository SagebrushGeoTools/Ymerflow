from sqlalchemy import Column, String, DateTime, JSON, Integer, Boolean, select
from datetime import datetime
import uuid

from backend.database import Base

DEFAULT_STORAGE_BACKEND_ID = 'f51f2357-277c-4128-806c-61d7dad491e7'


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
    sort_order = Column(Integer, nullable=False, default=0)
    active = Column(Boolean, nullable=False, default=True)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "protocol": self.protocol,
            "endpoint": self.endpoint,
            "bucket_prefix": self.bucket_prefix,
            "credential_strategy": self.credential_strategy,
            "created_at": self.created_at.isoformat(),
            "sort_order": self.sort_order,
            "active": self.active,
        }


async def get_default_storage_backend_id(db) -> str:
    """The storage backend a new project is assigned by default: the first active backend
    ordered by sort_order. Raises if none are active — a project cannot be created without a
    storage backend to provision against."""
    stmt = select(StorageBackend).where(StorageBackend.active == True).order_by(StorageBackend.sort_order)
    result = await db.execute(stmt)
    backend = result.scalars().first()
    if backend is None:
        raise RuntimeError("No active storage backend configured — cannot create a project")
    return backend.id
