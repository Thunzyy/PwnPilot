"""PwnPilot Backend API.

Tactical Pentest Cockpit - Local-first, AI-augmented, Write-up ready.
"""

import asyncio
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.core.exceptions import AppException, app_exception_handler
from app.core.logging import get_logger, setup_logging
from app.database import async_session_maker, get_db, init_db
from app.mcp.session import mcp_session_manager
from app.routers import (
    agent_config_router,
    agent_process_router,
    ai_router,
    auth_router,
    command_categories_router,
    command_favorites_router,
    command_filters_router,
    command_variables_router,
    commands_router,
    graph_router,
    kb_router,
    linking_router,
    memberships_router,
    mock_mcp_router,
    project_command_categories_router,
    project_command_favorites_router,
    project_command_filters_router,
    project_commands_router,
    project_engagement_router,
    projects_router,
    report_router,
    settings_router,
    terminal_router,
    terminal_viewers_router,
    timeline_router,
)
from app.routers.command_history import (
    project_router as cmd_history_project_router,
)
from app.routers.command_history import (
    session_router as cmd_history_session_router,
)
from app.routers.mcp import router as mcp_router
from app.routers.prompts import router as prompts_router
from app.routers.ws_chat import router as ws_chat_router
from app.services.agent.process_manager import agent_process_manager
from app.services.bootstrap import seed_admin_user
from app.services.prompt_sync import sync_prompt_templates
from app.services.report_evaluation_task_manager import report_evaluation_task_manager
from app.services.report_signal_service import report_signal_service
from app.tools.registry import load_tools

log = get_logger("api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    report_worker_task: asyncio.Task | None = None
    # Setup logging first
    setup_logging(settings)
    log.info("Starting PwnPilot API", version="0.1.0")

    # Initialize database
    await init_db()
    log.info("Database initialized")

    load_tools()
    log.info("Tool registry loaded")

    # Reload persisted MCP sessions from SQLite
    count = await mcp_session_manager.reload_sessions(async_session_maker)
    log.info("MCP sessions reloaded", count=count)

    # Recover stale agent processes from previous run
    cleaned = await agent_process_manager.recover_stale_agents(async_session_maker)
    if cleaned > 0:
        log.info("Stale agent processes cleaned up", count=cleaned)

    # Sync prompt templates from disk to database
    async for db in get_db():
        await seed_admin_user(db)
        stats = await sync_prompt_templates(db)
        log.info(
            "Prompt templates synced",
            added=stats["added"],
            updated=stats["updated"],
            deleted=stats["deleted"],
        )
        break

    resumed_report_tasks = await report_evaluation_task_manager.resume_inflight_tasks()
    if resumed_report_tasks > 0:
        log.info("Interrupted report evaluation tasks resumed", count=resumed_report_tasks)
    await report_evaluation_task_manager.start_background_reclaimer()

    report_worker_task = asyncio.create_task(
        report_signal_service.run_background_worker(async_session_maker)
    )

    yield

    if report_worker_task is not None:
        report_worker_task.cancel()
        try:
            await report_worker_task
        except asyncio.CancelledError:
            pass
    await report_evaluation_task_manager.stop_background_reclaimer()

    log.info("Shutting down PwnPilot API")


app = FastAPI(
    title=settings.app_name,
    description="Tactical Pentest Cockpit API",
    version="0.1.0",
    lifespan=lifespan,
)

# Register exception handlers
app.add_exception_handler(AppException, app_exception_handler)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API v1 router - all endpoints under /api/v1/
api_v1 = APIRouter(prefix="/api/v1")
api_v1.include_router(agent_config_router)
api_v1.include_router(agent_process_router)
api_v1.include_router(ai_router)
api_v1.include_router(auth_router)
api_v1.include_router(kb_router)
api_v1.include_router(settings_router)
api_v1.include_router(memberships_router)
api_v1.include_router(mock_mcp_router)
api_v1.include_router(projects_router)
api_v1.include_router(timeline_router)
api_v1.include_router(command_variables_router)
api_v1.include_router(linking_router)
api_v1.include_router(commands_router)
api_v1.include_router(graph_router)
api_v1.include_router(command_categories_router)
api_v1.include_router(command_favorites_router)
api_v1.include_router(command_filters_router)
api_v1.include_router(project_commands_router)
api_v1.include_router(project_engagement_router)
api_v1.include_router(report_router)
api_v1.include_router(project_command_categories_router)
api_v1.include_router(project_command_favorites_router)
api_v1.include_router(project_command_filters_router)
api_v1.include_router(terminal_router)
api_v1.include_router(terminal_viewers_router)
api_v1.include_router(prompts_router)
api_v1.include_router(cmd_history_session_router)
api_v1.include_router(cmd_history_project_router)

app.include_router(api_v1)

# Backward compatibility router (/api/*) to support older frontend builds
legacy_api = APIRouter(prefix="/api")
legacy_api.include_router(agent_config_router)
legacy_api.include_router(agent_process_router)
legacy_api.include_router(ai_router)
legacy_api.include_router(auth_router)
legacy_api.include_router(kb_router)
legacy_api.include_router(settings_router)
legacy_api.include_router(memberships_router)
legacy_api.include_router(mock_mcp_router)
legacy_api.include_router(projects_router)
legacy_api.include_router(timeline_router)
legacy_api.include_router(command_variables_router)
legacy_api.include_router(linking_router)
legacy_api.include_router(commands_router)
legacy_api.include_router(graph_router)
legacy_api.include_router(command_categories_router)
legacy_api.include_router(command_favorites_router)
legacy_api.include_router(command_filters_router)
legacy_api.include_router(project_commands_router)
legacy_api.include_router(project_engagement_router)
legacy_api.include_router(report_router)
legacy_api.include_router(project_command_categories_router)
legacy_api.include_router(project_command_favorites_router)
legacy_api.include_router(project_command_filters_router)
legacy_api.include_router(terminal_router)
legacy_api.include_router(terminal_viewers_router)
legacy_api.include_router(prompts_router)
legacy_api.include_router(cmd_history_session_router)
legacy_api.include_router(cmd_history_project_router)

app.include_router(legacy_api)

# WebSocket routes (no API prefix)
app.include_router(ws_chat_router)

# MCP server endpoint (no API prefix — at /mcp)
app.include_router(mcp_router)


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "app": settings.app_name,
        "version": "0.1.0",
    }
