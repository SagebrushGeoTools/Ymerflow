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
    uploads_router
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
    """Initialize database on startup"""
    logger.info("Initializing database...")
    await init_db()
    logger.info("Database initialized successfully")


# Include routers
app.include_router(auth_router)
app.include_router(projects_router)
app.include_router(environments_router)
app.include_router(processes_router)
app.include_router(datasets_router)
app.include_router(workspaces_router)
app.include_router(uploads_router)


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
