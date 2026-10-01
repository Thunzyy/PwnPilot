"""Tests for Anthropic Claude provider."""

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.services.llm.anthropic_provider import AnthropicProvider


@pytest.fixture
def anthropic_provider():
    """Create an Anthropic provider for testing."""
    return AnthropicProvider(
        api_key="test-api-key",
        timeout=30,
        default_model="claude-3-5-sonnet-20241022",
        temperature=0.7,
        max_tokens=2048,
        top_p=1.0,
    )


class TestInitialization:
    """Test provider initialization."""

    def test_init_with_api_key(self, anthropic_provider):
        """Test initialization with API key."""
        assert anthropic_provider.api_key == "test-api-key"
        assert anthropic_provider.base_url == "https://api.anthropic.com"
        assert anthropic_provider.default_model == "claude-3-5-sonnet-20241022"
        assert anthropic_provider.timeout == 30
        assert anthropic_provider.temperature == 0.7
        assert anthropic_provider.max_tokens == 2048
        assert anthropic_provider.top_p == 1.0

    def test_init_requires_api_key(self):
        """Test that API key is required."""
        with pytest.raises(ValueError, match="API key is required"):
            AnthropicProvider(
                api_key="",
                timeout=30,
                default_model="claude-3-5-sonnet-20241022",
                temperature=0.7,
                max_tokens=2048,
                top_p=1.0,
            )

    def test_init_requires_api_key_none(self):
        """Test that None API key raises error."""
        with pytest.raises(ValueError, match="API key is required"):
            AnthropicProvider(
                api_key=None,
                timeout=30,
                default_model="claude-3-5-sonnet-20241022",
                temperature=0.7,
                max_tokens=2048,
                top_p=1.0,
            )

    def test_init_with_custom_headers(self):
        """Test initialization with custom headers."""
        provider = AnthropicProvider(
            api_key="key",
            timeout=30,
            default_model="claude-3-5-sonnet-20241022",
            temperature=0.7,
            max_tokens=2048,
            top_p=1.0,
            custom_headers={"X-Custom": "value"},
        )
        assert provider.custom_headers == {"X-Custom": "value"}


class TestHeaders:
    """Test header generation."""

    def test_get_headers_uses_x_api_key(self, anthropic_provider):
        """Test headers use x-api-key instead of Bearer token."""
        headers = anthropic_provider._get_headers()
        assert headers["x-api-key"] == "test-api-key"
        assert "Authorization" not in headers
        assert headers["Content-Type"] == "application/json"
        assert headers["anthropic-version"] == "2023-06-01"

    def test_get_headers_includes_custom_headers(self):
        """Test custom headers are included."""
        provider = AnthropicProvider(
            api_key="key",
            timeout=30,
            default_model="claude-3-5-sonnet-20241022",
            temperature=0.7,
            max_tokens=2048,
            top_p=1.0,
            custom_headers={"X-Custom": "custom-value"},
        )
        headers = provider._get_headers()
        assert headers["X-Custom"] == "custom-value"
        assert headers["x-api-key"] == "key"


class TestMessageConversion:
    """Test OpenAI to Anthropic message conversion."""

    def test_convert_messages_extracts_system(self, anthropic_provider):
        """Test system message is extracted from messages."""
        messages = [
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "Hello!"},
        ]
        system, converted = anthropic_provider._convert_messages(messages)
        assert system == "You are a helpful assistant."
        assert len(converted) == 1
        assert converted[0] == {"role": "user", "content": "Hello!"}

    def test_convert_messages_no_system(self, anthropic_provider):
        """Test conversion when no system message."""
        messages = [
            {"role": "user", "content": "Hello!"},
            {"role": "assistant", "content": "Hi!"},
        ]
        system, converted = anthropic_provider._convert_messages(messages)
        assert system is None
        assert len(converted) == 2
        assert converted[0] == {"role": "user", "content": "Hello!"}
        assert converted[1] == {"role": "assistant", "content": "Hi!"}

    def test_convert_messages_preserves_order(self, anthropic_provider):
        """Test message order is preserved."""
        messages = [
            {"role": "system", "content": "System prompt"},
            {"role": "user", "content": "First"},
            {"role": "assistant", "content": "Response"},
            {"role": "user", "content": "Second"},
        ]
        system, converted = anthropic_provider._convert_messages(messages)
        assert system == "System prompt"
        assert len(converted) == 3
        assert converted[0]["content"] == "First"
        assert converted[1]["content"] == "Response"
        assert converted[2]["content"] == "Second"


class TestModelListing:
    """Test model listing."""

    @pytest.mark.anyio
    async def test_list_models_returns_hardcoded(self, anthropic_provider):
        """Test listing models returns hardcoded list (no API call)."""
        models = await anthropic_provider.list_models()
        assert "claude-3-5-sonnet-20241022" in models
        assert "claude-3-5-haiku-20241022" in models
        assert "claude-3-opus-20240229" in models
        assert "claude-3-sonnet-20240229" in models
        assert "claude-3-haiku-20240307" in models
        assert len(models) >= 5


class TestTokenCounting:
    """Test token counting."""

    def test_count_tokens_returns_positive(self, anthropic_provider):
        """Test token counting returns positive count for non-empty text."""
        text = "Hello, world!"
        count = anthropic_provider.count_tokens(text)
        assert count > 0
        assert count < len(text)

    def test_count_tokens_empty_string(self, anthropic_provider):
        """Test token counting with empty string."""
        count = anthropic_provider.count_tokens("")
        assert count == 0

    def test_count_tokens_long_text(self, anthropic_provider):
        """Test token counting with longer text."""
        text = "This is a longer text that should produce more tokens." * 10
        count = anthropic_provider.count_tokens(text)
        assert count > 0


