from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging

from backend.config import settings
from backend.database import init_db
from backend.routers import (
    auth_router,
    projects_router,
    environments_router,
    processes_router,
    datasets_router,
    workspaces_router,
    uploads_router,
    utilities_router,
    systems_router
)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(title="Nagelfluh API", version="2.0.0")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_event():
    """Initialize database and resume monitoring for active jobs"""
    import asyncio
    from backend.database import async_session_maker
    from backend.models import ProcessVersion, ProcessState
    from sqlalchemy import select

    logger.info("Initializing database...")
    await init_db()
    logger.info("Database initialized successfully")

    # Resume monitoring for any jobs that were running when backend restarted
    logger.info("Checking for active jobs to resume monitoring...")
    async with async_session_maker() as db:
        # Find all processes in QUEUED or RUNNING state
        stmt = select(ProcessVersion).where(
            ProcessVersion.state.in_([ProcessState.QUEUED, ProcessState.RUNNING])
        )
        result = await db.execute(stmt)
        active_processes = result.scalars().all()

        if active_processes:
            logger.info(f"Found {len(active_processes)} active job(s) to resume monitoring")
            for pv in active_processes:
                logger.info(f"  - Resuming: {pv.process_id} v{pv.version} (state: {pv.state.value})")
                # Start monitoring in background
                asyncio.create_task(ProcessVersion.monitor_job(pv.process_id, pv.version))
        else:
            logger.info("No active jobs found")


# Include routers
app.include_router(auth_router)
app.include_router(projects_router)
app.include_router(environments_router)
app.include_router(processes_router)
app.include_router(datasets_router)
app.include_router(workspaces_router)
app.include_router(uploads_router)
app.include_router(utilities_router)
app.include_router(systems_router)


@app.get("/")
async def root():
    """API root endpoint"""
    return {
        "name": "Nagelfluh API",
        "version": "2.0.0",
        "status": "running"
    }


@app.get("/health")
async def health():
    """Health check endpoint"""
    return {"status": "healthy"}
