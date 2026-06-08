from sqlalchemy import Column, String, DateTime, Integer, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid

from backend.database import Base


class ApiKey(Base):
    __tablename__ = "api_keys"

    id = Column(String(255), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    project_id = Column(String(255), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    label = Column(String(255), nullable=False)
    key_hash = Column(String(255), unique=True, nullable=False)  # SHA-256 hex of raw key
    expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    last_used_at = Column(DateTime, nullable=True)

    user = relationship("User", back_populates="api_keys")
    project = relationship("Project", back_populates="api_keys")

    def to_dict(self):
        return {
            "id": self.id,
            "label": self.label,
            "project_id": self.project_id,
            "project_name": self.project.name if self.project else None,
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "created_at": self.created_at.isoformat(),
            "last_used_at": self.last_used_at.isoformat() if self.last_used_at else None,
        }
