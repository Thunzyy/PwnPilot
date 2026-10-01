"""Routers package."""
from app.routers.agent_config import router as agent_config_router
from app.routers.agent_process import router as agent_process_router
from app.routers.ai import router as ai_router
from app.routers.auth import router as auth_router
from app.routers.command_categories import (
    project_router as project_command_categories_router,
)
from app.routers.command_categories import (
    router as command_categories_router,
)
from app.routers.command_favorites import (
    project_router as project_command_favorites_router,
)
from app.routers.command_favorites import (
    router as command_favorites_router,
)
from app.routers.command_filters import (
    project_router as project_command_filters_router,
)
from app.routers.command_filters import (
    router as command_filters_router,
)
from app.routers.command_variables import router as command_variables_router
from app.routers.commands import router as commands_router
from app.routers.graph import router as graph_router
from app.routers.kb import router as kb_router
from app.routers.linking import router as linking_router
from app.routers.memberships import router as memberships_router
from app.routers.mock_mcp import router as mock_mcp_router
from app.routers.project_commands import router as project_commands_router
from app.routers.project_engagement import router as project_engagement_router
from app.routers.projects import router as projects_router
from app.routers.report import router as report_router
from app.routers.settings import router as settings_router
from app.routers.terminal import router as terminal_router
from app.routers.terminal_viewers import router as terminal_viewers_router
from app.routers.timeline import router as timeline_router

__all__ = [
    "agent_config_router",
    "agent_process_router",
    "ai_router",
    "command_categories_router",
    "command_favorites_router",
    "graph_router",
    "kb_router",
    "linking_router",
    "projects_router",
    "auth_router",
    "memberships_router",
    "mock_mcp_router",
    "timeline_router",
    "commands_router",
    "command_filters_router",
    "command_variables_router",
    "project_command_categories_router",
    "project_command_favorites_router",
    "project_command_filters_router",
    "project_commands_router",
    "project_engagement_router",
    "settings_router",
    "terminal_router",
    "terminal_viewers_router",
    "report_router",
]
