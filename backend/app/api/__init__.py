"""API endpoints package.

Contains FastAPI route handlers for the conversion, download, and health
endpoints (tasks 3.2, 3.3, 3.4). Each module exposes an ``APIRouter`` named
``router`` that is registered in :func:`app.main.create_app`.
"""

from app.api.convert import router as convert_router
from app.api.download import router as download_router
from app.api.health import router as health_router

__all__ = [
    "convert_router",
    "download_router",
    "health_router",
]
