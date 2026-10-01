"""Project service for business logic.

Handles all project-related operations:
- CRUD operations
- Workspace management
- Slug generation and validation
"""

import re
import shutil
from pathlib import Path

from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.errors import ErrorCode
from app.core.exceptions import AppException
from app.core.security import validate_workspace_path
from app.models.agent_config import AgentConfig
from app.models.agent_mcp_log import AgentMCPLog
from app.models.agent_process import AgentProcessRecord
from app.models.ai import AIAttachment, AIChatMessage, AIContextRouting, AIConversation, AIMemory
from app.models.command import Command
from app.models.command_category import CommandCategory
from app.models.command_favorite import CommandFavorite
from app.models.command_filter import CommandFilter
from app.models.command_history import CommandHistory
from app.models.credential import Credential, Flag
from app.models.graph import (
    GraphEdgeDB,
    GraphNodeDB,
    GraphScenarioDB,
    GraphScenarioEdgeDB,
    GraphScenarioNodeDB,
)
from app.models.knowledge import KnowledgeBookmark, KnowledgeDoc, KnowledgeSource
from app.models.mcp_session import MCPSessionRecord
from app.models.project import Project
from app.models.project_membership import ProjectMembership
from app.models.terminal_session import TerminalSessionDB
from app.models.timeline import Timeline
from app.models.timeline_kb_link import TimelineKBLink
from app.schemas.project import ProjectCreate, ProjectUpdate
from app.services.base import BaseService


