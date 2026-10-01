"""Service layer for business logic.

Services encapsulate business logic, keeping routers thin.
Each service inherits from BaseService for logging capabilities.
"""

from app.services.base import BaseService
from app.services.project_service import ProjectService

__all__ = ["BaseService", "ProjectService"]
