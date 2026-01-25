from sqlalchemy import Column, String, DateTime, JSON
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid

from backend.database import Base


class Environment(Base):
    __tablename__ = "environments"

    id = Column(String(255), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), nullable=False)
    docker_image = Column(String(255), nullable=False)
    packages = Column(JSON, nullable=False)  # List of {name, version}
    process_types = Column(JSON, nullable=False)  # Process type schemas
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    processes = relationship("Process", back_populates="environment")

    def to_dict(self):
        """Convert to API response format"""
        return {
            "id": self.id,
            "name": self.name,
            "docker_image": self.docker_image,
            "packages": self.packages,
            "process_types": self.process_types,
            "created_at": self.created_at.isoformat()
        }
