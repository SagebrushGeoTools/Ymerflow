from sqlalchemy import Column, String, DateTime, JSON, Integer, ForeignKey, Enum, Index, UniqueConstraint, Text, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import relationship
from datetime import datetime
from typing import Dict, Any, Optional
from decimal import Decimal
import uuid
import enum
import asyncio

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

    @staticmethod
    def extract_dependencies(params: Dict[str, Any]) -> list:
        """Extract dataset URLs from params and build dependency list"""
        dependencies = []

        def find_dataset_urls(obj, path=""):
            """Recursively find dataset URLs in nested structures"""
            if isinstance(obj, str):
                if obj.startswith("http://localhost:8000/dataset/"):
                    # Extract dataset_id from URL
                    dataset_id = obj.split("/")[-1]
                    dependencies.append({
                        "source_dataset_id": dataset_id,
                        "target_param_name": path
                    })
            elif isinstance(obj, dict):
                for key, value in obj.items():
                    new_path = f"{path}.{key}" if path else key
                    find_dataset_urls(value, new_path)
            elif isinstance(obj, list):
                for i, item in enumerate(obj):
                    new_path = f"{path}[{i}]"
                    find_dataset_urls(item, new_path)

        find_dataset_urls(params)
        return dependencies

    @classmethod
    async def create_with_outputs(
        cls,
        db: AsyncSession,
        proc: Dict[str, Any],
        project_id: str,
        environment_id: str,
        username: str
    ) -> "Process":
        """
        Create a process (outputs will be created when process completes)

        Args:
            db: Database session
            proc: Process data dict
            project_id: Project ID
            environment_id: Environment ID
            username: Username for billing

        Returns:
            Created/updated Process object
        """
        from backend.models import Dataset, User, UserTransaction, TransactionType
        from backend.config import settings
        from fastapi import HTTPException

        # Deduct cost from user balance
        stmt = select(User).where(User.username == username)
        result = await db.execute(stmt)
        user = result.scalar_one_or_none()

        if not user:
            raise HTTPException(status_code=401, detail="User not found")

        if user.balance < Decimal(str(settings.process_cost)):
            raise HTTPException(status_code=402, detail="Insufficient balance")

        user.balance -= Decimal(str(settings.process_cost))

        # Check if this is a new version of an existing process
        existing_id = proc.get("id")
        process = None

        if existing_id:
            stmt = select(Process).where(Process.id == existing_id)
            result = await db.execute(stmt)
            process = result.scalar_one_or_none()

        if process:
            # Adding new version to existing process
            new_version = len(process.versions) + 1
        else:
            # Creating new process
            process = Process(
                id=str(uuid.uuid4()),
                name=proc.get("name", f"{proc['type']}-process"),
                type=proc["type"],
                environment_id=environment_id,
                project_id=project_id
            )
            db.add(process)
            new_version = 1

        # Extract and resolve dependencies
        params = proc.get("params", {})
        raw_dependencies = cls.extract_dependencies(params)
        dependencies = await Dataset.resolve_dependencies(db, raw_dependencies)

        # Create version object with empty outputs (will be populated when process completes)
        version_obj = ProcessVersion(
            process_id=process.id,
            version=new_version,
            parameters=params,
            outputs={},  # Empty - outputs created when process reaches "done" state
            state=ProcessState.QUEUED,
            dependencies=dependencies
        )

        db.add(version_obj)

        # Record transaction for process cost
        transaction = UserTransaction(
            user_id=user.id,
            timestamp=datetime.utcnow(),
            type=TransactionType.DEBIT,
            description=f"Process run: {process.name}",
            amount=Decimal(str(settings.process_cost)),
            process_id=process.id,
            process_version=new_version,
            process_name=process.name
        )
        db.add(transaction)

        await db.commit()

        # Refresh both process and version_obj to ensure they're in sync with DB
        await db.refresh(process)
        await db.refresh(version_obj)

        # Broadcast initial queued state (without committing again since state is already QUEUED)
        from backend.services.websocket_service import ws_manager
        state_update = {
            "process_id": process.id,
            "version": new_version,
            "state": ProcessState.QUEUED.value
        }
        await ws_manager.broadcast_state(state_update)

        # Start background task
        asyncio.create_task(version_obj.run_task())

        return process


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

    async def update_state(self, db: AsyncSession, new_state: ProcessState, outputs: Optional[Dict[str, str]] = None):
        """Update process state and broadcast to all state listeners

        Args:
            db: Database session
            new_state: New process state
            outputs: Optional dict of outputs to include when transitioning to DONE state
        """
        import logging
        from backend.services.websocket_service import ws_manager

        logger = logging.getLogger(__name__)

        logger.info(f"Updating process state: {self.process_id} v{self.version} -> {new_state.value}")
        self.state = new_state

        # Update outputs if provided (typically when transitioning to DONE)
        if outputs is not None:
            self.outputs = outputs

        await db.commit()

        # Broadcast state change to all connected clients
        state_update = {
            "process_id": self.process_id,
            "version": self.version,
            "state": new_state.value
        }

        # Include outputs in broadcast when transitioning to DONE
        if new_state == ProcessState.DONE and self.outputs:
            state_update["outputs"] = self.outputs

        logger.info(f"Broadcasting state update: {state_update}")
        await ws_manager.broadcast_state(state_update)

    async def add_log_entry(self, db: AsyncSession, message: str):
        """Add a log entry and broadcast to connected clients"""
        log_entry = ProcessLog(
            process_id=self.process_id,
            version=self.version,
            timestamp=datetime.utcnow(),
            message=message
        )

        db.add(log_entry)
        await db.commit()

        # Broadcast to connected WebSocket clients
        from backend.services.websocket_service import ws_manager
        await ws_manager.broadcast_log(self.process_id, log_entry.to_dict())

    async def run_task(self):
        """Simulate running a process with fake log messages"""
        import logging
        from backend.database import async_session_maker

        logger = logging.getLogger(__name__)
        logger.info(f"🚀 Starting process task: {self.process_id} v{self.version}")

        try:
            # Wait a moment to simulate queue time
            await asyncio.sleep(1)

            async with async_session_maker() as db:
                # Fetch the process version and process
                stmt = select(ProcessVersion).where(
                    ProcessVersion.process_id == self.process_id,
                    ProcessVersion.version == self.version
                )
                result = await db.execute(stmt)
                process_version = result.scalar_one_or_none()

                if not process_version:
                    logger.error(f"Process version not found: {self.process_id} v{self.version}")
                    return

                # Fetch process for metadata
                stmt = select(Process).where(Process.id == self.process_id)
                result = await db.execute(stmt)
                process = result.scalar_one_or_none()

                if not process:
                    logger.error(f"Process not found: {self.process_id}")
                    return

                # Transition to running
                logger.info(f"▶️ Transitioning to RUNNING: {self.process_id} v{self.version}")
                await process_version.update_state(db, ProcessState.RUNNING)
                await process_version.add_log_entry(db, "Process started")

                # Simulate processing with realistic log messages
                log_messages = [
                    "Initializing processing environment...",
                    "Loading input datasets...",
                    "Validating input parameters...",
                    "Setting up computation pipeline...",
                    "Processing data chunks (1/5)...",
                    "Processing data chunks (2/5)...",
                    "Processing data chunks (3/5)...",
                    "Processing data chunks (4/5)...",
                    "Processing data chunks (5/5)...",
                    "Aggregating results...",
                    "Generating output datasets..."
                ]

                for msg in log_messages:
                    await asyncio.sleep(0.4)  # Simulate work
                    await process_version.add_log_entry(db, msg)

                # Create output datasets now that processing is complete
                logger.info(f"📦 Creating output datasets for: {self.process_id} v{self.version}")
                outputs = await self._create_outputs(db, process, process_version)

                await process_version.add_log_entry(db, "Process completed successfully")

                # Transition to done with outputs
                logger.info(f"✅ Transitioning to DONE: {self.process_id} v{self.version}")
                await process_version.update_state(db, ProcessState.DONE, outputs=outputs)
                logger.info(f"✅ Process task completed: {self.process_id} v{self.version}")
        except Exception as e:
            logger.error(f"❌ Process task failed: {self.process_id} v{self.version} - {str(e)}", exc_info=True)

    async def _create_outputs(self, db: AsyncSession, process: "Process", process_version: "ProcessVersion") -> Dict[str, str]:
        """Create output datasets for a completed process

        Args:
            db: Database session
            process: Process object
            process_version: ProcessVersion object

        Returns:
            Dict mapping output names to dataset URLs
        """
        from backend.models import Dataset
        from backend.services.file_service import write_file, get_dataset_file_url
        from backend.utils.xyz_utils import create_mock_xyz, xyz_to_msgpack, extract_xyz_part
        import pandas as pd

        outputs = {}
        output_names = ["output", "processed"]  # Default output names

        for output_name in output_names:
            dataset_id = str(uuid.uuid4())

            # Create XYZ dataset with msgpack format
            xyz_data = create_mock_xyz(process_type=process.type)
            msgpack_data = xyz_to_msgpack(xyz_data)

            # Store XYZ data to file
            file_url = get_dataset_file_url(dataset_id)
            await write_file(file_url, msgpack_data)

            # Create parts structure from unique values in "title" column
            parts = {}
            if "title" in xyz_data["xyz"].flightlines.columns:
                unique_titles = xyz_data["xyz"].flightlines["title"].unique()
                for title in unique_titles:
                    # Convert numpy types to Python native types for JSON serialization
                    title_str = str(title) if pd.notna(title) else "unknown"
                    part_file_url = get_dataset_file_url(dataset_id, title_str)

                    # Extract and save part data
                    part_xyz = extract_xyz_part(xyz_data, title_str)
                    if part_xyz:
                        part_msgpack = xyz_to_msgpack(part_xyz)
                        await write_file(part_file_url, part_msgpack)

                    parts[title_str] = {
                        "mime_type": "application/x-aarhusxyz-msgpack",
                        "file_url": part_file_url
                    }

            dataset = Dataset(
                id=dataset_id,
                mime_type="application/x-aarhusxyz-msgpack",
                process_id=process.id,
                process_name=process.name,
                process_version=process_version.version,
                dataset_name=output_name,
                project_id=process.project_id,
                parts=parts,
                file_url=file_url
            )

            db.add(dataset)
            outputs[output_name] = f"http://localhost:8000/dataset/{dataset_id}"

        await db.commit()
        return outputs


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

    @classmethod
    async def add_entry(cls, db: AsyncSession, process_id: str, version: int, message: str):
        """Add a log entry and broadcast to connected clients"""
        from backend.services.websocket_service import ws_manager

        log_entry = cls(
            process_id=process_id,
            version=version,
            timestamp=datetime.utcnow(),
            message=message
        )

        db.add(log_entry)
        await db.commit()

        # Broadcast to connected WebSocket clients
        await ws_manager.broadcast_log(process_id, log_entry.to_dict())
