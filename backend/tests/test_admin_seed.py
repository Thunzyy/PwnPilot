import uuid

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.graph import GraphNodeDB
from app.models.project import Project
from app.models.project_membership import ProjectMembership
from app.models.user import User
from app.services.bootstrap import seed_admin_user


@pytest.mark.anyio
async def test_seed_admin_creates_user_and_project(test_db: AsyncSession):
    previous = {
        "seed_admin_enabled": settings.seed_admin_enabled,
        "seed_admin_username": settings.seed_admin_username,
        "seed_admin_password": settings.seed_admin_password,
        "seed_admin_email": settings.seed_admin_email,
        "seed_admin_project_name": settings.seed_admin_project_name,
        "seed_admin_project_type": settings.seed_admin_project_type,
        "attack_graph_auto_seed_demo": settings.attack_graph_auto_seed_demo,
    }
    settings.seed_admin_enabled = True
    settings.seed_admin_username = "admin"
    settings.seed_admin_password = "admin"
    settings.seed_admin_email = "admin@example.com"
    settings.seed_admin_project_name = "CTF Demo Admin"
    settings.seed_admin_project_type = "ctf"
    settings.attack_graph_auto_seed_demo = True
    try:
        await seed_admin_user(test_db)

        admin_user = await test_db.scalar(
            select(User).where(User.username == "admin")
        )
        assert admin_user is not None
        assert admin_user.is_super_admin is True

        project = await test_db.scalar(
            select(Project).where(Project.slug == "ctf-demo-admin")
        )
        assert project is not None

        membership = await test_db.scalar(
            select(ProjectMembership).where(
                ProjectMembership.project_id == project.id,
                ProjectMembership.user_id == admin_user.id,
                ProjectMembership.role == "admin",
            )
        )
        assert membership is not None

        node_count = await test_db.scalar(
            select(func.count(GraphNodeDB.id)).where(
                GraphNodeDB.project_id == project.id
            )
        )
        assert (node_count or 0) > 0
    finally:
        settings.seed_admin_enabled = previous["seed_admin_enabled"]
        settings.seed_admin_username = previous["seed_admin_username"]
        settings.seed_admin_password = previous["seed_admin_password"]
        settings.seed_admin_email = previous["seed_admin_email"]
        settings.seed_admin_project_name = previous["seed_admin_project_name"]
        settings.seed_admin_project_type = previous["seed_admin_project_type"]
        settings.attack_graph_auto_seed_demo = previous["attack_graph_auto_seed_demo"]
