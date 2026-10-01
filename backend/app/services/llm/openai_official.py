"""OpenAI official API provider implementation."""

from app.core.logging import get_logger
from app.services.llm.openai_compat import OpenAICompatibleProvider


class OpenAIProvider(OpenAICompatibleProvider):
    """Provider for official OpenAI API.

    Inherits from OpenAICompatibleProvider but enforces:
    - Fixed base URL (https://api.openai.com/v1)
    - Required API key
    """

    OPENAI_BASE_URL = "https://api.openai.com/v1"

    def __init__(
        self,
        api_key: str,  # Required for OpenAI
        timeout: int,
        default_model: str,
        temperature: float,
        max_tokens: int,
        top_p: float,
        custom_headers: dict | None = None,
    ):
        """Initialize OpenAI provider.

        Args:
            api_key: OpenAI API key (required)
            timeout: Request timeout in seconds
            default_model: Default model to use (e.g., gpt-4o)
            temperature: Sampling temperature (0.0-2.0)
            max_tokens: Maximum tokens to generate
            top_p: Top-p sampling parameter
            custom_headers: Optional custom HTTP headers

        Raises:
            ValueError: If api_key is empty or None
        """
        if not api_key:
            raise ValueError("API key is required for OpenAI provider")

        super().__init__(
            base_url=self.OPENAI_BASE_URL,
            api_key=api_key,
            timeout=timeout,
            default_model=default_model,
            temperature=temperature,
            max_tokens=max_tokens,
            top_p=top_p,
            custom_headers=custom_headers,
        )
        # Override module name for logging
        self.log = get_logger("llm.openai")
