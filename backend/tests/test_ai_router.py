"""Tests for AI router endpoints."""
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.core.deps import get_current_user
from app.database import get_db
from app.main import app
from app.models.ai import AIConversation, AIProviderConfig, CLISession
from app.models.project import Project
from app.models.user import User
from app.services.console_provider import ConsoleSession
from app.services.provider_factory import get_provider


@pytest.fixture
def mock_user():
    user = MagicMock(spec=User)
    user.id = "test-user-id"
    user.username = "testuser"
    user.is_active = True
    user.is_super_admin = False
    return user


@pytest.fixture
def mock_db():
    db = AsyncMock()
    db.add = MagicMock()
    return db


@pytest.fixture
def mock_terminal_provider():
    session = ConsoleSession(
        id="term-1",
        project_id="project-1",
        name="Claude Code Terminal",
        websocket_url="ws://localhost:7680/ws",
        master_token="master-token",
        viewer_token="viewer-token",
        is_alive=True,
        created_at=datetime.now(timezone.utc),
    )
    provider = MagicMock()
    provider.create_session = AsyncMock(return_value=session)
    provider.get_session = AsyncMock(return_value=session)
    provider.destroy_session = AsyncMock(return_value=True)
    provider.send_input = AsyncMock(return_value=True)
    return provider


@pytest.fixture
def client(mock_user, mock_db):
    """Create test client with auth override."""
    @asynccontextmanager
    async def noop_lifespan(_app):
        yield

    app.dependency_overrides[get_current_user] = lambda: mock_user
    app.dependency_overrides[get_db] = lambda: mock_db
    original_lifespan = app.router.lifespan_context
    app.router.lifespan_context = noop_lifespan

    try:
        with TestClient(app) as c:
            yield c
    finally:
        app.router.lifespan_context = original_lifespan
        app.dependency_overrides.clear()


class TestListProviders:
    def test_list_providers_empty(self, client, mock_db):
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []
        mock_db.execute.return_value = mock_result

        response = client.get("/api/v1/ai/providers")
        assert response.status_code == 200
        assert response.json() == []


class TestCreateProvider:
    def test_create_ollama_provider(self, client, mock_db):
        # Mock the commit + refresh to set the ID and timestamps
        async def mock_refresh(obj):
            obj.id = 1
            obj.user_id = "test-user-id"
            obj.created_at = "2026-01-27T00:00:00"
            obj.updated_at = "2026-01-27T00:00:00"

        mock_db.refresh = mock_refresh

        response = client.post(
            "/api/v1/ai/providers",
            json={
                "provider_type": "ollama",
                "name": "Local Ollama",
                "default_model": "llama3.1:8b",
                "base_url": "http://localhost:11434",
            },
        )

        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "Local Ollama"
        assert data["provider_type"] == "ollama"
        assert data["has_api_key"] is False

    def test_create_provider_validates_type(self, client):
        response = client.post(
            "/api/v1/ai/providers",
            json={
                "provider_type": "invalid",
                "name": "Bad Provider",
                "default_model": "model",
            },
        )
        assert response.status_code == 422

    def test_create_cli_provider_requires_command(self, client):
        response = client.post(
            "/api/v1/ai/providers",
            json={
                "provider_type": "cli",
                "name": "Claude Code",
                "default_model": "claude-sonnet-4-20250514",
                "parse_mode": "json",
            },
        )

        assert response.status_code == 422

    def test_create_cli_provider_returns_cli_fields(self, client, mock_db):
        async def mock_refresh(obj):
            obj.id = 12
            obj.user_id = "test-user-id"
            obj.created_at = "2026-04-16T00:00:00"
            obj.updated_at = "2026-04-16T00:00:00"
            obj.api_key_encrypted = None
            obj.last_health_check = None
            obj.health_status = None

        mock_db.refresh = mock_refresh

        response = client.post(
            "/api/v1/ai/providers",
            json={
                "provider_type": "cli",
                "name": "Claude Code",
                "default_model": "claude-sonnet-4-20250514",
                "cli_command": "claude",
                "cli_args_template": "-p {prompt} --output-format json --model {model}",
                "parse_mode": "json",
                "supports_streaming": True,
                "detected_models": ["claude-sonnet-4-20250514"],
            },
        )

        assert response.status_code == 201
        data = response.json()
        assert data["provider_type"] == "cli"
        assert data["cli_command"] == "claude"
        assert data["parse_mode"] == "json"
        assert data["detected_models"] == ["claude-sonnet-4-20250514"]

    def test_create_codex_cli_provider_defaults_to_recommended_timeout_when_not_provided(
        self, client, mock_db
    ):
        refreshed: AIProviderConfig | None = None

        async def mock_refresh(obj):
            nonlocal refreshed
            refreshed = obj
            obj.id = 13
            obj.user_id = "test-user-id"
            obj.created_at = "2026-04-22T00:00:00"
            obj.updated_at = "2026-04-22T00:00:00"
            obj.api_key_encrypted = None
            obj.last_health_check = None
            obj.health_status = None

        mock_db.refresh = mock_refresh

        response = client.post(
            "/api/v1/ai/providers",
            json={
                "provider_type": "cli",
                "name": "Codex",
                "default_model": "gpt-5.4",
                "cli_command": "codex",
                "cli_args_template": "exec --skip-git-repo-check --json --model {model} {prompt}",
                "parse_mode": "json",
                "supports_streaming": True,
            },
        )

        assert response.status_code == 201
        assert refreshed is not None
        assert refreshed.timeout_seconds == 240


