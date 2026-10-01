from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.database import get_db
from app.schemas.membership import (
    InviteRequest,
    MembershipResponse,
    MembershipUpdate,
)
from app.services.membership_service import MembershipService
from app.services.project_service import ProjectService

router = APIRouter(prefix="/projects/{project_id}", tags=["memberships"])


@router.post(
    "/access-requests",
    response_model=MembershipResponse,
    status_code=status.HTTP_201_CREATED,
)
async def request_access(
    project_id: str,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    service = MembershipService(db)
    return await service.request_access(project_id, current_user)


@router.post("/invites", response_model=MembershipResponse, status_code=201)
async def invite_user(
    project_id: str,
    data: InviteRequest,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project_service = ProjectService(db)
    await project_service.require_admin(project_id, current_user)
    service = MembershipService(db)
    return await service.invite_user(project_id, data.username_or_email, data.role)


@router.get("/memberships", response_model=list[MembershipResponse])
async def list_memberships(
    project_id: str,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project_service = ProjectService(db)
    await project_service.require_admin(project_id, current_user)
    service = MembershipService(db)
    return await service.list_memberships(project_id)


@router.patch("/memberships/{membership_id}", response_model=MembershipResponse)
async def update_membership(
    project_id: str,
    membership_id: str,
    data: MembershipUpdate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project_service = ProjectService(db)
    await project_service.require_admin(project_id, current_user)
    service = MembershipService(db)
    return await service.update_membership(membership_id, data)
