from backend.routers.auth import router as auth_router
from backend.routers.projects import router as projects_router
from backend.routers.environments import router as environments_router
from backend.routers.processes import router as processes_router
from backend.routers.datasets import router as datasets_router
from backend.routers.workspaces import router as workspaces_router
from backend.routers.uploads import router as uploads_router
from backend.routers.utilities import router as utilities_router
from backend.routers.systems import router as systems_router
from backend.routers.tags import router as tags_router

__all__ = [
    "auth_router",
    "projects_router",
    "environments_router",
    "processes_router",
    "datasets_router",
    "workspaces_router",
    "uploads_router",
    "utilities_router",
    "systems_router",
    "tags_router",
]