class TestDetectCLIs:
    @patch("app.routers.ai.detect_installed_clis", new_callable=AsyncMock)
    def test_detect_clis_returns_detected_configs(self, mock_detect, client):
        mock_detect.return_value = [
            {
                "provider_type": "cli",
                "name": "Claude Code",
                "default_model": "claude-sonnet-4-20250514",
                "cli_command": "claude",
                "cli_args_template": "-p {prompt} --output-format json --model {model}",
                "cli_interactive_args": "--resume {session_id}",
                "cli_env": None,
                "working_directory": None,
                "parse_mode": "json",
                "supports_streaming": True,
                "supports_resume": True,
                "session_flag": "--resume",
                "detected_version": "1.2.3",
                "detected_models": ["claude-sonnet-4-20250514"],
            }
        ]

        response = client.post("/api/v1/ai/providers/detect-clis")

        assert response.status_code == 200
        assert response.json() == [
            {
                "provider_type": "cli",
                "name": "Claude Code",
                "default_model": "claude-sonnet-4-20250514",
                "cli_command": "claude",
                "cli_args_template": "-p {prompt} --output-format json --model {model}",
                "cli_interactive_args": "--resume {session_id}",
                "cli_env": None,
                "working_directory": None,
                "parse_mode": "json",
                "supports_streaming": True,
                "supports_resume": True,
                "session_flag": "--resume",
                "detected_version": "1.2.3",
                "detected_models": ["claude-sonnet-4-20250514"],
            }
        ]


class TestResolveCLI:
    @patch("app.routers.ai.resolve_cli_command", new_callable=AsyncMock)
    def test_resolve_cli_returns_profile_for_manual_command(self, mock_resolve, client):
        mock_resolve.return_value = {
            "provider_type": "cli",
            "name": "Claude Code",
            "default_model": "claude-sonnet-4-20250514",
            "cli_command": r"C:\Users\operator\.local\bin\claude.exe",
            "cli_args_template": "-p {prompt} --output-format json --model {model}",
            "cli_interactive_args": "--resume {session_id}",
            "cli_env": None,
            "working_directory": None,
            "parse_mode": "json",
            "supports_streaming": True,
            "supports_resume": True,
            "session_flag": "--resume",
            "detected_version": "1.2.3",
            "detected_models": ["claude-sonnet-4-20250514", "claude-opus-4-20250514"],
        }

        response = client.post(
            "/api/v1/ai/providers/resolve-cli",
            json={"cli_command": r"C:\Users\operator\.local\bin\claude.exe"},
        )

        assert response.status_code == 200
        assert response.json() == {
            "provider_type": "cli",
            "name": "Claude Code",
            "default_model": "claude-sonnet-4-20250514",
            "cli_command": r"C:\Users\operator\.local\bin\claude.exe",
            "cli_args_template": "-p {prompt} --output-format json --model {model}",
            "cli_interactive_args": "--resume {session_id}",
            "cli_env": None,
            "working_directory": None,
            "parse_mode": "json",
            "supports_streaming": True,
            "supports_resume": True,
            "session_flag": "--resume",
            "detected_version": "1.2.3",
            "detected_models": ["claude-sonnet-4-20250514", "claude-opus-4-20250514"],
        }


