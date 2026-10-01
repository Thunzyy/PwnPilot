"""Tests for OpenAI official provider."""

import pytest

from app.services.llm.openai_official import OpenAIProvider


class TestOpenAIProviderInitialization:
    """Test OpenAI provider initialization."""

    def test_requires_api_key(self):
        """Test that OpenAI provider requires API key."""
        with pytest.raises(ValueError, match="API key is required"):
            OpenAIProvider(
                api_key="",
                timeout=30,
                default_model="gpt-4o",
                temperature=0.7,
                max_tokens=2048,
                top_p=1.0,
            )

    def test_requires_api_key_none(self):
        """Test that OpenAI provider rejects None API key."""
        with pytest.raises(ValueError, match="API key is required"):
            OpenAIProvider(
                api_key=None,
                timeout=30,
                default_model="gpt-4o",
                temperature=0.7,
                max_tokens=2048,
                top_p=1.0,
            )

    def test_uses_fixed_url(self):
        """Test that OpenAI provider uses fixed URL."""
        provider = OpenAIProvider(
            api_key="sk-test-key",
            timeout=30,
            default_model="gpt-4o",
            temperature=0.7,
            max_tokens=2048,
            top_p=1.0,
        )
        assert provider.base_url == "https://api.openai.com/v1"

    def test_stores_api_key(self):
        """Test that API key is stored correctly."""
        provider = OpenAIProvider(
            api_key="sk-test-key-12345",
            timeout=30,
            default_model="gpt-4o",
            temperature=0.7,
            max_tokens=2048,
            top_p=1.0,
        )
        assert provider.api_key == "sk-test-key-12345"

    def test_stores_model_settings(self):
        """Test that model settings are stored correctly."""
        provider = OpenAIProvider(
            api_key="sk-test-key",
            timeout=60,
            default_model="gpt-4-turbo",
            temperature=0.5,
            max_tokens=4096,
            top_p=0.9,
        )
        assert provider.timeout == 60
        assert provider.default_model == "gpt-4-turbo"
        assert provider.temperature == 0.5
        assert provider.max_tokens == 4096
        assert provider.top_p == 0.9

    def test_accepts_custom_headers(self):
        """Test that custom headers are accepted."""
        provider = OpenAIProvider(
            api_key="sk-test-key",
            timeout=30,
            default_model="gpt-4o",
            temperature=0.7,
            max_tokens=2048,
            top_p=1.0,
            custom_headers={"X-Custom-Header": "custom-value"},
        )
        assert provider.custom_headers == {"X-Custom-Header": "custom-value"}


class TestOpenAIProviderHeaders:
    """Test OpenAI provider header generation."""

    def test_headers_include_bearer_token(self):
        """Test that headers include Bearer token."""
        provider = OpenAIProvider(
            api_key="sk-test-key",
            timeout=30,
            default_model="gpt-4o",
            temperature=0.7,
            max_tokens=2048,
            top_p=1.0,
        )
        headers = provider._get_headers()
        assert headers["Authorization"] == "Bearer sk-test-key"
        assert headers["Content-Type"] == "application/json"

    def test_headers_include_custom_headers(self):
        """Test that custom headers are included."""
        provider = OpenAIProvider(
            api_key="sk-test-key",
            timeout=30,
            default_model="gpt-4o",
            temperature=0.7,
            max_tokens=2048,
            top_p=1.0,
            custom_headers={"X-Request-Id": "test-123"},
        )
        headers = provider._get_headers()
        assert headers["X-Request-Id"] == "test-123"
        assert headers["Authorization"] == "Bearer sk-test-key"


class TestOpenAIProviderInheritance:
    """Test that OpenAI provider inherits from OpenAI-compatible provider."""

    def test_inherits_token_counting(self):
        """Test that token counting is inherited."""
        provider = OpenAIProvider(
            api_key="sk-test-key",
            timeout=30,
            default_model="gpt-4o",
            temperature=0.7,
            max_tokens=2048,
            top_p=1.0,
        )
        count = provider.count_tokens("Hello, world!")
        assert count > 0
        assert count < 20  # Reasonable token count

    def test_inherits_helper_methods(self):
        """Test that helper methods are inherited."""
        provider = OpenAIProvider(
            api_key="sk-test-key",
            timeout=30,
            default_model="gpt-4o",
            temperature=0.7,
            max_tokens=2048,
            top_p=1.0,
        )
        assert provider._get_model(None) == "gpt-4o"
        assert provider._get_model("custom-model") == "custom-model"
        assert provider._get_temperature(None) == 0.7
        assert provider._get_temperature(0.5) == 0.5
        assert provider._get_max_tokens(None) == 2048
        assert provider._get_max_tokens(1024) == 1024
