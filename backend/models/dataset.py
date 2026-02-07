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
    process_version_id = Column(Integer, ForeignKey("process_versions.id", ondelete="CASCADE"), nullable=False, index=True)
    dataset_name = Column(String(255), nullable=False, index=True)
    project_id = Column(String(255), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    parts = Column(JSON, default=dict, nullable=False)  # New: {files: {mime_type: url}, part_name: {files: {mime_type: url}}} | Old: {part_name: {mime_type, file_url, geography_url}}
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    project = relationship("Project", back_populates="datasets")
    process_version = relationship("ProcessVersion", foreign_keys=[process_version_id], back_populates="datasets")

    # Composite index for search
    __table_args__ = (
        Index('ix_dataset_search', 'project_id', 'process_name', 'dataset_name'),
    )

    def to_dict(self, include_storage_urls: bool = False):
        """Convert to API response format.

        Note: Requires self.process_version to be eagerly loaded to avoid greenlet errors.
        Use selectinload(Dataset.process_version) when querying.

        Args:
            include_storage_urls: If True, include storage URLs in parts for pods.
                                 If False (default), translate to HTTP URLs for frontend.
        """
        from backend.services.storage_service import translate_urls_in_dict, storage_url_to_http_url

        # Translate storage URLs to HTTP URLs for frontend
        parts = self.parts
        files = self.parts.get("files", {})

        if not include_storage_urls:
            # Translate storage URLs to HTTP URLs for frontend
            parts = translate_urls_in_dict(parts, self.project_id, to_storage=False)
            # Also translate files dict if present (new format)
            if files:
                files = {
                    mime_type: storage_url_to_http_url(url) if not url.startswith('http') else url
                    for mime_type, url in files.items()
                }

        # Get URL from new format (top-level files) or old format (root part)
        url = None
        if files and self.mime_type in files:
            # New format: get from top-level files
            if include_storage_urls:
                url = self.parts.get("files", {}).get(self.mime_type)
            else:
                url = files.get(self.mime_type)
        else:
            # Old format: get from root part (empty string key) file_url
            root_part = parts.get("")
            if root_part and root_part.get("file_url"):
                url = root_part["file_url"]

        result = {
            "id": self.id,
            "mime_type": self.mime_type,
            "process_id": self.process_id,
            "process_name": self.process_name,
            "process_version": self.process_version.version,
            "dataset_name": self.dataset_name,
            "project_id": self.project_id,
            "parts": parts,
            "url": url
        }

        # Include top-level files if present (new format)
        if files:
            result["files"] = files

        return result

    @classmethod
    async def resolve_dependencies(cls, db: AsyncSession, dependencies: list) -> list:
        """Resolve dataset IDs to full dependency objects"""
        from sqlalchemy.orm import selectinload

        resolved = []

        for dep in dependencies:
            dataset_id = dep.get("source_dataset_id")
            if dataset_id:
                stmt = select(cls).options(
                    selectinload(cls.process_version)
                ).where(cls.id == dataset_id)
                result = await db.execute(stmt)
                dataset = result.scalar_one_or_none()

                if dataset:
                    resolved.append({
                        "source_process_id": dataset.process_id,
                        "source_process_version": dataset.process_version.version,
                        "source_dataset_name": dataset.dataset_name,
                        "target_param_name": dep["target_param_name"]
                    })

        return resolved
