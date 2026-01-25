from sqlalchemy import Column, String, DateTime
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid

from backend.database import Base


class Project(Base):
    __tablename__ = "projects"

    id = Column(String(255), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    processes = relationship("Process", back_populates="project", cascade="all, delete-orphan")
    datasets = relationship("Dataset", back_populates="project", cascade="all, delete-orphan")

    def to_dict(self):
        """Convert to API response format"""
        return {
            "id": self.id,
            "name": self.name,
            "created_at": self.created_at.isoformat()
        }
