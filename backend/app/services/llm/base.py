"""Base class for LLM providers."""
from abc import ABC, abstractmethod
from collections.abc import AsyncGenerator

from app.services.base import BaseService
from app.services.llm.types import HealthResult, StreamChunk


class LLMProvider(ABC, BaseService):
    """Abstract base class for LLM providers.

    All providers must implement:
    - test_connection(): Health check with diagnostics
    - list_models(): Available models
    - chat_stream(): Streaming chat completion
    - count_tokens(): Token counting
    """

    def __init__(
        self,
        module_name: str,
        base_url: str | None,
        api_key: str | None,
        timeout: int,
        default_model: str,
        temperature: float,
        max_tokens: int,
        top_p: float,
        custom_headers: dict | None = None,
    ):
        super().__init__(module_name)
        self.base_url = base_url
        self.api_key = api_key
        self.timeout = timeout
        self.default_model = default_model
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.top_p = top_p
        self.custom_headers = custom_headers or {}

    @abstractmethod
    async def test_connection(self) -> HealthResult:
        """Test the connection to the provider.

        Returns:
            HealthResult with status and diagnostics
        """
        pass

    @abstractmethod
    async def list_models(self) -> list[str]:
        """List available models.

        Returns:
            List of model identifiers
        """
        pass

    @abstractmethod
    async def chat_stream(
        self,
        messages: list[dict],
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> AsyncGenerator[StreamChunk, None]:
        """Stream a chat completion.

        Args:
            messages: List of messages in OpenAI format
            model: Override default model
            temperature: Override default temperature
            max_tokens: Override default max_tokens

        Yields:
            StreamChunk with content and done flag
        """
        pass

    async def chat_with_tools(
        self,
        messages: list[dict],
        tools: list[dict],
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> dict:
        """Non-streaming chat completion with tool definitions.

        Returns the raw response dict for the adapter to parse.
        Default implementation raises NotImplementedError.
        """
        raise NotImplementedError(f"{type(self).__name__} does not support tool calling")

    @abstractmethod
    def count_tokens(self, text: str, model: str | None = None) -> int:
        """Count tokens in text.

        Args:
            text: Text to count tokens for
            model: Model to use for counting (affects tokenizer)

        Returns:
            Approximate token count
        """
        pass

    def _get_model(self, model: str | None) -> str:
        """Get model to use, with fallback to default."""
        return model or self.default_model

    def _get_temperature(self, temperature: float | None) -> float:
        """Get temperature to use, with fallback to default."""
        return temperature if temperature is not None else self.temperature

    def _get_max_tokens(self, max_tokens: int | None) -> int:
        """Get max_tokens to use, with fallback to default."""
        return max_tokens if max_tokens is not None else self.max_tokens

    def get_provider_label(self) -> str:
        """Return a user-facing provider label for persisted messages."""
        return getattr(self, "provider_name", type(self).__name__)

    def get_source_mode(self) -> str:
        """Return the source mode used for persisted messages."""
        return "api"
