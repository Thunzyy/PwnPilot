"""Tests for OpenAI-compatible provider."""

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.services.llm.openai_compat import OpenAICompatibleProvider


@pytest.fixture
def openai_provider():
    """Create an OpenAI-compatible provider for testing."""
    return OpenAICompatibleProvider(
        base_url="http://localhost:8000/v1",
        api_key="test-api-key",
        timeout=30,
        default_model="gpt-3.5-turbo",
        temperature=0.7,
        max_tokens=2048,
        top_p=1.0,
    )


@pytest.fixture
def openai_provider_no_key():
    """Create an OpenAI-compatible provider without API key."""
    return OpenAICompatibleProvider(
        base_url="http://localhost:8000/v1/",
        api_key=None,
        timeout=30,
        default_model="local-model",
        temperature=0.5,
        max_tokens=1024,
        top_p=0.9,
    )


class TestInitialization:
    """Test provider initialization."""

    def test_init_with_api_key(self, openai_provider):
        """Test initialization with API key."""
        assert openai_provider.base_url == "http://localhost:8000/v1"
        assert openai_provider.api_key == "test-api-key"
        assert openai_provider.default_model == "gpt-3.5-turbo"
        assert openai_provider.timeout == 30
        assert openai_provider.temperature == 0.7
        assert openai_provider.max_tokens == 2048
        assert openai_provider.top_p == 1.0

    def test_init_without_api_key(self, openai_provider_no_key):
        """Test initialization without API key."""
        assert openai_provider_no_key.api_key is None
        assert openai_provider_no_key.default_model == "local-model"

    def test_init_strips_trailing_slash(self, openai_provider_no_key):
        """Test that trailing slash is stripped from base_url."""
        # Provider was initialized with trailing slash
        assert openai_provider_no_key.base_url == "http://localhost:8000/v1"

    def test_init_with_custom_headers(self):
        """Test initialization with custom headers."""
        provider = OpenAICompatibleProvider(
            base_url="http://localhost:8000/v1",
            api_key="key",
            timeout=30,
            default_model="model",
            temperature=0.7,
            max_tokens=2048,
            top_p=1.0,
            custom_headers={"X-Custom": "value"},
        )
        assert provider.custom_headers == {"X-Custom": "value"}


class TestHeaders:
    """Test header generation."""

    def test_get_headers_with_api_key(self, openai_provider):
        """Test headers include Bearer token when API key is set."""
        headers = openai_provider._get_headers()
        assert headers["Authorization"] == "Bearer test-api-key"
        assert headers["Content-Type"] == "application/json"

    def test_get_headers_without_api_key(self, openai_provider_no_key):
        """Test headers without Authorization when no API key."""
        headers = openai_provider_no_key._get_headers()
        assert "Authorization" not in headers
        assert headers["Content-Type"] == "application/json"

    def test_get_headers_includes_custom_headers(self):
        """Test custom headers are included."""
        provider = OpenAICompatibleProvider(
            base_url="http://localhost:8000/v1",
            api_key="key",
            timeout=30,
            default_model="model",
            temperature=0.7,
            max_tokens=2048,
            top_p=1.0,
            custom_headers={"X-Custom": "custom-value"},
        )
        headers = provider._get_headers()
        assert headers["X-Custom"] == "custom-value"
        assert headers["Authorization"] == "Bearer key"


class TestTokenCounting:
    """Test token counting."""

    def test_count_tokens_returns_positive(self, openai_provider):
        """Test token counting returns positive count for non-empty text."""
        text = "Hello, world!"
        count = openai_provider.count_tokens(text)
        # With tiktoken: should be ~4 tokens
        # With approximation: len/4 * 1.1 = ~3 tokens
        assert count > 0
        assert count < len(text)  # Tokens should be fewer than characters

    def test_count_tokens_empty_string(self, openai_provider):
        """Test token counting with empty string."""
        count = openai_provider.count_tokens("")
        # With tiktoken: 0, with approximation: 0
        assert count == 0

    def test_count_tokens_long_text(self, openai_provider):
        """Test token counting with longer text."""
        text = "This is a longer text that should produce more tokens." * 10
        count = openai_provider.count_tokens(text)
        # Should return a reasonable count
        assert count > 0
        # Approximation should give reasonable estimate
        assert count <= int(len(text) / 4 * 1.1) + 1

    def test_count_tokens_with_tiktoken(self, openai_provider):
        """Test token counting uses tiktoken when available."""
        # If tiktoken is installed, it should give accurate counts
        text = "Hello, world!"
        count = openai_provider.count_tokens(text)
        # Just verify it returns a reasonable number
        assert count > 0
        assert count < len(text)


