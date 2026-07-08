from sqlalchemy import Column, String, DateTime, JSON
from datetime import datetime
import uuid

from backend.database import Base

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

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "registry_url": self.registry_url,
            "namespace": self.namespace,
            "created_at": self.created_at.isoformat(),
        }


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