class TestCLISessions:
    def test_creates_an_interactive_cli_session(self, client, mock_db, mock_terminal_provider):
        app.dependency_overrides[get_provider] = lambda: mock_terminal_provider

        conversation = MagicMock(spec=AIConversation)
        conversation.id = "conv-1"
        conversation.user_id = "test-user-id"
        conversation.project_id = "project-1"
        conversation.model = "claude-sonnet-4-20250514"
        conversation.provider_config_id = None

        provider_config = MagicMock(spec=AIProviderConfig)
        provider_config.id = 99
        provider_config.user_id = "test-user-id"
        provider_config.provider_type = "cli"
        provider_config.name = "Claude Code"
        provider_config.cli_command = "claude"
        provider_config.cli_interactive_args = ""
        provider_config.default_model = "claude-sonnet-4-20250514"
        provider_config.working_directory = None

        project = MagicMock(spec=Project)
        project.workspace_path = "/workspace/project-1"

        async def mock_get(model, identity):
            if model is AIConversation and identity == "conv-1":
                return conversation
            if model is AIProviderConfig and identity == 99:
                return provider_config
            if model is Project and identity == "project-1":
                return project
            return None

        async def mock_refresh(obj):
            obj.id = "cli-session-1"
            obj.started_at = datetime(2026, 4, 16, 12, 0, 0, tzinfo=timezone.utc)
            obj.last_imported_at = None
            obj.exited_at = None

        mock_db.get.side_effect = mock_get
        mock_db.refresh = mock_refresh

        existing_result = MagicMock()
        existing_result.scalars.return_value.first.return_value = None
        mock_db.execute.return_value = existing_result

        response = client.post(
            "/api/v1/ai/cli-sessions",
            json={
                "conversation_id": "conv-1",
                "provider_config_id": 99,
            },
        )

        assert response.status_code == 201
        data = response.json()
        assert data["id"] == "cli-session-1"
        assert data["conversation_id"] == "conv-1"
        assert data["provider_config_id"] == 99
        assert data["terminal_session_id"] == "term-1"
        assert data["terminal_websocket_url"] == "ws://localhost:7680/ws"
        assert data["status"] == "running"
        mock_terminal_provider.create_session.assert_awaited_once()
        mock_terminal_provider.send_input.assert_awaited_once_with("term-1", "claude\n")

    def test_creates_a_codex_interactive_cli_session_with_default_model(
        self,
        client,
        mock_db,
        mock_terminal_provider,
    ):
        app.dependency_overrides[get_provider] = lambda: mock_terminal_provider

        conversation = MagicMock(spec=AIConversation)
        conversation.id = "conv-1"
        conversation.user_id = "test-user-id"
        conversation.project_id = None
        conversation.model = "gpt-5.4"
        conversation.provider_config_id = None

        provider_config = MagicMock(spec=AIProviderConfig)
        provider_config.id = 42
        provider_config.user_id = "test-user-id"
        provider_config.provider_type = "cli"
        provider_config.name = "Codex"
        provider_config.cli_command = "codex"
        provider_config.cli_args_template = "--quiet --model {model} {prompt}"
        provider_config.cli_interactive_args = None
        provider_config.default_model = "gpt-5.4"
        provider_config.working_directory = None
        provider_config.parse_mode = "markdown"
        provider_config.supports_streaming = False
        provider_config.supports_resume = False
        provider_config.session_flag = None

        async def mock_get(model, identity):
            if model is AIConversation and identity == "conv-1":
                return conversation
            if model is AIProviderConfig and identity == 42:
                return provider_config
            return None

        async def mock_refresh(obj):
            obj.id = "cli-session-codex"
            obj.started_at = datetime(2026, 4, 16, 12, 0, 0, tzinfo=timezone.utc)
            obj.last_imported_at = None
            obj.exited_at = None

        mock_db.get.side_effect = mock_get
        mock_db.refresh = mock_refresh

        existing_result = MagicMock()
        existing_result.scalars.return_value.first.return_value = None
        mock_db.execute.return_value = existing_result

        response = client.post(
            "/api/v1/ai/cli-sessions",
            json={
                "conversation_id": "conv-1",
                "provider_config_id": 42,
            },
        )

        assert response.status_code == 201
        mock_terminal_provider.send_input.assert_awaited_once_with(
            "term-1",
            "codex --model gpt-5.4\n",
        )

    def test_imports_terminal_history_into_the_conversation(self, client, mock_db):
        cli_session = MagicMock(spec=CLISession)
        cli_session.id = "cli-session-1"
        cli_session.conversation_id = "conv-1"
        cli_session.provider_config_id = 99
        cli_session.terminal_session_id = "term-1"
        cli_session.last_imported_at = None

        conversation = MagicMock(spec=AIConversation)
        conversation.id = "conv-1"
        conversation.user_id = "test-user-id"
        conversation.model = "claude-sonnet-4-20250514"

        provider_config = MagicMock(spec=AIProviderConfig)
        provider_config.id = 99
        provider_config.user_id = "test-user-id"
        provider_config.name = "Claude Code"
        provider_config.default_model = "claude-sonnet-4-20250514"

        command = MagicMock()
        command.command = "claude"
        command.output = "Planning next steps"
        command.exit_code = 0
        command.duration_ms = 4200
        command.created_at = datetime(2026, 4, 16, 12, 5, 0, tzinfo=timezone.utc)
        command.id = "cmd-1"

        cli_session_result = MagicMock()
        cli_session_result.scalar_one_or_none.return_value = cli_session
        command_result = MagicMock()
        command_result.scalars.return_value.all.return_value = [command]
        mock_db.execute.side_effect = [cli_session_result, command_result]

        async def mock_get(model, identity):
            if model is AIConversation and identity == "conv-1":
                return conversation
            if model is AIProviderConfig and identity == 99:
                return provider_config
            return None

        mock_db.get.side_effect = mock_get

        response = client.post("/api/v1/ai/cli-sessions/cli-session-1/import")

        assert response.status_code == 200
        data = response.json()
        assert data["cli_session_id"] == "cli-session-1"
        assert data["imported_commands"] == 1
        assert data["imported_messages"] == 2
        assert cli_session.last_imported_at == command.created_at
        assert mock_db.add.call_count == 2


