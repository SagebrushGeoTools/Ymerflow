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
