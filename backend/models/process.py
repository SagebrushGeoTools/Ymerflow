from sqlalchemy import Column, String, DateTime, JSON, Integer, ForeignKey, Enum, Index, UniqueConstraint, Text, select, Numeric
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import relationship, selectinload
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
    environment = relationship("Environment", back_populates="processes", foreign_keys=[environment_id])
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
                # Match both old format (/dataset/{id}) and new format (/files/.../datasets/{id}/...)
                from backend.config import settings
                dataset_url_prefix = f"{settings.backend_base_url}/dataset/"
                files_url_prefix = f"{settings.backend_base_url}/files/"

                if obj.startswith(dataset_url_prefix):
                    # Old format: extract dataset_id from URL
                    dataset_id = obj.split("/")[-1]
                    dependencies.append({
                        "source_dataset_id": dataset_id,
                        "target_param_name": path
                    })
                elif obj.startswith(files_url_prefix) and "/datasets/" in obj:
                    # New format: extract dataset_id from path
                    import re
                    match = re.search(r'/datasets/([^/]+)/', obj)
                    if match:
                        dataset_id = match.group(1)
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
    async def create_and_enqueue(
        cls,
        db: AsyncSession,
        proc: Dict[str, Any],
        project_id: str,
        environment_id: str,
        username: str
    ) -> "Process":
        """
        Create a process and enqueue it for execution (outputs will be created when process completes)

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
            stmt = select(Process).options(selectinload(Process.versions)).where(Process.id == existing_id)
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

        # Translate HTTP URLs in params to storage URLs before storing
        from backend.services.storage_service import translate_urls_in_dict
        params = translate_urls_in_dict(params, project_id, to_storage=True)

        # Get resource requests from proc data (with defaults)
        resource_requests = proc.get("resource_requests", {
            "cpu": "1000m",
            "memory": "2Gi",
            "ephemeral-storage": "10Gi"
        })
        deadline_seconds = proc.get("deadline_seconds", 3600)

        # Create version object (outputs will be available via datasets relationship)
        version_obj = ProcessVersion(
            process_id=process.id,
            version=new_version,
            parameters=params,
            state=ProcessState.QUEUED,
            dependencies=dependencies,
            resource_requests=resource_requests,
            deadline_seconds=deadline_seconds
        )

        db.add(version_obj)
        await db.flush()  # Flush to populate resource_requests before calculating cost

        # Calculate max cost based on resource requests and deadline
        max_cost = Decimal(str(version_obj._calculate_max_cost()))
        version_obj.max_reserved_cost = max_cost

        # Check available balance (balance minus held amounts)
        available_balance = await user.get_available_balance(db)
        if available_balance < max_cost:
            raise HTTPException(status_code=402, detail=f"Insufficient balance. Required: ${max_cost}, Available: ${available_balance}")

        # Create HOLD transaction (reserve funds)
        transaction = UserTransaction(
            user_id=user.id,
            timestamp=datetime.utcnow(),
            type=TransactionType.HOLD,
            description=f"Hold for process {process.name} v{new_version}",
            amount=max_cost,
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
    state = Column(Enum(ProcessState), default=ProcessState.QUEUED, nullable=False, index=True)
    dependencies = Column(JSON, default=list, nullable=False)  # Array of dependency objects
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # K8s execution fields
    resource_requests = Column(JSON, default=lambda: {"cpu": "1000m", "memory": "2Gi", "ephemeral-storage": "10Gi"}, nullable=True)
    deadline_seconds = Column(Integer, default=3600, nullable=True)  # 1 hour default
    k8s_job_name = Column(String(255), nullable=True)  # Unique by construction (process-{id}-v{version})
    k8s_namespace = Column(String(255), nullable=True)
    max_reserved_cost = Column(Numeric(10, 4), nullable=True)  # Held upfront
    actual_cost = Column(Numeric(10, 4), nullable=True)  # Charged on completion
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)

    # Relationships
    process = relationship("Process", back_populates="versions")
    datasets = relationship("Dataset", back_populates="process_version")

    # Constraints
    __table_args__ = (
        UniqueConstraint('process_id', 'version', name='uq_process_version'),
    )

    def to_dict(self):
        """Convert to API response format

        Note: Requires self.datasets to be eagerly loaded to avoid greenlet errors.
        Use selectinload(ProcessVersion.datasets) when querying.
        """
        from backend.services.storage_service import translate_urls_in_dict

        # Get logs for this version
        logs = [log.to_dict() for log in sorted(
            [l for l in self.process.logs if l.version == self.version],
            key=lambda x: x.timestamp
        )]

        # Translate storage URLs to HTTP URLs for frontend
        parameters = translate_urls_in_dict(self.parameters, self.process.project_id, to_storage=False)

        # Build outputs from datasets relationship (dict mapping dataset name to URL)
        from backend.config import settings
        outputs = {
            dataset.dataset_name: f"{settings.backend_base_url}/dataset/{dataset.id}"
            for dataset in self.datasets
        }

        return {
            "version": self.version,
            "parameters": parameters,
            "outputs": outputs,
            "state": self.state.value,
            "logs": logs,
            "dependencies": self.dependencies
        }

    async def update_state(self, db: AsyncSession, new_state: ProcessState):
        """Update process state and broadcast to all state listeners

        Args:
            db: Database session
            new_state: New process state
        """
        import logging
        from backend.services.websocket_service import ws_manager
        from backend.services.storage_service import translate_urls_in_dict

        logger = logging.getLogger(__name__)

        logger.info(f"Updating process state: {self.process_id} v{self.version} -> {new_state.value}")
        self.state = new_state

        await db.commit()

        # Broadcast state change to all connected clients
        state_update = {
            "process_id": self.process_id,
            "version": self.version,
            "state": new_state.value
        }

        # Include outputs in broadcast when transitioning to DONE
        if new_state == ProcessState.DONE and self.datasets:
            # Build outputs list from datasets
            state_update["outputs"] = [dataset.to_dict() for dataset in self.datasets]

        state_update = translate_urls_in_dict(state_update, self.process.project_id, False)

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
        """Execute process in K8s instead of mocking."""
        from backend.services.job_orchestrator import create_job, get_job_status
        from backend.services.k8s_client import k8s_client
        from backend.database import async_session_maker
        import logging

        logger = logging.getLogger(__name__)
        logger.info(f"🚀 Starting K8s process task: {self.process_id} v{self.version}")

        try:
            async with async_session_maker() as db:
                from sqlalchemy.orm import selectinload
                from backend.models import Environment

                # Fetch the process version (with datasets eagerly loaded for to_dict())
                stmt = select(ProcessVersion).options(
                    selectinload(ProcessVersion.datasets)
                ).where(
                    ProcessVersion.process_id == self.process_id,
                    ProcessVersion.version == self.version
                )
                result = await db.execute(stmt)
                process_version = result.scalar_one_or_none()

                if not process_version:
                    logger.error(f"Process version not found: {self.process_id} v{self.version}")
                    return

                # Fetch process with environment eagerly loaded
                stmt = select(Process).options(selectinload(Process.environment)).where(Process.id == self.process_id)
                result = await db.execute(stmt)
                process = result.scalar_one_or_none()

                if not process:
                    logger.error(f"Process not found: {self.process_id}")
                    return

                # Get environment
                stmt = select(Environment).where(Environment.id == process.environment_id)
                result = await db.execute(stmt)
                environment = result.scalar_one_or_none()

                if not environment:
                    logger.error(f"Environment not found: {process.environment_id}")
                    return

                # Create K8s job with all data passed as parameters
                process_version.started_at = datetime.utcnow()
                job_name = await create_job(
                    docker_image=environment.docker_image,
                    process_id=process_version.process_id,
                    version=process_version.version,
                    process_type=process.type,
                    parameters=process_version.parameters,
                    resource_requests=process_version.resource_requests,
                    deadline_seconds=process_version.deadline_seconds,
                    project_id=process.project_id
                )
                process_version.k8s_job_name = job_name
                process_version.k8s_namespace = k8s_client.namespace
                await db.commit()

                logger.info(f"▶️ K8s job created: {job_name}")

                # Keep state as QUEUED until pod actually starts
                await process_version.add_log_entry(db, "K8s job created: %s.%s" % (process_version.k8s_namespace, process_version.k8s_job_name))
                await process_version.add_log_entry(db, "Waiting for pod to start...")

                # Wait for pod to exist and container to be running
                pod = None
                pod_name = None
                wait_start_time = datetime.utcnow()
                last_status_log_time = wait_start_time
                status_log_interval = 30  # Log status every 30 seconds

                while True:  # No timeout - Kueue might queue for a long time
                    # Check Job-level status for failures (e.g., quota exceeded, invalid config)
                    has_job_error, job_error_message = k8s_client.get_job_error_status(job_name)
                    if has_job_error:
                        logger.error(f"Job failed: {job_error_message}")
                        await process_version.add_log_entry(db, f"Job failed: {job_error_message}")

                        # Get Job events to understand why it failed
                        try:
                            job_events = k8s_client.get_job_events(job_name)
                            if job_events:
                                await process_version.add_log_entry(db, "=== Job Events ===")
                                for event in job_events:
                                    await process_version.add_log_entry(db, event)
                                await process_version.add_log_entry(db, "=== End of job events ===")
                        except Exception as event_error:
                            logger.warning(f"Could not retrieve job events: {event_error}")

                        # Handle financial transactions - release hold (no actual cost since job failed)
                        from backend.models import User, UserTransaction, TransactionType

                        # Find user via existing HOLD transaction
                        stmt = select(UserTransaction).where(
                            UserTransaction.process_id == self.process_id,
                            UserTransaction.process_version == self.version,
                            UserTransaction.type == TransactionType.HOLD
                        )
                        result = await db.execute(stmt)
                        hold_transaction = result.scalar_one()
                        user_id = hold_transaction.user_id

                        # Release hold (no charge since job failed)
                        release_transaction = UserTransaction(
                            user_id=user_id,
                            timestamp=datetime.utcnow(),
                            type=TransactionType.RELEASE,
                            description=f"Release hold for failed job {process.name} v{process_version.version}",
                            amount=process_version.max_reserved_cost,
                            process_id=process.id,
                            process_version=process_version.version,
                            process_name=process.name
                        )
                        db.add(release_transaction)

                        await process_version.update_state(db, ProcessState.FAILED)
                        await db.commit()
                        return

                    # Check for early completion (job finished before we caught "Running" state)
                    early_completion_status = await get_job_status(job_name)
                    if early_completion_status in ["succeeded", "failed"]:
                        logger.info(f"Job completed quickly with status: {early_completion_status}")
                        break

                    # Check if pod exists
                    pod = k8s_client.get_pod_for_job(job_name)
                    if pod:
                        pod_name = pod.metadata.name

                        # Check for pod error conditions
                        has_error, error_message = k8s_client.get_pod_error_status(pod_name)
                        if has_error:
                            logger.error(f"Pod startup failed: {error_message}")
                            await process_version.add_log_entry(db, f"Failed to start pod: {error_message}")

                            # Try to get pod events first (scheduling issues, image pull errors, etc.)
                            try:
                                pod_events = k8s_client.get_pod_events(pod_name)
                                if pod_events:
                                    await process_version.add_log_entry(db, "=== Pod Events ===")
                                    for event in pod_events:
                                        await process_version.add_log_entry(db, event)
                                    await process_version.add_log_entry(db, "=== End of pod events ===")
                            except Exception as event_error:
                                logger.warning(f"Could not retrieve pod events: {event_error}")

                            # Try to get any logs from the failed pod
                            try:
                                pod_logs = k8s_client.get_pod_logs(pod_name)
                                if pod_logs:
                                    await process_version.add_log_entry(db, "=== Pod logs from failed container ===")
                                    # Split logs into lines and add each as a separate entry
                                    for line in pod_logs.split('\n'):
                                        if line.strip():  # Only add non-empty lines
                                            await process_version.add_log_entry(db, line)
                                    await process_version.add_log_entry(db, "=== End of pod logs ===")
                            except Exception as log_error:
                                logger.warning(f"Could not retrieve pod logs: {log_error}")

                            # Handle financial transactions - release hold (no actual cost since pod never started)
                            from backend.models import User, UserTransaction, TransactionType

                            # Find user via existing HOLD transaction
                            stmt = select(UserTransaction).where(
                                UserTransaction.process_id == self.process_id,
                                UserTransaction.process_version == self.version,
                                UserTransaction.type == TransactionType.HOLD
                            )
                            result = await db.execute(stmt)
                            hold_transaction = result.scalar_one()
                            user_id = hold_transaction.user_id

                            # Release hold (no charge since pod never started)
                            release_transaction = UserTransaction(
                                user_id=user_id,
                                timestamp=datetime.utcnow(),
                                type=TransactionType.RELEASE,
                                description=f"Release hold for failed pod startup {process.name} v{process_version.version}",
                                amount=process_version.max_reserved_cost,
                                process_id=process.id,
                                process_version=process_version.version,
                                process_name=process.name
                            )
                            db.add(release_transaction)

                            await process_version.update_state(db, ProcessState.FAILED)
                            await db.commit()
                            return

                        # Check if container is actually running (not just ContainerCreating)
                        if k8s_client.is_pod_container_running(pod_name):
                            break

                    # Periodic status logging to show progress
                    current_time = datetime.utcnow()
                    elapsed_seconds = (current_time - wait_start_time).total_seconds()
                    time_since_last_log = (current_time - last_status_log_time).total_seconds()

                    if time_since_last_log >= status_log_interval:
                        elapsed_minutes = int(elapsed_seconds // 60)
                        elapsed_secs = int(elapsed_seconds % 60)
                        if pod_name:
                            status_msg = f"Pod {pod_name} is starting... ({elapsed_minutes}m {elapsed_secs}s elapsed)"
                        else:
                            status_msg = f"Waiting for pod to be created by Kueue scheduler... ({elapsed_minutes}m {elapsed_secs}s elapsed)"
                        logger.info(status_msg)
                        await process_version.add_log_entry(db, status_msg)
                        await db.commit()  # Commit so log is visible to user
                        last_status_log_time = current_time

                    await asyncio.sleep(5)  # Check every 5 seconds

                # Get pod name if we don't have it yet (in case of early completion)
                if not pod_name:
                    pod = k8s_client.get_pod_for_job(job_name)
                    if pod:
                        pod_name = pod.metadata.name

                if pod_name:
                    # Check current job status to see if we missed the running phase
                    current_status = await get_job_status(job_name)
                    if current_status == "running":
                        # Normal case: container is running
                        await process_version.update_state(db, ProcessState.RUNNING)
                        await process_version.add_log_entry(db, f"Pod {pod_name} container started, streaming logs...")
                        # Stream logs in background
                        asyncio.create_task(self._stream_logs(pod_name))
                    else:
                        # Early completion case: job finished before we caught "Running"
                        logger.info(f"Pod {pod_name} completed quickly, retrieving logs...")
                        await process_version.add_log_entry(db, f"Pod {pod_name} completed quickly, retrieving logs...")
                        # Get all logs synchronously since job is done
                        try:
                            pod_logs = k8s_client.get_pod_logs(pod_name)
                            if pod_logs:
                                for line in pod_logs.split('\n'):
                                    if line.strip():
                                        await process_version.add_log_entry(db, line)
                        except Exception as log_error:
                            logger.warning(f"Could not retrieve pod logs: {log_error}")

                # Poll job status
                while True:
                    status = await get_job_status(job_name)

                    if status == "succeeded":
                        process_version.completed_at = datetime.utcnow()
                        runtime_seconds = (process_version.completed_at - process_version.started_at).total_seconds()

                        # Calculate actual cost
                        process_version.actual_cost = process_version._calculate_actual_cost(runtime_seconds)

                        await process_version.add_log_entry(db, f"Process completed in {runtime_seconds:.1f}s, cost: ${process_version.actual_cost}")

                        # Release hold and charge actual cost
                        from backend.models import User, UserTransaction, TransactionType

                        # Find user via existing HOLD transaction
                        stmt = select(UserTransaction).where(
                            UserTransaction.process_id == self.process_id,
                            UserTransaction.process_version == self.version,
                            UserTransaction.type == TransactionType.HOLD
                        )
                        result = await db.execute(stmt)
                        hold_transaction = result.scalar_one()
                        user_id = hold_transaction.user_id

                        # Release hold
                        release_transaction = UserTransaction(
                            user_id=user_id,
                            timestamp=datetime.utcnow(),
                            type=TransactionType.RELEASE,
                            description=f"Release hold for process {process.name} v{process_version.version}",
                            amount=process_version.max_reserved_cost,
                            process_id=process.id,
                            process_version=process_version.version,
                            process_name=process.name
                        )
                        db.add(release_transaction)

                        # Charge actual cost
                        debit_transaction = UserTransaction(
                            user_id=user_id,
                            timestamp=datetime.utcnow(),
                            type=TransactionType.DEBIT,
                            description=f"Charge for process {process.name} v{process_version.version}",
                            amount=process_version.actual_cost,
                            process_id=process.id,
                            process_version=process_version.version,
                            process_name=process.name
                        )
                        db.add(debit_transaction)

                        # Update user balance
                        stmt = select(User).where(User.id == user_id)
                        result = await db.execute(stmt)
                        user_obj = result.scalar_one()
                        user_obj.balance -= Decimal(str(process_version.actual_cost))

                        await db.commit()

                        # Create output datasets by reading info.json from storage
                        await process_version._create_outputs(db, process, process_version)

                        # Re-query with datasets eagerly loaded for state broadcast
                        stmt = select(ProcessVersion).options(
                            selectinload(ProcessVersion.datasets)
                        ).where(
                            ProcessVersion.id == process_version.id
                        )
                        result = await db.execute(stmt)
                        process_version = result.scalar_one()

                        await process_version.update_state(db, ProcessState.DONE)

                        logger.info(f"✅ Process task completed: {self.process_id} v{self.version}")
                        break

                    elif status == "failed":
                        process_version.completed_at = datetime.utcnow()
                        runtime_seconds = (process_version.completed_at - process_version.started_at).total_seconds()

                        # Calculate actual cost for time used
                        process_version.actual_cost = process_version._calculate_actual_cost(runtime_seconds)

                        await process_version.add_log_entry(db, f"Process failed after {runtime_seconds:.1f}s, cost: ${process_version.actual_cost}")

                        # Capture pod events and any remaining logs when job fails
                        if pod_name:
                            try:
                                pod_events = k8s_client.get_pod_events(pod_name)
                                if pod_events:
                                    await process_version.add_log_entry(db, "=== Pod Events ===")
                                    for event in pod_events:
                                        await process_version.add_log_entry(db, event)
                                    await process_version.add_log_entry(db, "=== End of pod events ===")
                            except Exception as event_error:
                                logger.warning(f"Could not retrieve pod events on failure: {event_error}")

                        # Release hold and charge actual cost
                        from backend.models import User, UserTransaction, TransactionType

                        # Find user via existing HOLD transaction
                        stmt = select(UserTransaction).where(
                            UserTransaction.process_id == self.process_id,
                            UserTransaction.process_version == self.version,
                            UserTransaction.type == TransactionType.HOLD
                        )
                        result = await db.execute(stmt)
                        hold_transaction = result.scalar_one()
                        user_id = hold_transaction.user_id

                        # Release hold
                        release_transaction = UserTransaction(
                            user_id=user_id,
                            timestamp=datetime.utcnow(),
                            type=TransactionType.RELEASE,
                            description=f"Release hold for failed process {process.name} v{process_version.version}",
                            amount=process_version.max_reserved_cost,
                            process_id=process.id,
                            process_version=process_version.version,
                            process_name=process.name
                        )
                        db.add(release_transaction)

                        # Charge actual cost
                        debit_transaction = UserTransaction(
                            user_id=user_id,
                            timestamp=datetime.utcnow(),
                            type=TransactionType.DEBIT,
                            description=f"Charge for failed process {process.name} v{process_version.version}",
                            amount=process_version.actual_cost,
                            process_id=process.id,
                            process_version=process_version.version,
                            process_name=process.name
                        )
                        db.add(debit_transaction)

                        # Update user balance
                        stmt = select(User).where(User.id == user_id)
                        result = await db.execute(stmt)
                        user_obj = result.scalar_one()
                        user_obj.balance -= Decimal(str(process_version.actual_cost))

                        await process_version.update_state(db, ProcessState.FAILED)
                        await db.commit()

                        logger.error(f"❌ Process task failed: {self.process_id} v{self.version}")
                        break

                    await asyncio.sleep(5)

        except Exception as e:
            logger.error(f"❌ Process task error: {self.process_id} v{self.version} - {str(e)}", exc_info=True)
            async with async_session_maker() as db:
                stmt = select(ProcessVersion).where(
                    ProcessVersion.process_id == self.process_id,
                    ProcessVersion.version == self.version
                )
                result = await db.execute(stmt)
                process_version = result.scalar_one_or_none()
                if process_version:
                    await process_version.add_log_entry(db, f"Error: {str(e)}")

                    # Try to capture pod logs and events on unexpected error
                    if process_version.k8s_job_name:
                        try:
                            pod = k8s_client.get_pod_for_job(process_version.k8s_job_name)
                            if pod:
                                pod_name = pod.metadata.name

                                # Get events
                                pod_events = k8s_client.get_pod_events(pod_name)
                                if pod_events:
                                    await process_version.add_log_entry(db, "=== Pod Events ===")
                                    for event in pod_events:
                                        await process_version.add_log_entry(db, event)
                                    await process_version.add_log_entry(db, "=== End of pod events ===")

                                # Get logs
                                pod_logs = k8s_client.get_pod_logs(pod_name)
                                if pod_logs:
                                    await process_version.add_log_entry(db, "=== Pod logs ===")
                                    for line in pod_logs.split('\n'):
                                        if line.strip():
                                            await process_version.add_log_entry(db, line)
                                    await process_version.add_log_entry(db, "=== End of pod logs ===")
                        except Exception as log_error:
                            logger.warning(f"Could not retrieve pod logs/events on exception: {log_error}")

                    await process_version.update_state(db, ProcessState.FAILED)
                    await db.commit()

    async def _stream_logs(self, pod_name):
        """Stream logs from pod to ProcessLog."""
        from backend.services.k8s_client import k8s_client
        from backend.database import async_session_maker
        import logging

        logger = logging.getLogger(__name__)

        try:
            log_stream = k8s_client.stream_pod_logs(pod_name)
            async with async_session_maker() as db:
                # Fetch process version
                stmt = select(ProcessVersion).where(
                    ProcessVersion.process_id == self.process_id,
                    ProcessVersion.version == self.version
                )
                result = await db.execute(stmt)
                process_version = result.scalar_one_or_none()

                if not process_version:
                    logger.error(f"Process version not found for log streaming: {self.process_id} v{self.version}")
                    return

                for line in log_stream:
                    await process_version.add_log_entry(db, line.decode('utf-8').strip())
        except Exception as e:
            logger.error(f"Log streaming error: {str(e)}")
            async with async_session_maker() as db:
                stmt = select(ProcessVersion).where(
                    ProcessVersion.process_id == self.process_id,
                    ProcessVersion.version == self.version
                )
                result = await db.execute(stmt)
                process_version = result.scalar_one_or_none()
                if process_version:
                    await process_version.add_log_entry(db, f"Log streaming error: {str(e)}")

    def _calculate_actual_cost(self, runtime_seconds):
        """Calculate cost based on actual runtime."""
        cpu_cores = float(self.resource_requests.get('cpu', '1000m').rstrip('m')) / 1000
        memory_gb = float(self.resource_requests.get('memory', '2Gi').rstrip('Gi'))

        # Example pricing: $0.0001 per core-second, $0.00002 per GB-second
        cpu_cost = cpu_cores * runtime_seconds * 0.0001
        memory_cost = memory_gb * runtime_seconds * 0.00002

        return round(cpu_cost + memory_cost, 4)

    def _calculate_max_cost(self):
        """Calculate maximum possible cost (if runs to deadline)."""
        cpu_cores = float(self.resource_requests.get('cpu', '1000m').rstrip('m')) / 1000
        memory_gb = float(self.resource_requests.get('memory', '2Gi').rstrip('Gi'))
        deadline = self.deadline_seconds or 3600

        cpu_cost = cpu_cores * deadline * 0.0001
        memory_cost = memory_gb * deadline * 0.00002

        return round(cpu_cost + memory_cost, 4)

    async def _create_outputs(self, db: AsyncSession, process: "Process", process_version: "ProcessVersion"):
        """Create output dataset records by reading info.json from storage bucket.

        Scans the storage bucket for datasets written by the pod and creates
        database records for each one found by reading their info.json files.

        Args:
            db: Database session
            process: Process object
            process_version: ProcessVersion object
        """
        from backend.models import Dataset
        from backend.services.storage_service import get_storage_base_url, get_fsspec_storage_options
        import fsspec
        import json
        import logging

        logger = logging.getLogger(__name__)

        # Build storage path to scan for datasets
        storage_base = get_storage_base_url(process.project_id)
        datasets_prefix = f"{storage_base}/processes/{process.id}/datasets/"

        logger.info(f"Scanning storage for datasets at: {datasets_prefix}")

        # Get fsspec filesystem
        storage_options = get_fsspec_storage_options()
        fs = fsspec.filesystem(storage_base.split('://')[0], **storage_options)

        # Extract bucket and prefix path
        # Format: s3://bucket/processes/{id}/datasets/
        bucket_and_path = datasets_prefix.split('://', 1)[1]

        try:
            # List all directories under datasets/
            # This will give us paths like: bucket/processes/{id}/datasets/{dataset_id}/
            items = fs.ls(bucket_and_path, detail=True)

            # Filter for directories (dataset IDs)
            dataset_dirs = [item for item in items if item.get('type') == 'directory']

            logger.info(f"Found {len(dataset_dirs)} dataset directories")

            for dir_info in dataset_dirs:
                # Extract dataset_id from path
                # Path format: bucket/processes/{proc_id}/datasets/{dataset_id}
                dataset_id = dir_info['name'].split('/')[-1]

                # Read info.json from this dataset directory
                info_json_path = f"{dir_info['name']}/info.json"

                try:
                    logger.info(f"Reading info.json for dataset {dataset_id}")
                    with fs.open(info_json_path, 'r') as f:
                        info = json.load(f)

                    # Extract fields from info.json
                    dataset_name = info.get('dataset_name')
                    mime_type = info.get('mime_type')

                    # Get the parts structure - could be old or new format
                    # New format has: files={...}, parts={...}
                    # Old format has: ""={...}, part_name={...}
                    # We need to store both in the parts column for new format
                    parts = info.get('parts', {})
                    files = info.get('files')

                    # If new format, combine files and parts into one structure
                    if files is not None:
                        parts_data = {"files": files, "parts": parts}
                    else:
                        parts_data = parts

                    logger.info(f"Processing dataset {dataset_id} as '{dataset_name}'")

                    # Create Dataset record
                    dataset = Dataset(
                        id=dataset_id,
                        mime_type=mime_type,
                        process_id=process.id,
                        process_name=process.name,
                        process_version_id=process_version.id,
                        dataset_name=dataset_name,
                        project_id=process.project_id,
                        parts=parts_data
                    )

                    db.add(dataset)

                    logger.info(f"Created dataset record: {dataset_id} -> {dataset_name}")

                except FileNotFoundError:
                    error_msg = f"info.json not found for dataset directory: {dataset_id}"
                    logger.warning(error_msg)
                    await process_version.add_log_entry(db, error_msg)
                except json.JSONDecodeError as e:
                    import traceback
                    error_msg = f"Failed to parse info.json for dataset {dataset_id}: {str(e)}"
                    logger.error(error_msg)
                    await process_version.add_log_entry(db, error_msg)
                    await process_version.add_log_entry(db, "=== Traceback ===")
                    for line in traceback.format_exc().split('\n'):
                        if line.strip():
                            await process_version.add_log_entry(db, line)
                    await process_version.add_log_entry(db, "=== End of traceback ===")
                except Exception as e:
                    import traceback
                    error_msg = f"Error processing dataset {dataset_id}: {str(e)}"
                    logger.error(error_msg, exc_info=True)
                    await process_version.add_log_entry(db, error_msg)
                    await process_version.add_log_entry(db, "=== Traceback ===")
                    for line in traceback.format_exc().split('\n'):
                        if line.strip():
                            await process_version.add_log_entry(db, line)
                    await process_version.add_log_entry(db, "=== End of traceback ===")

            await db.commit()
            logger.info(f"Successfully created dataset records")

        except Exception as e:
            import traceback
            error_msg = f"Error scanning storage for datasets: {str(e)}"
            logger.error(error_msg, exc_info=True)
            await process_version.add_log_entry(db, error_msg)
            await process_version.add_log_entry(db, "=== Traceback ===")
            for line in traceback.format_exc().split('\n'):
                if line.strip():
                    await process_version.add_log_entry(db, line)
            await process_version.add_log_entry(db, "=== End of traceback ===")
            # If scanning fails, continue without failing the whole process
            pass

        # Check for environment.json (created by create_environment process)
        try:
            env_json_path = f"{storage_base}/processes/{process.id}/environment.json".split('://', 1)[1]
            logger.info(f"Checking for environment.json at: {env_json_path}")

            with fs.open(env_json_path, 'r') as f:
                env_info = json.load(f)

            logger.info(f"Found environment.json, creating environment: {env_info['name']}")

            # Create environment record
            from backend.models import Environment

            environment = Environment(
                name=env_info['name'],
                docker_image=env_info['docker_image'],
                process_id=env_info['process_id'],
                process_types=env_info.get('process_types', {})
            )

            db.add(environment)
            await db.commit()

            logger.info(f"✓ Environment created: {environment.id} -> {env_info['docker_image']}")
            logger.info(f"  Process types: {list(env_info.get('process_types', {}).keys())}")

        except FileNotFoundError:
            # No environment.json - this is normal for non-create_environment processes
            logger.debug(f"No environment.json found (this is normal for most processes)")
        except Exception as e:
            import traceback
            error_msg = f"Error creating environment from environment.json: {str(e)}"
            logger.error(error_msg, exc_info=True)
            await process_version.add_log_entry(db, error_msg)
            await process_version.add_log_entry(db, "=== Traceback ===")
            for line in traceback.format_exc().split('\n'):
                if line.strip():
                    await process_version.add_log_entry(db, line)
            await process_version.add_log_entry(db, "=== End of traceback ===")
            # Continue without failing the whole process
            pass


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
