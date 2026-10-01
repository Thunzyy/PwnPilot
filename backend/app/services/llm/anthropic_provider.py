"""Anthropic API provider implementation."""

import json
import time
from collections.abc import AsyncGenerator

import httpx

from app.services.llm.base import LLMProvider
from app.services.llm.types import HealthResult, StreamChunk, TokenUsage

# Try to import tiktoken for accurate token counting
try:
    import tiktoken

    TIKTOKEN_AVAILABLE = True
except ImportError:
    TIKTOKEN_AVAILABLE = False


class AnthropicProvider(LLMProvider):
    """Provider for Anthropic Claude API.

    Implements the Anthropic Messages API with streaming support.

    Key differences from OpenAI:
    - Requires API key (not optional)
    - Uses x-api-key header instead of Bearer token
    - System message is separate from messages array
    - Different SSE event types (content_block_delta, message_stop, message_delta)
    - No /models endpoint - returns hardcoded list

    Features:
    - x-api-key authentication
    - SSE streaming for chat completions
    - Token counting with tiktoken (falls back to approximation)
    - Hardcoded model list (Claude 3.x family)
    """

    ANTHROPIC_BASE_URL = "https://api.anthropic.com"
    ANTHROPIC_VERSION = "2023-06-01"

    def __init__(
        self,
        api_key: str | None,  # Required for Anthropic
        timeout: int,
        default_model: str,
        temperature: float,
        max_tokens: int,
        top_p: float,
        custom_headers: dict | None = None,
    ):
        """Initialize Anthropic provider.

        Args:
            api_key: Anthropic API key (required)
            timeout: Request timeout in seconds
            default_model: Default model to use
            temperature: Sampling temperature (0.0-1.0)
            max_tokens: Maximum tokens to generate
            top_p: Top-p sampling parameter
            custom_headers: Optional custom HTTP headers

        Raises:
            ValueError: If api_key is not provided
        """
        if not api_key:
            raise ValueError("API key is required for Anthropic provider")

        super().__init__(
            module_name="llm.anthropic",
            base_url=self.ANTHROPIC_BASE_URL,
            api_key=api_key,
            timeout=timeout,
            default_model=default_model,
            temperature=temperature,
            max_tokens=max_tokens,
            top_p=top_p,
            custom_headers=custom_headers,
        )

    def _get_headers(self) -> dict:
        """Get headers for Anthropic API.

        Returns:
            Headers dict with x-api-key and anthropic-version
        """
        return {
            "Content-Type": "application/json",
            "x-api-key": self.api_key,
            "anthropic-version": self.ANTHROPIC_VERSION,
            **self.custom_headers,
        }

    def _convert_messages(self, messages: list[dict]) -> tuple[str | None, list[dict]]:
        """Convert OpenAI-style messages to Anthropic format.

        Anthropic requires system message separate from messages array.

        Args:
            messages: List of messages in OpenAI format

        Returns:
            Tuple of (system_message, converted_messages)
        """
        system = None
        converted = []

        for msg in messages:
            if msg["role"] == "system":
                system = msg["content"]
            else:
                converted.append(
                    {
                        "role": msg["role"],
                        "content": msg["content"],
                    }
                )

        return system, converted

    async def test_connection(self) -> HealthResult:
        """Test connection to Anthropic API.

        Sends a minimal request to verify API key and connectivity.

        Returns:
            HealthResult with status and latency information
        """
        start = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.post(
                    f"{self.base_url}/v1/messages",
                    headers=self._get_headers(),
                    json={
                        "model": self.default_model,
                        "max_tokens": 1,
                        "messages": [{"role": "user", "content": "hi"}],
                    },
                )

            latency = int((time.monotonic() - start) * 1000)

            if response.status_code == 200:
                self.log.info("Anthropic API connection successful", latency_ms=latency)
                return HealthResult(status="ok", latency_ms=latency)
            elif response.status_code == 401:
                self.log.warning("Anthropic API auth failed", latency_ms=latency)
                return HealthResult(
                    status="error",
                    latency_ms=latency,
                    error_code="AI_AUTH_INVALID",
                    error_detail="Invalid API key",
                )
            elif response.status_code == 429:
                self.log.warning("Anthropic API rate limited", latency_ms=latency)
                return HealthResult(
                    status="degraded",
                    latency_ms=latency,
                    error_code="AI_RATE_LIMITED",
                    error_detail="Rate limited",
                )
            else:
                self.log.warning(
                    "Anthropic API returned error",
                    status_code=response.status_code,
                    latency_ms=latency,
                )
                return HealthResult(
                    status="error",
                    latency_ms=latency,
                    error_code="AI_PROVIDER_ERROR",
                    error_detail=f"HTTP {response.status_code}",
                )
        except httpx.ConnectError as e:
            latency = int((time.monotonic() - start) * 1000)
            self.log.error("Anthropic API connection failed", error=str(e))
            return HealthResult(
                status="error",
                latency_ms=latency,
                error_code="AI_PROVIDER_UNREACHABLE",
                error_detail=str(e),
            )
        except httpx.TimeoutException:
            latency = int((time.monotonic() - start) * 1000)
            self.log.error("Anthropic API connection timed out")
            return HealthResult(
                status="error",
                latency_ms=latency,
                error_code="AI_TIMEOUT",
                error_detail="Connection timed out",
            )
        except Exception as e:
            latency = int((time.monotonic() - start) * 1000)
            self.log.error("Anthropic API connection error", error=str(e))
            return HealthResult(
                status="error",
                latency_ms=latency,
                error_code="AI_PROVIDER_UNREACHABLE",
                error_detail=str(e),
            )

    async def list_models(self) -> list[str]:
        """List available Anthropic models.

        Anthropic doesn't have a models endpoint, so return known models.

        Returns:
            List of known Claude model identifiers
        """
        models = [
            "claude-3-5-sonnet-20241022",
            "claude-3-5-haiku-20241022",
            "claude-3-opus-20240229",
            "claude-3-sonnet-20240229",
            "claude-3-haiku-20240307",
        ]
        self.log.debug("Listed Anthropic models", count=len(models))
        return models

    async def chat_stream(
        self,
        messages: list[dict],
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> AsyncGenerator[StreamChunk, None]:
        """Stream chat completion from Anthropic.

        Uses the /v1/messages endpoint with SSE streaming.

        Args:
            messages: List of messages in OpenAI format
            model: Override default model
            temperature: Override default temperature
            max_tokens: Override default max_tokens

        Yields:
            StreamChunk with content and done flag
        """
        model = self._get_model(model)
        temperature = self._get_temperature(temperature)
        max_tokens = self._get_max_tokens(max_tokens)

        system, converted_messages = self._convert_messages(messages)

        payload = {
            "model": model,
            "messages": converted_messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "top_p": self.top_p,
            "stream": True,
        }
        if system:
            payload["system"] = system

        self.log.info(
            "Starting Anthropic chat stream",
            model=model,
            message_count=len(messages),
            has_system=system is not None,
        )

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/v1/messages",
                json=payload,
                headers=self._get_headers(),
            ) as response:
                response.raise_for_status()

                async for line in response.aiter_lines():
                    if not line or not line.startswith("data: "):
                        continue

                    data_str = line[6:]  # Remove "data: " prefix
                    if data_str == "[DONE]":
                        break

                    data = json.loads(data_str)
                    event_type = data.get("type")

                    if event_type == "content_block_delta":
                        delta = data.get("delta", {})
                        content = delta.get("text", "")
                        yield StreamChunk(content=content, done=False)

                    elif event_type == "message_stop":
                        yield StreamChunk(content="", done=True)

                    elif event_type == "message_delta":
                        usage_data = data.get("usage", {})
                        usage = None
                        if usage_data:
                            usage = TokenUsage(
                                prompt_tokens=usage_data.get("input_tokens", 0),
                                completion_tokens=usage_data.get("output_tokens", 0),
                            )
                            self.log.debug(
                                "Anthropic chat completed",
                                prompt_tokens=usage.prompt_tokens,
                                completion_tokens=usage.completion_tokens,
                            )
                        yield StreamChunk(content="", done=True, usage=usage)

    async def chat_with_tools(
        self,
        messages: list[dict],
        tools: list[dict],
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> dict:
        resolved_model = self._get_model(model)
        resolved_temp = self._get_temperature(temperature)
        resolved_max = self._get_max_tokens(max_tokens)

        system_msg, anthropic_messages = self._convert_messages(messages)

        payload = {
            "model": resolved_model,
            "messages": anthropic_messages,
            "max_tokens": resolved_max,
            "temperature": resolved_temp,
        }
        if system_msg:
            payload["system"] = system_msg
        if tools:
            payload["tools"] = tools

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(
                f"{self.base_url}/v1/messages",
                json=payload,
                headers=self._get_headers(),
            )
            resp.raise_for_status()
            return resp.json()

    def count_tokens(self, text: str, model: str | None = None) -> int:
        """Approximate token count for Claude models.

        Uses cl100k_base encoding from tiktoken if available,
        otherwise falls back to character-based approximation.

        Args:
            text: Text to count tokens for
            model: Model (not used, Claude uses similar tokenization)

        Returns:
            Approximate token count
        """
        if not text:
            return 0

        if TIKTOKEN_AVAILABLE:
            try:
                # Claude uses a similar tokenizer to cl100k_base
                encoding = tiktoken.get_encoding("cl100k_base")
                return len(encoding.encode(text))
            except Exception:
                pass

        # Fallback: len/4 * 1.1 (10% safety margin)
        return int(len(text) / 4 * 1.1)
