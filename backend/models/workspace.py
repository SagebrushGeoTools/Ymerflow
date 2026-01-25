from sqlalchemy import Column, String, DateTime, JSON
from datetime import datetime

from backend.database import Base


class Workspace(Base):
    __tablename__ = "workspaces"

    id = Column(String(255), primary_key=True)  # Allow custom IDs like "default"
    title = Column(String(255), nullable=False)
    layout = Column(JSON, nullable=False)  # Flexout layout tree structure
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    def to_dict(self, include_layout=True):
        """Convert to API response format"""
        result = {
            "id": self.id,
            "title": self.title,
            "created_at": self.created_at.isoformat()
        }
        if include_layout:
            result["layout"] = self.layout
        return result
