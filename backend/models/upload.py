from sqlalchemy import Column, String, DateTime
from datetime import datetime
import uuid

from backend.database import Base


class Upload(Base):
    __tablename__ = "uploads"

    id = Column(String(255), primary_key=True, default=lambda: str(uuid.uuid4()))
    filename = Column(String(500), nullable=False)
    content_type = Column(String(255), nullable=False)
    file_url = Column(String(500), nullable=False)  # fsspec URL to file
    uploaded_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    def to_dict(self):
        """Convert to API response format"""
        return {
            "id": self.id,
            "filename": self.filename,
            "content_type": self.content_type,
            "uploaded_at": self.uploaded_at.isoformat()
        }
