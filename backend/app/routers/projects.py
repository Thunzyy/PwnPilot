"""Project API endpoints.

Thin router that delegates business logic to ProjectService.
"""

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.database import get_db
from app.schemas.project import (
    ProjectContextImportRequest,
    ProjectContextImportResponse,
    ProjectCreate,
    ProjectResponse,
    ProjectUpdate,
    ProjectVpnStatusResponse,
)
from app.services.platform_context_service import PlatformContextService
from app.services.project_service import ProjectService
from app.services.project_vpn_service import ProjectVpnService

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("", response_model=list[ProjectResponse])
async def list_projects(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all projects."""
    service = ProjectService(db)
    return await service.list_for_user(current_user)


@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    data: ProjectCreate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new project."""
    service = ProjectService(db)
    return await service.create_for_user(data, current_user)


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: str,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a project by ID."""
    service = ProjectService(db)
    return await service.require_member(project_id, current_user)


@router.put("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: str,
    data: ProjectUpdate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update a project."""
    service = ProjectService(db)
    await service.require_admin(project_id, current_user)
    return await service.update(project_id, data)


@router.post("/context/import-url", response_model=ProjectContextImportResponse)
async def import_project_context_url(
    data: ProjectContextImportRequest,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Enrich project context fields from a platform URL."""
    _ = current_user
    service = PlatformContextService(db)
    return await service.import_from_url(data.url)


@router.get("/{project_id}/vpn-status", response_model=ProjectVpnStatusResponse)
async def get_project_vpn_status(
    project_id: str,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Resolve project VPN metadata and inspect the local connection status."""
    project_service = ProjectService(db)
    project = await project_service.require_member(project_id, current_user)
    service = ProjectVpnService(db)
    return await service.get_status(project)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: str,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a project and its workspace."""
    service = ProjectService(db)
    await service.require_admin(project_id, current_user)
    await service.delete(project_id)
