from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.auth import hash_password
from app.models.project import Project
from app.models.project_membership import ProjectMembership
from app.models.user import User
from app.schemas.project import ProjectCreate
from app.services.graph_service import GraphService
from app.services.project_service import ProjectService


async def seed_admin_user(db: AsyncSession) -> User | None:
    if not settings.seed_admin_enabled:
        return None

    user = await db.scalar(
        select(User).where(
            (User.username == settings.seed_admin_username)
            | (User.email == settings.seed_admin_email)
        )
    )
    if user is None:
        user = User(
            username=settings.seed_admin_username,
            email=settings.seed_admin_email,
            password_hash=hash_password(settings.seed_admin_password),
            is_super_admin=True,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
    else:
        if not user.is_super_admin:
            user.is_super_admin = True
            await db.commit()

    if settings.seed_admin_project_name:
        service = ProjectService(db)
        slug = service._slugify(settings.seed_admin_project_name)
        project = await db.scalar(select(Project).where(Project.slug == slug))
        if project is None:
            project = await service.create_for_user(
                ProjectCreate(
                    name=settings.seed_admin_project_name,
                    type=settings.seed_admin_project_type,
                ),
                user,
            )
            if settings.attack_graph_auto_seed_demo:
                graph_service = GraphService(db)
                await graph_service.seed_demo_ctf(project, user_id=user.id)
        else:
            membership = await db.scalar(
                select(ProjectMembership).where(
                    ProjectMembership.project_id == project.id,
                    ProjectMembership.user_id == user.id,
                )
            )
            if membership is None:
                db.add(
                    ProjectMembership(
                        user_id=user.id,
                        project_id=project.id,
                        role="admin",
                        status="active",
                        source="seed",
                    )
                )
                await db.commit()

    return user
