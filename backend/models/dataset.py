from sqlalchemy import Column, String, DateTime, JSON, Integer, ForeignKey, Index, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid

from backend.database import Base


class Dataset(Base):
    __tablename__ = "datasets"

    id = Column(String(255), primary_key=True, default=lambda: str(uuid.uuid4()))
    mime_type = Column(String(255), nullable=False)
    process_id = Column(String(255), ForeignKey("processes.id", ondelete="CASCADE"), nullable=False, index=True)
    process_name = Column(String(255), nullable=False, index=True)  # Denormalized for search
    process_version = Column(Integer, nullable=False)
    dataset_name = Column(String(255), nullable=False, index=True)
    project_id = Column(String(255), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    parts = Column(JSON, default=dict, nullable=False)  # {part_name: {mime_type, file_url}}
    file_url = Column(String(500), nullable=True)  # Root-level data file URL
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    project = relationship("Project", back_populates="datasets")

    # Composite index for search
    __table_args__ = (
        Index('ix_dataset_search', 'project_id', 'process_name', 'dataset_name'),
    )

    def to_dict(self):
        """Convert to API response format"""
        return {
            "id": self.id,
            "mime_type": self.mime_type,
            "process_id": self.process_id,
            "process_name": self.process_name,
            "process_version": self.process_version,
            "dataset_name": self.dataset_name,
            "project_id": self.project_id,
            "parts": self.parts
        }

    @classmethod
    async def resolve_dependencies(cls, db: AsyncSession, dependencies: list) -> list:
        """Resolve dataset IDs to full dependency objects"""
        resolved = []

        for dep in dependencies:
            dataset_id = dep.get("source_dataset_id")
            if dataset_id:
                stmt = select(cls).where(cls.id == dataset_id)
                result = await db.execute(stmt)
                dataset = result.scalar_one_or_none()

                if dataset:
                    resolved.append({
                        "source_process_id": dataset.process_id,
                        "source_process_version": dataset.process_version,
                        "source_dataset_name": dataset.dataset_name,
                        "target_param_name": dep["target_param_name"]
                    })

        return resolved
