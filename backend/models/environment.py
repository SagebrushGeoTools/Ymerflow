from sqlalchemy import Column, String, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid

from backend.database import Base


class Environment(Base):
    __tablename__ = "environments"

    id = Column(String(255), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), nullable=False)
    docker_image = Column(String(255), nullable=False)
    process_id = Column(String(255), ForeignKey("processes.id", ondelete="CASCADE"), nullable=True, index=True)
    process_types = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    # Processes that use this environment (via Process.environment_id)
    processes = relationship("Process", back_populates="environment", foreign_keys="Process.environment_id")
    # The process that created this environment (via Environment.process_id)
    creating_process = relationship("Process", foreign_keys=[process_id], uselist=False)

    def to_dict(self):
        """Convert to API response format"""
        return {
            "id": self.id,
            "name": self.name,
            "docker_image": self.docker_image,
            "process_id": self.process_id,
            "process_types": self.process_types,
            "created_at": self.created_at.isoformat()
        }
