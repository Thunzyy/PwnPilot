"""Tests for LLM service (factory + routing)."""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai import AIContextRouting, AIProviderConfig
from app.services.llm import (
    AnthropicProvider,
    CLIProvider,
    OllamaProvider,
    OpenAICompatibleProvider,
    OpenAIProvider,
)
from app.services.llm_service import LLMService, _DeterministicReportingProvider


@pytest.fixture
def mock_db():
    """Create a mock database session."""
    return AsyncMock(spec=AsyncSession)


@pytest.fixture
def llm_service(mock_db):
    """Create an LLM service for testing."""
    return LLMService(mock_db)


@pytest.fixture
def ollama_config():
    """Create a mock Ollama provider config."""
    config = MagicMock(spec=AIProviderConfig)
    config.id = 1
    config.user_id = "user-1"
    config.provider_type = "ollama"
    config.name = "Local Ollama"
    config.is_enabled = True
    config.base_url = "http://localhost:11434"
    config.api_key_encrypted = None
    config.timeout_seconds = 30
    config.default_model = "llama3.1:8b"
    config.temperature = 0.7
    config.max_tokens = 2048
    config.top_p = 1.0
    config.custom_headers = None
    return config


@pytest.fixture
def openai_compat_config():
    """Create a mock OpenAI-compatible provider config."""
    config = MagicMock(spec=AIProviderConfig)
    config.id = 2
    config.provider_type = "openai_compat"
    config.name = "LM Studio"
    config.is_enabled = True
    config.base_url = "http://localhost:1234/v1"
    config.api_key_encrypted = None
    config.timeout_seconds = 30
    config.default_model = "local-model"
    config.temperature = 0.7
    config.max_tokens = 2048
    config.top_p = 1.0
    config.custom_headers = {"X-Custom": "value"}
    return config


@pytest.fixture
def openai_config():
    """Create a mock OpenAI provider config."""
    config = MagicMock(spec=AIProviderConfig)
    config.id = 3
    config.provider_type = "openai"
    config.name = "OpenAI"
    config.is_enabled = True
    config.base_url = None
    config.api_key_encrypted = b"encrypted_key"
    config.timeout_seconds = 30
    config.default_model = "gpt-4o"
    config.temperature = 0.7
    config.max_tokens = 4096
    config.top_p = 1.0
    config.custom_headers = None
    return config


@pytest.fixture
def anthropic_config():
    """Create a mock Anthropic provider config."""
    config = MagicMock(spec=AIProviderConfig)
    config.id = 4
    config.provider_type = "anthropic"
    config.name = "Anthropic"
    config.is_enabled = True
    config.base_url = None
    config.api_key_encrypted = b"encrypted_key"
    config.timeout_seconds = 30
    config.default_model = "claude-3-5-sonnet-20241022"
    config.temperature = 0.7
    config.max_tokens = 4096
    config.top_p = 1.0
    config.custom_headers = None
    return config


@pytest.fixture
def cli_config():
    """Create a mock CLI provider config."""
    config = MagicMock(spec=AIProviderConfig)
    config.id = 5
    config.provider_type = "cli"
    config.name = "Claude Code"
    config.is_enabled = True
    config.base_url = None
    config.api_key_encrypted = None
    config.timeout_seconds = 120
    config.default_model = "claude-sonnet-4-20250514"
    config.temperature = 0.7
    config.max_tokens = 4096
    config.top_p = 1.0
    config.custom_headers = None
    config.cli_command = "claude"
    config.cli_args_template = '-p {prompt} --output-format json --model {model}'
    config.cli_interactive_args = "--resume {session_id}"
    config.cli_env = {"PATH": "C:/tools"}
    config.working_directory = "C:/workspace"
    config.parse_mode = "json"
    config.supports_streaming = True
    config.supports_resume = True
    config.session_flag = "--resume"
    config.detected_version = "1.2.3"
    config.detected_models = ["claude-sonnet-4-20250514", "claude-opus-4-20250514"]
    return config


