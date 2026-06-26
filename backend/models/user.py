from sqlalchemy import Column, Integer, String, DateTime, JSON, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime

from backend.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(255), unique=True, nullable=False, index=True)
    email = Column(String(255), unique=True, nullable=True, index=True)
    password_hash = Column(String(255), nullable=False)
    is_admin = Column(Boolean, default=False, nullable=False, server_default="0")
    preferences = Column(JSON, default=dict, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    project_memberships = relationship("ProjectMember", back_populates="user", cascade="all, delete-orphan")
    api_keys = relationship("ApiKey", back_populates="user", cascade="all, delete-orphan")

    def to_dict(self, include_password=False):
        result = {
            "username": self.username,
            "email": self.email,
            "is_admin": self.is_admin,
            "preferences": self.preferences,
        }
        try:
            from backend.hooks import hooks
            for extra in hooks.run.user_to_dict(self):
                result.update(extra)
        except Exception:
            pass
        if include_password:
            result["password"] = self.password_hash
        return result
