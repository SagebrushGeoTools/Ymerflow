from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from datetime import datetime

from backend.database import Base


class ProjectMember(Base):
    __tablename__ = "project_members"

    id = Column(Integer, primary_key=True, autoincrement=True)
    project_id = Column(String(255), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role = Column(String(50), nullable=False, default="member")  # "admin" | "member"
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (UniqueConstraint("project_id", "user_id", name="uq_project_member"),)

    project = relationship("Project", back_populates="members")
    user = relationship("User", back_populates="project_memberships")

    def to_dict(self):
        return {
            "user_id": self.user_id,
            "username": self.user.username if self.user else None,
            "role": self.role,
            "created_at": self.created_at.isoformat(),
        }