class TestCreateProvider:
    """Tests for provider factory method."""

    def test_create_ollama_provider(self, llm_service, ollama_config):
        """Test creating Ollama provider from config."""
        provider = llm_service.create_provider(ollama_config)

        assert isinstance(provider, OllamaProvider)
        assert provider.base_url == "http://localhost:11434"
        assert provider.default_model == "llama3.1:8b"

    def test_create_openai_compat_provider(self, llm_service, openai_compat_config):
        """Test creating OpenAI-compatible provider from config."""
        provider = llm_service.create_provider(openai_compat_config)

        assert isinstance(provider, OpenAICompatibleProvider)
        assert provider.base_url == "http://localhost:1234/v1"
        assert provider.custom_headers == {"X-Custom": "value"}

    @patch("app.services.llm_service.decrypt_api_key")
    def test_create_openai_provider(self, mock_decrypt, llm_service, openai_config):
        """Test creating OpenAI provider from config."""
        mock_decrypt.return_value = "sk-test-key"

        provider = llm_service.create_provider(openai_config)

        assert isinstance(provider, OpenAIProvider)
        assert provider.api_key == "sk-test-key"
        mock_decrypt.assert_called_once()

    @patch("app.services.llm_service.decrypt_api_key")
    def test_create_anthropic_provider(self, mock_decrypt, llm_service, anthropic_config):
        """Test creating Anthropic provider from config."""
        mock_decrypt.return_value = "sk-ant-test-key"

        provider = llm_service.create_provider(anthropic_config)

        assert isinstance(provider, AnthropicProvider)
        assert provider.api_key == "sk-ant-test-key"

    def test_create_cli_provider(self, llm_service, cli_config):
        """Test creating a CLI provider from config."""
        provider = llm_service.create_provider(cli_config)

        assert isinstance(provider, CLIProvider)
        assert provider.cli_command == "claude"
        assert provider.parse_mode == "json"
        assert provider.detected_models == [
            "claude-sonnet-4-20250514",
            "claude-opus-4-20250514",
        ]

    def test_create_cli_provider_upgrades_legacy_codex_runtime_settings(self, llm_service):
        """Legacy Codex configs should be normalized to the current CLI invocation."""
        config = MagicMock(spec=AIProviderConfig)
        config.id = 6
        config.user_id = "user-1"
        config.provider_type = "cli"
        config.name = "Codex"
        config.is_enabled = True
        config.base_url = None
        config.api_key_encrypted = None
        config.timeout_seconds = 120
        config.default_model = "gpt-5.4"
        config.temperature = 0.7
        config.max_tokens = 4096
        config.top_p = 1.0
        config.custom_headers = None
        config.cli_command = r"C:\Users\operator\AppData\Roaming\npm\codex.CMD"
        config.cli_args_template = "--quiet --model {model} {prompt}"
        config.cli_interactive_args = None
        config.cli_env = None
        config.working_directory = None
        config.parse_mode = "markdown"
        config.supports_streaming = False
        config.supports_resume = False
        config.session_flag = None
        config.detected_version = "codex-cli 0.114.0"
        config.detected_models = ["gpt-5.4"]

        provider = llm_service.create_provider(config)

        assert isinstance(provider, CLIProvider)
        assert provider.cli_args_template == (
            "exec --skip-git-repo-check --json --model {model} {prompt}"
        )
        assert provider.cli_interactive_args == "--model {model}"
        assert provider.parse_mode == "json"
        assert provider.supports_streaming is True

    def test_create_provider_unknown_type_raises(self, llm_service):
        """Test that unknown provider type raises ValueError."""
        config = MagicMock()
        config.provider_type = "unknown"

        with pytest.raises(ValueError, match="Unknown provider type"):
            llm_service.create_provider(config)

    def test_create_provider_disabled_raises(self, llm_service, ollama_config):
        """Test that disabled provider raises ValueError."""
        ollama_config.is_enabled = False

        with pytest.raises(ValueError, match="Provider is disabled"):
            llm_service.create_provider(ollama_config)


