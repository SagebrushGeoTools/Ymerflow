from sqlalchemy import Column, String, DateTime, JSON, Integer, ForeignKey, Enum, Index, UniqueConstraint, Text
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid
import enum

from backend.database import Base


class ProcessState(str, enum.Enum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class Process(Base):
    __tablename__ = "processes"

    id = Column(String(255), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), nullable=False)
    type = Column(String(100), nullable=False)
    environment_id = Column(String(255), ForeignKey("environments.id", ondelete="CASCADE"), nullable=False, index=True)
    project_id = Column(String(255), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    environment = relationship("Environment", back_populates="processes")
    project = relationship("Project", back_populates="processes")
    versions = relationship("ProcessVersion", back_populates="process", cascade="all, delete-orphan", order_by="ProcessVersion.version")
    logs = relationship("ProcessLog", back_populates="process", cascade="all, delete-orphan")

    def to_dict(self):
        """Convert to API response format"""
        return {
            "id": self.id,
            "name": self.name,
            "type": self.type,
            "environment_id": self.environment_id,
            "project_id": self.project_id,
            "versions": [v.to_dict() for v in sorted(self.versions, key=lambda x: x.version)]
        }


class ProcessVersion(Base):
    __tablename__ = "process_versions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    process_id = Column(String(255), ForeignKey("processes.id", ondelete="CASCADE"), nullable=False, index=True)
    version = Column(Integer, nullable=False)
    parameters = Column(JSON, nullable=False)  # Process parameters
    outputs = Column(JSON, default=dict, nullable=False)  # {output_name: dataset_url}
    state = Column(Enum(ProcessState), default=ProcessState.QUEUED, nullable=False, index=True)
    dependencies = Column(JSON, default=list, nullable=False)  # Array of dependency objects
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    process = relationship("Process", back_populates="versions")

    # Constraints
    __table_args__ = (
        UniqueConstraint('process_id', 'version', name='uq_process_version'),
    )

    def to_dict(self):
        """Convert to API response format"""
        # Get logs for this version
        logs = [log.to_dict() for log in sorted(
            [l for l in self.process.logs if l.version == self.version],
            key=lambda x: x.timestamp
        )]

        return {
            "version": self.version,
            "parameters": self.parameters,
            "outputs": self.outputs,
            "state": self.state.value,
            "logs": logs,
            "dependencies": self.dependencies
        }


class ProcessLog(Base):
    __tablename__ = "process_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    process_id = Column(String(255), ForeignKey("processes.id", ondelete="CASCADE"), nullable=False, index=True)
    version = Column(Integer, nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    message = Column(Text, nullable=False)

    # Relationships
    process = relationship("Process", back_populates="logs")

    # Composite index for efficient log retrieval
    __table_args__ = (
        Index('ix_process_log_lookup', 'process_id', 'version', 'timestamp'),
    )

    def to_dict(self):
        """Convert to API response format"""
        return {
            "timestamp": self.timestamp.isoformat(),
            "message": self.message
        }