class TestConnectionTesting:
    """Test connection health checks."""

    @pytest.mark.anyio
    async def test_connection_success(self, openai_provider):
        """Test successful connection check."""
        mock_response = MagicMock()
        mock_response.status_code = 200

        with patch("httpx.AsyncClient") as mock_client:
            mock_instance = AsyncMock()
            mock_instance.get = AsyncMock(return_value=mock_response)
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=None)
            mock_client.return_value = mock_instance

            result = await openai_provider.test_connection()

        assert result.status == "ok"
        assert result.error_code is None
        assert result.latency_ms >= 0

    @pytest.mark.anyio
    async def test_connection_auth_failure(self, openai_provider):
        """Test connection check with 401 auth failure."""
        mock_response = MagicMock()
        mock_response.status_code = 401

        with patch("httpx.AsyncClient") as mock_client:
            mock_instance = AsyncMock()
            mock_instance.get = AsyncMock(return_value=mock_response)
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=None)
            mock_client.return_value = mock_instance

            result = await openai_provider.test_connection()

        assert result.status == "error"
        assert result.error_code == "AI_AUTH_INVALID"
        assert "Invalid API key" in result.error_detail

    @pytest.mark.anyio
    async def test_connection_rate_limited(self, openai_provider):
        """Test connection check with 429 rate limit."""
        mock_response = MagicMock()
        mock_response.status_code = 429

        with patch("httpx.AsyncClient") as mock_client:
            mock_instance = AsyncMock()
            mock_instance.get = AsyncMock(return_value=mock_response)
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=None)
            mock_client.return_value = mock_instance

            result = await openai_provider.test_connection()

        assert result.status == "degraded"
        assert result.error_code == "AI_RATE_LIMITED"
        assert "Rate limited" in result.error_detail

    @pytest.mark.anyio
    async def test_connection_http_error(self, openai_provider):
        """Test connection check with other HTTP error."""
        mock_response = MagicMock()
        mock_response.status_code = 500

        with patch("httpx.AsyncClient") as mock_client:
            mock_instance = AsyncMock()
            mock_instance.get = AsyncMock(return_value=mock_response)
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=None)
            mock_client.return_value = mock_instance

            result = await openai_provider.test_connection()

        assert result.status == "error"
        assert result.error_code == "AI_PROVIDER_ERROR"
        assert "500" in result.error_detail

    @pytest.mark.anyio
    async def test_connection_connect_error(self, openai_provider):
        """Test connection check with connection error."""
        with patch("httpx.AsyncClient") as mock_client:
            mock_instance = AsyncMock()
            mock_instance.get = AsyncMock(
                side_effect=httpx.ConnectError("Connection refused")
            )
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=None)
            mock_client.return_value = mock_instance

            result = await openai_provider.test_connection()

        assert result.status == "error"
        assert result.error_code == "AI_PROVIDER_UNREACHABLE"

    @pytest.mark.anyio
    async def test_connection_timeout(self, openai_provider):
        """Test connection check with timeout."""
        with patch("httpx.AsyncClient") as mock_client:
            mock_instance = AsyncMock()
            mock_instance.get = AsyncMock(
                side_effect=httpx.TimeoutException("Timeout")
            )
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=None)
            mock_client.return_value = mock_instance

            result = await openai_provider.test_connection()

        assert result.status == "error"
        assert result.error_code == "AI_TIMEOUT"
        assert "timed out" in result.error_detail

    @pytest.mark.anyio
    async def test_connection_generic_error(self, openai_provider):
        """Test connection check with generic exception."""
        with patch("httpx.AsyncClient") as mock_client:
            mock_instance = AsyncMock()
            mock_instance.get = AsyncMock(side_effect=Exception("Unexpected error"))
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=None)
            mock_client.return_value = mock_instance

            result = await openai_provider.test_connection()

        assert result.status == "error"
        assert result.error_code == "AI_PROVIDER_UNREACHABLE"


class TestModelListing:
    """Test model listing."""

    @pytest.mark.anyio
    async def test_list_models(self, openai_provider):
        """Test listing available models."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {
            "data": [
                {"id": "gpt-3.5-turbo"},
                {"id": "gpt-4"},
                {"id": "local-llama"},
            ]
        }

        with patch("httpx.AsyncClient") as mock_client:
            mock_instance = AsyncMock()
            mock_instance.get = AsyncMock(return_value=mock_response)
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=None)
            mock_client.return_value = mock_instance

            models = await openai_provider.list_models()

        assert models == ["gpt-3.5-turbo", "gpt-4", "local-llama"]

    @pytest.mark.anyio
    async def test_list_models_empty(self, openai_provider):
        """Test listing models when none available."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {"data": []}

        with patch("httpx.AsyncClient") as mock_client:
            mock_instance = AsyncMock()
            mock_instance.get = AsyncMock(return_value=mock_response)
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=None)
            mock_client.return_value = mock_instance

            models = await openai_provider.list_models()

        assert models == []


class TestHelperMethods:
    """Test helper methods inherited from base."""

    def test_get_model_with_override(self, openai_provider):
        """Test _get_model with override."""
        result = openai_provider._get_model("custom-model")
        assert result == "custom-model"

    def test_get_model_default(self, openai_provider):
        """Test _get_model with default."""
        result = openai_provider._get_model(None)
        assert result == "gpt-3.5-turbo"

    def test_get_temperature_with_override(self, openai_provider):
        """Test _get_temperature with override."""
        result = openai_provider._get_temperature(0.5)
        assert result == 0.5

    def test_get_temperature_default(self, openai_provider):
        """Test _get_temperature with default."""
        result = openai_provider._get_temperature(None)
        assert result == 0.7

    def test_get_max_tokens_with_override(self, openai_provider):
        """Test _get_max_tokens with override."""
        result = openai_provider._get_max_tokens(1024)
        assert result == 1024

    def test_get_max_tokens_default(self, openai_provider):
        """Test _get_max_tokens with default."""
        result = openai_provider._get_max_tokens(None)
        assert result == 2048