class TestConversationExport:
    def test_exports_a_conversation_as_markdown(self, client, mock_db):
        conversation = MagicMock()
        conversation.id = "conv-1"
        conversation.user_id = "test-user-id"
        conversation.title = "Recon Notes"

        mock_db.get.return_value = conversation

        user_message = MagicMock()
        user_message.role = "user"
        user_message.content = "scan 10.10.10.5"
        user_message.model = None
        user_message.provider = None
        user_message.created_at = "2026-04-16T10:00:00Z"

        assistant_message = MagicMock()
        assistant_message.role = "assistant"
        assistant_message.content = "Open ports: 22, 80"
        assistant_message.model = "claude-sonnet-4-20250514"
        assistant_message.provider = "Claude Code"
        assistant_message.created_at = "2026-04-16T10:01:00Z"

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [
            user_message,
            assistant_message,
        ]
        mock_db.execute.return_value = mock_result

        response = client.post("/api/v1/ai/conversations/conv-1/export?format=markdown")

        assert response.status_code == 200
        data = response.json()
        assert data["format"] == "markdown"
        assert data["filename"] == "recon-notes.md"
        assert "Recon Notes" in data["content"]
        assert "scan 10.10.10.5" in data["content"]
        assert "Open ports: 22, 80" in data["content"]

    def test_exports_a_conversation_for_codex(self, client, mock_db):
        conversation = MagicMock()
        conversation.id = "conv-1"
        conversation.user_id = "test-user-id"
        conversation.title = "Recon Notes"

        mock_db.get.return_value = conversation

        assistant_message = MagicMock()
        assistant_message.role = "assistant"
        assistant_message.content = "Use smbclient next."
        assistant_message.model = "o4-mini"
        assistant_message.provider = "Codex"
        assistant_message.created_at = "2026-04-16T10:01:00Z"

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [assistant_message]
        mock_db.execute.return_value = mock_result

        response = client.post("/api/v1/ai/conversations/conv-1/export?format=codex")

        assert response.status_code == 200
        data = response.json()
        assert data["format"] == "codex"
        assert data["filename"] == "recon-notes-codex.md"
        assert "codex --model o4-mini" in data["resume_command"]


class TestConversationDefaultsAndRouting:
    def test_create_conversation_uses_global_general_routing_defaults(
        self, client, mock_db
    ):
        routing = MagicMock()
        routing.provider_config_id = 42
        routing.model = "gpt-5.4-mini"

        no_project_override = MagicMock()
        no_project_override.scalar_one_or_none.return_value = None
        global_routing = MagicMock()
        global_routing.scalar_one_or_none.return_value = routing
        mock_db.execute.side_effect = [no_project_override, global_routing]

        async def mock_refresh(obj):
            obj.id = "conv-42"
            obj.pinned = False
            obj.created_at = datetime(2026, 4, 27, 10, 0, 0, tzinfo=timezone.utc)
            obj.updated_at = datetime(2026, 4, 27, 10, 0, 0, tzinfo=timezone.utc)

        mock_db.refresh = mock_refresh

        response = client.post(
            "/api/v1/ai/conversations",
            json={"project_id": "project-1"},
        )

        assert response.status_code == 201
        data = response.json()
        assert data["provider_config_id"] == 42
        assert data["model"] == "gpt-5.4-mini"

    def test_update_routing_accepts_model_overrides(self, client, mock_db):
        async def mock_refresh(obj):
            obj.id = 7
            obj.user_id = "test-user-id"

        mock_db.refresh = mock_refresh

        response = client.put(
            "/api/v1/ai/routing",
            json=[
                {
                    "context_type": "general",
                    "provider_config_id": 3,
                    "model": "claude-sonnet-4-20250514",
                    "project_id": None,
                },
                {
                    "context_type": "reporting",
                    "provider_config_id": 5,
                    "model": "gemini-2.5-pro",
                    "project_id": None,
                },
            ],
        )

        assert response.status_code == 200
        data = response.json()
        assert data[0]["model"] == "claude-sonnet-4-20250514"
        assert data[1]["context_type"] == "reporting"
        assert data[1]["model"] == "gemini-2.5-pro"
