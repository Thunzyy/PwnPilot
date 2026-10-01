"""Tests for Ollama provider."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.llm.ollama import OllamaProvider


@pytest.fixture
def ollama_provider():
    """Create an Ollama provider for testing."""
    return OllamaProvider(
        base_url="http://localhost:11434",
        timeout=30,
        default_model="llama3.1:8b",
        temperature=0.7,
        max_tokens=2048,
        top_p=1.0,
    )


def test_ollama_provider_init(ollama_provider):
    """Test Ollama provider initialization."""
    assert ollama_provider.base_url == "http://localhost:11434"
    assert ollama_provider.default_model == "llama3.1:8b"
    assert ollama_provider.timeout == 30
    assert ollama_provider.temperature == 0.7
    assert ollama_provider.max_tokens == 2048
    assert ollama_provider.top_p == 1.0
    assert ollama_provider.api_key is None  # Ollama doesn't need API key


def test_count_tokens_approximation(ollama_provider):
    """Test token counting approximation."""
    text = "Hello, world!"
    count = ollama_provider.count_tokens(text)
    # Approximation: len/4 * 1.1
    expected = int(len(text) / 4 * 1.1)
    assert count == expected


def test_count_tokens_empty_string(ollama_provider):
    """Test token counting with empty string."""
    count = ollama_provider.count_tokens("")
    assert count == 0


def test_count_tokens_long_text(ollama_provider):
    """Test token counting with longer text."""
    text = "This is a longer text that should produce more tokens." * 10
    count = ollama_provider.count_tokens(text)
    expected = int(len(text) / 4 * 1.1)
    assert count == expected


@pytest.mark.anyio
async def test_test_connection_success(ollama_provider):
    """Test successful connection check."""
    mock_response = MagicMock()
    mock_response.status_code = 200

    with patch("httpx.AsyncClient") as mock_client:
        mock_instance = AsyncMock()
        mock_instance.get = AsyncMock(return_value=mock_response)
        mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
        mock_instance.__aexit__ = AsyncMock(return_value=None)
        mock_client.return_value = mock_instance

        result = await ollama_provider.test_connection()

    assert result.status == "ok"
    assert result.error_code is None
    assert result.latency_ms >= 0


@pytest.mark.anyio
async def test_test_connection_http_error(ollama_provider):
    """Test connection check with HTTP error."""
    mock_response = MagicMock()
    mock_response.status_code = 500

    with patch("httpx.AsyncClient") as mock_client:
        mock_instance = AsyncMock()
        mock_instance.get = AsyncMock(return_value=mock_response)
        mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
        mock_instance.__aexit__ = AsyncMock(return_value=None)
        mock_client.return_value = mock_instance

        result = await ollama_provider.test_connection()

    assert result.status == "error"
    assert result.error_code == "AI_PROVIDER_ERROR"
    assert "500" in result.error_detail


@pytest.mark.anyio
async def test_test_connection_failure(ollama_provider):
    """Test failed connection check."""
    with patch("httpx.AsyncClient") as mock_client:
        mock_instance = AsyncMock()
        mock_instance.get = AsyncMock(side_effect=Exception("Connection refused"))
        mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
        mock_instance.__aexit__ = AsyncMock(return_value=None)
        mock_client.return_value = mock_instance

        result = await ollama_provider.test_connection()

    assert result.status == "error"
    assert result.error_code == "AI_PROVIDER_UNREACHABLE"


@pytest.mark.anyio
async def test_test_connection_connect_error(ollama_provider):
    """Test connection check with httpx.ConnectError."""
    import httpx

    with patch("httpx.AsyncClient") as mock_client:
        mock_instance = AsyncMock()
        mock_instance.get = AsyncMock(side_effect=httpx.ConnectError("Failed to connect"))
        mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
        mock_instance.__aexit__ = AsyncMock(return_value=None)
        mock_client.return_value = mock_instance

        result = await ollama_provider.test_connection()

    assert result.status == "error"
    assert result.error_code == "AI_PROVIDER_UNREACHABLE"


@pytest.mark.anyio
async def test_test_connection_timeout(ollama_provider):
    """Test connection check with timeout."""
    import httpx

    with patch("httpx.AsyncClient") as mock_client:
        mock_instance = AsyncMock()
        mock_instance.get = AsyncMock(side_effect=httpx.TimeoutException("Timeout"))
        mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
        mock_instance.__aexit__ = AsyncMock(return_value=None)
        mock_client.return_value = mock_instance

        result = await ollama_provider.test_connection()

    assert result.status == "error"
    assert result.error_code == "AI_TIMEOUT"


@pytest.mark.anyio
async def test_list_models(ollama_provider):
    """Test listing models."""
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = {
        "models": [
            {"name": "llama3.1:8b"},
            {"name": "mistral:7b"},
        ]
    }

    with patch("httpx.AsyncClient") as mock_client:
        mock_instance = AsyncMock()
        mock_instance.get = AsyncMock(return_value=mock_response)
        mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
        mock_instance.__aexit__ = AsyncMock(return_value=None)
        mock_client.return_value = mock_instance

        models = await ollama_provider.list_models()

    assert models == ["llama3.1:8b", "mistral:7b"]


@pytest.mark.anyio
async def test_list_models_empty(ollama_provider):
    """Test listing models when none available."""
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = {"models": []}

    with patch("httpx.AsyncClient") as mock_client:
        mock_instance = AsyncMock()
        mock_instance.get = AsyncMock(return_value=mock_response)
        mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
        mock_instance.__aexit__ = AsyncMock(return_value=None)
        mock_client.return_value = mock_instance

        models = await ollama_provider.list_models()

    assert models == []


@pytest.mark.anyio
async def test_list_models_connect_error_returns_empty(ollama_provider):
    """Test listing models when the Ollama instance is unreachable."""
    import httpx

    with patch("httpx.AsyncClient") as mock_client:
        mock_instance = AsyncMock()
        mock_instance.get = AsyncMock(side_effect=httpx.ConnectError("Failed to connect"))
        mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
        mock_instance.__aexit__ = AsyncMock(return_value=None)
        mock_client.return_value = mock_instance

        models = await ollama_provider.list_models()

    assert models == []


def test_get_model_with_override(ollama_provider):
    """Test _get_model with override."""
    result = ollama_provider._get_model("custom-model")
    assert result == "custom-model"


def test_get_model_default(ollama_provider):
    """Test _get_model with default."""
    result = ollama_provider._get_model(None)
    assert result == "llama3.1:8b"


def test_get_temperature_with_override(ollama_provider):
    """Test _get_temperature with override."""
    result = ollama_provider._get_temperature(0.5)
    assert result == 0.5


def test_get_temperature_default(ollama_provider):
    """Test _get_temperature with default."""
    result = ollama_provider._get_temperature(None)
    assert result == 0.7


def test_get_max_tokens_with_override(ollama_provider):
    """Test _get_max_tokens with override."""
    result = ollama_provider._get_max_tokens(1024)
    assert result == 1024


def test_get_max_tokens_default(ollama_provider):
    """Test _get_max_tokens with default."""
    result = ollama_provider._get_max_tokens(None)
    assert result == 2048
