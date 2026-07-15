from sqlalchemy import Column, String, DateTime, JSON, Integer, Boolean, select
from datetime import datetime
import uuid

from backend.database import Base

DEFAULT_REGISTRY_BACKEND_ID = 'default-registry-backend-00000000-0000-0000-0000-000000000000'


class RegistryBackend(Base):
    __tablename__ = "registry_backends"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), nullable=False)
    protocol = Column(String(32), nullable=False)          # docker-v2, gar, ...
    # Protocol-specific connection config (e.g. docker-v2's host/port/user/password, or a
    # plugin-provided protocol's service-account key). Opaque to everything except the
    # RegistryProtocolHandler it dispatches to via `protocol` — see
    # backend/services/registry_protocols/__init__.py.
    config = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    sort_order = Column(Integer, nullable=False, default=0)
    active = Column(Boolean, nullable=False, default=True)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "protocol": self.protocol,
            "created_at": self.created_at.isoformat(),
            "sort_order": self.sort_order,
            "active": self.active,
        }


async def get_default_registry_backend_id(db) -> str:
    """The registry backend used app-wide: the first active backend ordered by sort_order.
    Raises if none are active — mirrors get_default_storage_backend_id(). Preserves the "one
    global registry" decision (docs/plans/done/cluster-registry-global-not-per-cluster.md) as a
    consequence of the model shape, not a hardcoded assumption."""
    stmt = select(RegistryBackend).where(RegistryBackend.active == True).order_by(RegistryBackend.sort_order)
    result = await db.execute(stmt)
    backend = result.scalars().first()
    if backend is None:
        raise RuntimeError("No active registry backend configured")
    return backend.id
