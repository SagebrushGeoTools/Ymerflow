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


# Process types definition (used by migrations)
PROCESS_TYPES = {
    "fft": {
        "schema": {
            "type": "object",
            "properties": {
                "input_signal": {
                    "type": "string",
                    "format": "uri",
                    "x-format": "dataset",
                    "title": "Input Signal"
                },
                "window": {"type": "number", "default": 1.0},
                "overlap": {"type": "number", "default": 0.5}
            },
            "required": ["window"]
        }
    },
    "inversion": {
        "schema": {
            "type": "object",
            "properties": {
                "input_data": {
                    "type": "string",
                    "format": "uri",
                    "x-format": "dataset",
                    "title": "Input Dataset"
                },
                "regularization": {"type": "number", "default": 0.1},
                "max_iter": {"type": "integer", "default": 50}
            }
        }
    },
    "import_data": {
        "schema": {
            "type": "object",
            "properties": {
                "data_file": {
                    "type": "string",
                    "format": "uri",
                    "x-format": "upload",
                    "title": "Data File"
                },
                "file_format": {
                    "type": "string",
                    "enum": ["csv", "xyz", "json"],
                    "default": "csv",
                    "title": "File Format"
                }
            },
            "required": ["data_file"]
        }
    }
}


# Deprecated endpoint for backward compatibility
@app.get("/process-types")
async def get_process_types():
    """Deprecated: Use /environments/{env_id}/process-types instead"""
    return PROCESS_TYPES
