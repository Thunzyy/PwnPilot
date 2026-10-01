from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ErrorCode
from app.core.exceptions import AppException
from app.models.project_membership import ProjectMembership
from app.models.user import User
from app.schemas.membership import MembershipResponse
from app.services.base import BaseService


class MembershipService(BaseService):
    def __init__(self, db: AsyncSession):
        super().__init__("service.membership")
        self.db = db

    async def request_access(self, project_id: str, user: User) -> MembershipResponse:
        existing = await self._get_membership(project_id, user.id)
        if existing:
            return await self._get_membership_response(existing.id)
        membership = ProjectMembership(
            user_id=user.id,
            project_id=project_id,
            role="member",
            status="pending",
            source="request",
        )
        self.db.add(membership)
        await self.db.commit()
        return await self._get_membership_response(membership.id)

    async def invite_user(
        self, project_id: str, username_or_email: str, role: str
    ) -> MembershipResponse:
        user = await self._find_user(username_or_email)
        if not user:
            raise AppException(ErrorCode.AUTH_INVALID_CREDENTIALS, "User not found")
        existing = await self._get_membership(project_id, user.id)
        if existing:
            return await self._get_membership_response(existing.id)
        membership = ProjectMembership(
            user_id=user.id,
            project_id=project_id,
            role=role,
            status="active",
            source="invite",
        )
        self.db.add(membership)
        await self.db.commit()
        return await self._get_membership_response(membership.id)

    async def list_memberships(self, project_id: str) -> list[MembershipResponse]:
        result = await self.db.execute(
            select(ProjectMembership, User)
            .join(User, User.id == ProjectMembership.user_id)
            .where(ProjectMembership.project_id == project_id)
            .order_by(ProjectMembership.created_at.asc())
        )
        return [
            self._serialize_membership(membership, user)
            for membership, user in result.all()
        ]

    async def update_membership(self, membership_id: str, data) -> MembershipResponse:
        membership = await self.db.get(ProjectMembership, membership_id)
        if not membership:
            raise AppException(ErrorCode.AUTH_FORBIDDEN, "Membership not found")
        update = data.model_dump(exclude_unset=True)
        for key, value in update.items():
            setattr(membership, key, value)
        await self.db.commit()
        return await self._get_membership_response(membership.id)

    async def _get_membership(
        self, project_id: str, user_id: str
    ) -> ProjectMembership | None:
        result = await self.db.execute(
            select(ProjectMembership).where(
                ProjectMembership.project_id == project_id,
                ProjectMembership.user_id == user_id,
            )
        )
        return result.scalar_one_or_none()

    async def _find_user(self, username_or_email: str) -> User | None:
        result = await self.db.execute(
            select(User).where(
                (User.username == username_or_email)
                | (User.email == username_or_email)
            )
        )
        return result.scalar_one_or_none()

    async def _get_membership_response(self, membership_id: str) -> MembershipResponse:
        result = await self.db.execute(
            select(ProjectMembership, User)
            .join(User, User.id == ProjectMembership.user_id)
            .where(ProjectMembership.id == membership_id)
        )
        row = result.one_or_none()
        if row is None:
            raise AppException(ErrorCode.AUTH_FORBIDDEN, "Membership not found")
        membership, user = row
        return self._serialize_membership(membership, user)

    @staticmethod
    def _serialize_membership(
        membership: ProjectMembership, user: User
    ) -> MembershipResponse:
        return MembershipResponse(
            id=membership.id,
            user_id=membership.user_id,
            project_id=membership.project_id,
            role=membership.role,
            status=membership.status,
            source=membership.source,
            username=user.username,
            display_name=user.display_name,
            email=user.email,
            team=user.team,
        )