class ProjectService(BaseService):
    """Service for project business logic."""

    def __init__(self, db: AsyncSession):
        super().__init__("service.project")
        self.db = db

    async def list_all(self) -> list[Project]:
        """List all projects ordered by creation date."""
        self.log.debug("Listing all projects")
        result = await self.db.execute(
            select(Project).order_by(Project.created_at.desc())
        )
        projects = list(result.scalars().all())
        self.log.info(f"Listed {len(projects)} projects")
        return projects

    async def list_for_user(self, user) -> list[Project]:
        """List projects accessible by the user."""
        if user.is_super_admin:
            return await self.list_all()
        result = await self.db.execute(
            select(Project)
            .join(ProjectMembership, ProjectMembership.project_id == Project.id)
            .where(
                ProjectMembership.user_id == user.id,
                ProjectMembership.status == "active",
            )
            .order_by(Project.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_by_id(self, project_id: str) -> Project:
        """Get a project by ID.

        Raises:
            AppException: If project not found (1001:PROJECT_NOT_FOUND)
        """
        result = await self.db.execute(
            select(Project).where(Project.id == project_id)
        )
        project = result.scalar_one_or_none()
        if not project:
            raise AppException(
                ErrorCode.PROJECT_NOT_FOUND,
                f"Project '{project_id}' does not exist",
                {"project_id": project_id},
            )
        return project

    async def create(self, data: ProjectCreate) -> Project:
        """Create a new project with workspace directory.

        Raises:
            AppException: If slug exists (1002) or workspace exists (1003) or path forbidden (1006)
        """
        self.log.info("Creating project", name=data.name)

        slug = self._slugify(data.name)
        await self._check_slug_unique(slug)

        workspace = self._create_workspace(data.workspace_base, slug)

        project = Project(
            name=data.name,
            slug=slug,
            type=data.type,
            status=data.status,
            variables=data.variables,
            workspace_path=str(workspace),
        )
        self.db.add(project)
        await self.db.commit()
        await self.db.refresh(project)

        self.log.info("Project created", id=project.id, slug=slug)
        return project

    async def create_for_user(self, data: ProjectCreate, user) -> Project:
        project = await self.create(data)
        membership = ProjectMembership(
            user_id=user.id,
            project_id=project.id,
            role="admin",
            status="active",
            source="invite",
        )
        self.db.add(membership)
        await self.db.commit()
        return project

    async def update(self, project_id: str, data: ProjectUpdate) -> Project:
        """Update an existing project.

        Handles slug/workspace renaming if name changes.

        Raises:
            AppException: If project not found, new slug exists, or new workspace exists
        """
        project = await self.get_by_id(project_id)

        update_data = data.model_dump(exclude_unset=True)

        # Handle name change → slug and workspace rename
        new_name = update_data.get("name")
        if new_name and new_name != project.name:
            new_slug = self._slugify(new_name)
            if new_slug != project.slug:
                await self._check_slug_unique(new_slug)

                # Rename workspace directory
                old_path = Path(project.workspace_path)
                new_path = old_path.parent / new_slug

                if new_path.exists():
                    raise AppException(
                        ErrorCode.PROJECT_WORKSPACE_EXISTS,
                        f"Workspace folder already exists at '{new_path}'",
                        {"path": str(new_path)},
                    )

                if old_path.exists():
                    old_path.rename(new_path)
                    self.log.info(
                        "Workspace renamed",
                        old=str(old_path),
                        new=str(new_path),
                    )

                project.slug = new_slug
                project.workspace_path = str(new_path)

        # Apply other updates
        for key, value in update_data.items():
            setattr(project, key, value)

        await self.db.commit()
        await self.db.refresh(project)

        self.log.info("Project updated", id=project_id)
        return project

    async def require_member(self, project_id: str, user) -> Project:
        project = await self.get_by_id(project_id)
        if user.is_super_admin:
            return project
        result = await self.db.execute(
            select(ProjectMembership).where(
                ProjectMembership.project_id == project_id,
                ProjectMembership.user_id == user.id,
            )
        )
        membership = result.scalar_one_or_none()
        if not membership:
            raise AppException(
                ErrorCode.AUTH_FORBIDDEN,
                "Access denied",
                {
                    "project_id": project_id,
                    "membership_status": "none",
                },
            )
        if membership.status != "active":
            raise AppException(
                ErrorCode.AUTH_FORBIDDEN,
                "Access denied",
                {
                    "project_id": project_id,
                    "membership_status": membership.status,
                    "membership_role": membership.role,
                    "membership_source": membership.source,
                },
            )
        return project

    async def require_admin(self, project_id: str, user) -> Project:
        project = await self.get_by_id(project_id)
        if user.is_super_admin:
            return project
        result = await self.db.execute(
            select(ProjectMembership).where(
                ProjectMembership.project_id == project_id,
                ProjectMembership.user_id == user.id,
                ProjectMembership.role == "admin",
                ProjectMembership.status == "active",
            )
        )
        if not result.scalar_one_or_none():
            raise AppException(ErrorCode.AUTH_FORBIDDEN, "Admin role required")
        return project

    async def delete(self, project_id: str) -> None:
        """Delete a project and its workspace directory.

        Raises:
            AppException: If project not found
        """
        project = await self.get_by_id(project_id)
        workspace = Path(project.workspace_path)

        await self._delete_project_relations(project_id)
        await self.db.delete(project)
        await self.db.commit()

        # Clean up workspace after successful DB delete
        if workspace.exists():
            shutil.rmtree(workspace, ignore_errors=True)
            self.log.info("Workspace deleted", path=str(workspace))

        self.log.info("Project deleted", id=project_id)

    async def _delete_project_relations(self, project_id: str) -> None:
        command_ids = select(Command.id).where(Command.project_id == project_id)
        conversation_ids = select(AIConversation.id).where(
            AIConversation.project_id == project_id
        )
        message_ids = select(AIChatMessage.id).where(
            AIChatMessage.conversation_id.in_(conversation_ids)
        )
        knowledge_source_ids = select(KnowledgeSource.id).where(
            KnowledgeSource.project_id == project_id
        )
        knowledge_doc_ids = select(KnowledgeDoc.id).where(
            KnowledgeDoc.source_id.in_(knowledge_source_ids)
        )
        timeline_ids = select(Timeline.id).where(Timeline.project_id == project_id)
        graph_scenario_ids = select(GraphScenarioDB.id).where(
            GraphScenarioDB.project_id == project_id
        )

        await self.db.execute(
            delete(TimelineKBLink).where(
                or_(
                    TimelineKBLink.timeline_entry_id.in_(timeline_ids),
                    TimelineKBLink.doc_id.in_(knowledge_doc_ids),
                )
            )
        )
        await self.db.execute(
            delete(AIAttachment).where(AIAttachment.message_id.in_(message_ids))
        )
        await self.db.execute(
            delete(AIChatMessage).where(
                AIChatMessage.conversation_id.in_(conversation_ids)
            )
        )
        await self.db.execute(
            delete(KnowledgeBookmark).where(
                KnowledgeBookmark.doc_id.in_(knowledge_doc_ids)
            )
        )
        await self.db.execute(
            delete(CommandFavorite).where(
                or_(
                    CommandFavorite.project_id == project_id,
                    CommandFavorite.command_id.in_(command_ids),
                )
            )
        )
        await self.db.execute(
            delete(GraphScenarioEdgeDB).where(
                GraphScenarioEdgeDB.scenario_id.in_(graph_scenario_ids)
            )
        )
        await self.db.execute(
            delete(GraphScenarioNodeDB).where(
                GraphScenarioNodeDB.scenario_id.in_(graph_scenario_ids)
            )
        )
        await self.db.execute(
            delete(CommandHistory).where(CommandHistory.project_id == project_id)
        )
        await self.db.execute(delete(GraphEdgeDB).where(GraphEdgeDB.project_id == project_id))
        await self.db.execute(
            delete(GraphScenarioDB).where(GraphScenarioDB.project_id == project_id)
        )
        await self.db.execute(delete(GraphNodeDB).where(GraphNodeDB.project_id == project_id))
        await self.db.execute(delete(Timeline).where(Timeline.project_id == project_id))
        await self.db.execute(
            delete(AIConversation).where(AIConversation.project_id == project_id)
        )
        await self.db.execute(delete(AIMemory).where(AIMemory.project_id == project_id))
        await self.db.execute(
            delete(AIContextRouting).where(AIContextRouting.project_id == project_id)
        )
        await self.db.execute(
            delete(KnowledgeDoc).where(KnowledgeDoc.source_id.in_(knowledge_source_ids))
        )
        await self.db.execute(
            delete(KnowledgeSource).where(KnowledgeSource.project_id == project_id)
        )
        await self.db.execute(
            delete(AgentMCPLog).where(AgentMCPLog.project_id == project_id)
        )
        await self.db.execute(
            delete(AgentProcessRecord).where(
                AgentProcessRecord.project_id == project_id
            )
        )
        await self.db.execute(
            delete(MCPSessionRecord).where(MCPSessionRecord.project_id == project_id)
        )
        await self.db.execute(
            delete(TerminalSessionDB).where(TerminalSessionDB.project_id == project_id)
        )
        await self.db.execute(delete(Credential).where(Credential.project_id == project_id))
        await self.db.execute(delete(Flag).where(Flag.project_id == project_id))
        await self.db.execute(delete(Command).where(Command.project_id == project_id))
        await self.db.execute(
            delete(CommandCategory).where(CommandCategory.project_id == project_id)
        )
        await self.db.execute(
            delete(CommandFilter).where(CommandFilter.project_id == project_id)
        )
        await self.db.execute(delete(AgentConfig).where(AgentConfig.project_id == project_id))
        await self.db.execute(
            delete(ProjectMembership).where(ProjectMembership.project_id == project_id)
        )

    def _slugify(self, name: str) -> str:
        """Convert name to URL-safe slug."""
        slug = re.sub(r"[^a-zA-Z0-9]+", "-", name.strip().lower())
        slug = slug.strip("-")
        return slug or "project"

    async def _check_slug_unique(self, slug: str) -> None:
        """Check if slug is unique in database."""
        result = await self.db.execute(
            select(Project).where(Project.slug == slug)
        )
        if result.scalar_one_or_none():
            raise AppException(
                ErrorCode.PROJECT_SLUG_EXISTS,
                f"A project with slug '{slug}' already exists",
                {"slug": slug},
            )

    def _create_workspace(self, workspace_base: str | None, slug: str) -> Path:
        """Create workspace directory for project.

        Validates path is under allowed roots if custom base provided.
        """
        if workspace_base:
            base = validate_workspace_path(
                workspace_base,
                settings.allowed_workspace_roots,
            )
        else:
            base = Path(settings.projects_root).expanduser()

        workspace = base / slug

        if workspace.exists():
            raise AppException(
                ErrorCode.PROJECT_WORKSPACE_EXISTS,
                f"Workspace folder already exists at '{workspace}'",
                {"path": str(workspace)},
            )

        workspace.mkdir(parents=True, exist_ok=False)
        self.log.debug("Workspace created", path=str(workspace))
        return workspace