class TestGetProviderForContext:
    """Tests for context-based provider routing."""

    @pytest.mark.anyio
    async def test_get_provider_project_override(self, llm_service, mock_db, ollama_config):
        """Test that project-level routing overrides global."""
        # Setup routing that points to ollama_config
        routing = MagicMock(spec=AIContextRouting)
        routing.provider_config = ollama_config

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = routing
        mock_db.execute.return_value = mock_result

        provider = await llm_service.get_provider_for_context(
            user_id="user-1",
            context_type="chat",
            project_id="proj-1",
        )

        assert isinstance(provider, OllamaProvider)

    @pytest.mark.anyio
    async def test_get_provider_global_fallback(self, llm_service, mock_db, ollama_config):
        """Test falling back to global routing when no project override."""
        routing = MagicMock(spec=AIContextRouting)
        routing.provider_config = ollama_config

        # First call (project-specific) returns None, second (global) returns routing
        mock_result_none = MagicMock()
        mock_result_none.scalar_one_or_none.return_value = None

        mock_result_routing = MagicMock()
        mock_result_routing.scalar_one_or_none.return_value = routing

        mock_db.execute.side_effect = [mock_result_none, mock_result_routing]

        provider = await llm_service.get_provider_for_context(
            user_id="user-1",
            context_type="chat",
            project_id="proj-1",
        )

        assert isinstance(provider, OllamaProvider)
        assert mock_db.execute.call_count == 2

    @pytest.mark.anyio
    async def test_get_provider_applies_routing_model_override(
        self, llm_service, mock_db, ollama_config
    ):
        """Test that routing model overrides the provider default model."""
        routing = MagicMock(spec=AIContextRouting)
        routing.provider_config = ollama_config
        routing.model = "llama3.1:70b"

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = routing
        mock_db.execute.return_value = mock_result

        provider = await llm_service.get_provider_for_context(
            user_id="user-1",
            context_type="general",
        )

        assert isinstance(provider, OllamaProvider)
        assert provider.default_model == "llama3.1:70b"

    @pytest.mark.anyio
    async def test_get_provider_no_routing_returns_none(self, llm_service, mock_db):
        """Test that missing routing returns None."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute.return_value = mock_result

        provider = await llm_service.get_provider_for_context(
            user_id="user-1",
            context_type="chat",
        )

        assert provider is None


class TestGetProviderById:
    """Tests for getting provider by ID."""

    @pytest.mark.anyio
    async def test_get_provider_by_id(self, llm_service, mock_db, ollama_config):
        """Test getting a provider by its ID."""
        mock_db.get.return_value = ollama_config

        provider = await llm_service.get_provider_by_id(1, user_id="user-1")

        assert isinstance(provider, OllamaProvider)

    @pytest.mark.anyio
    async def test_get_provider_by_id_not_found(self, llm_service, mock_db):
        """Test that missing provider returns None."""
        mock_db.get.return_value = None

        provider = await llm_service.get_provider_by_id(999, user_id="user-1")

        assert provider is None

    @pytest.mark.anyio
    async def test_get_provider_by_id_wrong_user(self, llm_service, mock_db, ollama_config):
        """Test that provider owned by different user returns None."""
        ollama_config.user_id = "other-user"
        mock_db.get.return_value = ollama_config

        provider = await llm_service.get_provider_by_id(1, user_id="user-1")

        assert provider is None


class TestProviderCaching:
    """Tests for provider instance caching."""

    def test_providers_are_cached(self, llm_service, ollama_config):
        """Test that same config returns cached provider instance."""
        provider1 = llm_service.create_provider(ollama_config)
        provider2 = llm_service.create_provider(ollama_config)

        assert provider1 is provider2

    def test_cache_cleared_on_config_update(self, llm_service, ollama_config):
        """Test that cache is cleared when config updates."""
        provider1 = llm_service.create_provider(ollama_config)

        llm_service.clear_cache(ollama_config.id)

        provider2 = llm_service.create_provider(ollama_config)
        assert provider1 is not provider2


class TestDeterministicReportingProvider:
    def test_graph_label_prefers_exact_match_over_partial_match(self):
        provider = _DeterministicReportingProvider()
        delta_pack = {
            "graph_nodes": [
                {"type": "action", "label": "Read root.txt"},
                {"type": "loot", "label": "root.txt"},
            ]
        }

        assert provider._graph_label(delta_pack, "root.txt") == "root.txt"

    def test_command_timeline_snippet_prefers_tail_artifact_over_banner(self):
        command = {
            "output": (
                "spawn ssh -o StrictHostKeyChecking=no nathan@10.129.34.191 /usr/bin/python3.8 -c '...'\n"
                "** WARNING: connection is not using a post-quantum key exchange algorithm.\n"
                "391aad4e9ee903704a5c0208a52afdd7"
            )
        }

        assert (
            _DeterministicReportingProvider._command_timeline_snippet(command)
            == "`391aad4e9ee903704a5c0208a52afdd7`"
        )