class TestConnectionTesting:
    """Test connection health checks."""

    @pytest.mark.anyio
    async def test_connection_success(self, anthropic_provider):
        """Test successful connection check."""
        mock_response = MagicMock()
        mock_response.status_code = 200

        with patch("httpx.AsyncClient") as mock_client:
            mock_instance = AsyncMock()
            mock_instance.post = AsyncMock(return_value=mock_response)
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=None)
            mock_client.return_value = mock_instance

            result = await anthropic_provider.test_connection()

        assert result.status == "ok"
        assert result.error_code is None
        assert result.latency_ms >= 0

    @pytest.mark.anyio
    async def test_connection_auth_failure(self, anthropic_provider):
        """Test connection check with 401 auth failure."""
        mock_response = MagicMock()
        mock_response.status_code = 401

        with patch("httpx.AsyncClient") as mock_client:
            mock_instance = AsyncMock()
            mock_instance.post = AsyncMock(return_value=mock_response)
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=None)
            mock_client.return_value = mock_instance

            result = await anthropic_provider.test_connection()

        assert result.status == "error"
        assert result.error_code == "AI_AUTH_INVALID"
        assert "Invalid API key" in result.error_detail

    @pytest.mark.anyio
    async def test_connection_rate_limited(self, anthropic_provider):
        """Test connection check with 429 rate limit."""
        mock_response = MagicMock()
        mock_response.status_code = 429

        with patch("httpx.AsyncClient") as mock_client:
            mock_instance = AsyncMock()
            mock_instance.post = AsyncMock(return_value=mock_response)
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=None)
            mock_client.return_value = mock_instance

            result = await anthropic_provider.test_connection()

        assert result.status == "degraded"
        assert result.error_code == "AI_RATE_LIMITED"
        assert "Rate limited" in result.error_detail

    @pytest.mark.anyio
    async def test_connection_http_error(self, anthropic_provider):
        """Test connection check with other HTTP error."""
        mock_response = MagicMock()
        mock_response.status_code = 500

        with patch("httpx.AsyncClient") as mock_client:
            mock_instance = AsyncMock()
            mock_instance.post = AsyncMock(return_value=mock_response)
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=None)
            mock_client.return_value = mock_instance

            result = await anthropic_provider.test_connection()

        assert result.status == "error"
        assert result.error_code == "AI_PROVIDER_ERROR"
        assert "500" in result.error_detail

    @pytest.mark.anyio
    async def test_connection_connect_error(self, anthropic_provider):
        """Test connection check with connection error."""
        with patch("httpx.AsyncClient") as mock_client:
            mock_instance = AsyncMock()
            mock_instance.post = AsyncMock(side_effect=httpx.ConnectError("Connection refused"))
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=None)
            mock_client.return_value = mock_instance

            result = await anthropic_provider.test_connection()

        assert result.status == "error"
        assert result.error_code == "AI_PROVIDER_UNREACHABLE"

    @pytest.mark.anyio
    async def test_connection_timeout(self, anthropic_provider):
        """Test connection check with timeout."""
        with patch("httpx.AsyncClient") as mock_client:
            mock_instance = AsyncMock()
            mock_instance.post = AsyncMock(side_effect=httpx.TimeoutException("Timeout"))
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=None)
            mock_client.return_value = mock_instance

            result = await anthropic_provider.test_connection()

        assert result.status == "error"
        assert result.error_code == "AI_TIMEOUT"
        assert "timed out" in result.error_detail

    @pytest.mark.anyio
    async def test_connection_generic_error(self, anthropic_provider):
        """Test connection check with generic exception."""
        with patch("httpx.AsyncClient") as mock_client:
            mock_instance = AsyncMock()
            mock_instance.post = AsyncMock(side_effect=Exception("Unexpected error"))
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=None)
            mock_client.return_value = mock_instance

            result = await anthropic_provider.test_connection()

        assert result.status == "error"
        assert result.error_code == "AI_PROVIDER_UNREACHABLE"


class TestHelperMethods:
    """Test helper methods inherited from base."""

    def test_get_model_with_override(self, anthropic_provider):
        """Test _get_model with override."""
        result = anthropic_provider._get_model("claude-3-opus-20240229")
        assert result == "claude-3-opus-20240229"

    def test_get_model_default(self, anthropic_provider):
        """Test _get_model with default."""
        result = anthropic_provider._get_model(None)
        assert result == "claude-3-5-sonnet-20241022"

    def test_get_temperature_with_override(self, anthropic_provider):
        """Test _get_temperature with override."""
        result = anthropic_provider._get_temperature(0.5)
        assert result == 0.5

    def test_get_temperature_default(self, anthropic_provider):
        """Test _get_temperature with default."""
        result = anthropic_provider._get_temperature(None)
        assert result == 0.7

    def test_get_max_tokens_with_override(self, anthropic_provider):
        """Test _get_max_tokens with override."""
        result = anthropic_provider._get_max_tokens(1024)
        assert result == 1024

    def test_get_max_tokens_default(self, anthropic_provider):
        """Test _get_max_tokens with default."""
        result = anthropic_provider._get_max_tokens(None)
        assert result == 2048
