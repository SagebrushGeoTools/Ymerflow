from sqlalchemy import Column, String, DateTime, JSON, Integer, Boolean, select
from datetime import datetime
import uuid

from backend.database import Base
from backend.hooks import hooks

DEFAULT_CLUSTER_ID = 'default-cluster-00000000-0000-0000-0000-000000000000'


class Cluster(Base):
    __tablename__ = "clusters"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), nullable=False)
    # NULL kubeconfig = auto-detect (in-cluster config or local kubeconfig), matching
    # K8sClient's pre-multi-cluster behavior exactly.
    kubeconfig = Column(JSON, nullable=True)
    registry_url = Column(String(255), nullable=True)
    registry_auth = Column(String(255), nullable=True)
    namespace = Column(String(255), nullable=False, default="nagelfluh-jobs")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    sort_order = Column(Integer, nullable=False, default=0)
    active = Column(Boolean, nullable=False, default=True)
    max_runtime_seconds = Column(Integer, nullable=True)  # NULL = unbounded

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "registry_url": self.registry_url,
            "namespace": self.namespace,
            "created_at": self.created_at.isoformat(),
            "sort_order": self.sort_order,
            "active": self.active,
            "max_runtime_seconds": self.max_runtime_seconds,
        }


async def get_allowed_clusters(db, user, project_id=None, resource_requests=None) -> list:
    """Resolve the set of clusters `user` is allowed to run on, sorted by sort_order.

    If no select_clusters plugins are registered, every active cluster is allowed. If
    plugins are registered, their union of allowed cluster ids is the allowed set — an
    empty union means no clusters are allowed, not a fallback to "all active".
    """
    if hooks.any_registered("select_clusters"):
        allowed_ids = set(hooks.run.select_clusters(db, user, project_id, resource_requests))
        stmt = select(Cluster).where(Cluster.id.in_(allowed_ids), Cluster.active == True)
    else:
        stmt = select(Cluster).where(Cluster.active == True)
    stmt = stmt.order_by(Cluster.sort_order)
    result = await db.execute(stmt)
    return result.scalars().all()


async def get_cluster_for_process_version(db, process_version) -> "Cluster":
    """Resolve the Cluster a job ran/will run on. process_version.k8s_cluster_id is NULL on
    any row created before this column existed — those fall back to the bootstrap default
    cluster, which is exactly the single cluster they actually ran on."""
    from sqlalchemy import select

    cluster_id = process_version.k8s_cluster_id or DEFAULT_CLUSTER_ID
    stmt = select(Cluster).where(Cluster.id == cluster_id)
    result = await db.execute(stmt)
    cluster = result.scalar_one_or_none()
    if cluster is None:
        raise ValueError(f"Cluster not found: {cluster_id}")
    return cluster
