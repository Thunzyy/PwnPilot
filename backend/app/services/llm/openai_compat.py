"""OpenAI-compatible LLM provider implementation."""

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


class OpenAICompatibleProvider(LLMProvider):
    """Provider for OpenAI-compatible APIs.

    Works with any OpenAI-compatible API server including:
    - LM Studio
    - LocalAI
    - vLLM
    - text-generation-webui (with OpenAI extension)
    - Ollama (with OpenAI compatibility mode)

    Features:
    - Bearer token authentication
    - SSE streaming for chat completions
    - Token counting with tiktoken (falls back to approximation)
    - Model listing via /models endpoint
    """

    def __init__(
        self,
        base_url: str,
        api_key: str | None,
        timeout: int,
        default_model: str,
        temperature: float,
        max_tokens: int,
        top_p: float,
        custom_headers: dict | None = None,
    ):
        """Initialize OpenAI-compatible provider.

        Args:
            base_url: API base URL (e.g., http://localhost:8000/v1)
            api_key: Optional API key for Bearer token auth
            timeout: Request timeout in seconds
            default_model: Default model to use
            temperature: Sampling temperature (0.0-2.0)
            max_tokens: Maximum tokens to generate
            top_p: Top-p sampling parameter
            custom_headers: Optional custom HTTP headers
        """
        super().__init__(
            module_name="llm.openai_compat",
            base_url=base_url.rstrip("/"),
            api_key=api_key,
            timeout=timeout,
            default_model=default_model,
            temperature=temperature,
            max_tokens=max_tokens,
            top_p=top_p,
            custom_headers=custom_headers,
        )

    def _get_headers(self) -> dict:
        """Get headers for API requests.

        Returns:
            Headers dict with Content-Type and optional Authorization
        """
        headers = {"Content-Type": "application/json", **self.custom_headers}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    async def test_connection(self) -> HealthResult:
        """Test connection to OpenAI-compatible API.

        Checks if the API is reachable by calling /models endpoint.
        Handles various HTTP status codes for detailed diagnostics.

        Returns:
            HealthResult with status and latency information
        """
        start = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(
                    f"{self.base_url}/models",
                    headers=self._get_headers(),
                )

            latency = int((time.monotonic() - start) * 1000)

            if response.status_code == 200:
                self.log.info(
                    "OpenAI-compatible API connection successful", latency_ms=latency
                )
                return HealthResult(status="ok", latency_ms=latency)
            elif response.status_code == 401:
                self.log.warning(
                    "OpenAI-compatible API auth failed", latency_ms=latency
                )
                return HealthResult(
                    status="error",
                    latency_ms=latency,
                    error_code="AI_AUTH_INVALID",
                    error_detail="Invalid API key",
                )
            elif response.status_code == 429:
                self.log.warning(
                    "OpenAI-compatible API rate limited", latency_ms=latency
                )
                return HealthResult(
                    status="degraded",
                    latency_ms=latency,
                    error_code="AI_RATE_LIMITED",
                    error_detail="Rate limited",
                )
            else:
                self.log.warning(
                    "OpenAI-compatible API returned error",
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
            self.log.error("OpenAI-compatible API connection failed", error=str(e))
            return HealthResult(
                status="error",
                latency_ms=latency,
                error_code="AI_PROVIDER_UNREACHABLE",
                error_detail=str(e),
            )
        except httpx.TimeoutException:
            latency = int((time.monotonic() - start) * 1000)
            self.log.error("OpenAI-compatible API connection timed out")
            return HealthResult(
                status="error",
                latency_ms=latency,
                error_code="AI_TIMEOUT",
                error_detail="Connection timed out",
            )
        except Exception as e:
            latency = int((time.monotonic() - start) * 1000)
            self.log.error("OpenAI-compatible API connection error", error=str(e))
            return HealthResult(
                status="error",
                latency_ms=latency,
                error_code="AI_PROVIDER_UNREACHABLE",
                error_detail=str(e),
            )

    async def list_models(self) -> list[str]:
        """List available models.

        Queries the /models endpoint (OpenAI standard).

        Returns:
            List of model IDs (e.g., ["gpt-3.5-turbo", "gpt-4"])
        """
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(
                f"{self.base_url}/models",
                headers=self._get_headers(),
            )
            response.raise_for_status()
            data = response.json()
            models = [model["id"] for model in data.get("data", [])]
            self.log.debug("Listed OpenAI-compatible models", count=len(models))
            return models

    async def chat_stream(
        self,
        messages: list[dict],
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> AsyncGenerator[StreamChunk, None]:
        """Stream chat completion.

        Uses the /chat/completions endpoint with SSE streaming.

        Args:
            messages: List of messages in OpenAI format
                [{"role": "user", "content": "Hello"}]
            model: Override default model
            temperature: Override default temperature
            max_tokens: Override default max_tokens

        Yields:
            StreamChunk with content and done flag
        """
        model = self._get_model(model)
        temperature = self._get_temperature(temperature)
        max_tokens = self._get_max_tokens(max_tokens)

        payload = {
            "model": model,
            "messages": messages,
            "stream": True,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "top_p": self.top_p,
        }

        self.log.info(
            "Starting OpenAI-compatible chat stream",
            model=model,
            message_count=len(messages),
        )

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/chat/completions",
                json=payload,
                headers=self._get_headers(),
            ) as response:
                response.raise_for_status()

                async for line in response.aiter_lines():
                    if not line or not line.startswith("data: "):
                        continue

                    data_str = line[6:]  # Remove "data: " prefix
                    if data_str == "[DONE]":
                        yield StreamChunk(content="", done=True)
                        break

                    data = json.loads(data_str)
                    choices = data.get("choices", [])
                    if not choices:
                        continue

                    delta = choices[0].get("delta", {})
                    content = delta.get("content", "")
                    finish_reason = choices[0].get("finish_reason")

                    usage = None
                    if data.get("usage"):
                        usage = TokenUsage(
                            prompt_tokens=data["usage"].get("prompt_tokens", 0),
                            completion_tokens=data["usage"].get("completion_tokens", 0),
                        )
                        self.log.debug(
                            "OpenAI-compatible chat completed",
                            prompt_tokens=usage.prompt_tokens,
                            completion_tokens=usage.completion_tokens,
                        )

                    yield StreamChunk(
                        content=content,
                        done=finish_reason is not None,
                        usage=usage,
                    )

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

        payload = {
            "model": resolved_model,
            "messages": messages,
            "temperature": resolved_temp,
            "max_tokens": resolved_max,
        }
        if tools:
            payload["tools"] = tools

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(
                f"{self.base_url}/chat/completions",
                json=payload,
                headers=self._get_headers(),
            )
            resp.raise_for_status()
            return resp.json()

    def count_tokens(self, text: str, model: str | None = None) -> int:
        """Count tokens using tiktoken if available, otherwise approximate.

        When tiktoken is available, uses the model-specific tokenizer.
        Falls back to cl100k_base encoding for unknown models.
        Without tiktoken, uses approximation: len(text) / 4 * 1.1

        Args:
            text: Text to count tokens for
            model: Model to use for tokenizer selection

        Returns:
            Token count (exact with tiktoken, approximate otherwise)
        """
        if not text:
            return 0

        if TIKTOKEN_AVAILABLE:
            try:
                model = model or self.default_model
                try:
                    encoding = tiktoken.encoding_for_model(model)
                except KeyError:
                    # Fall back to cl100k_base for unknown models
                    encoding = tiktoken.get_encoding("cl100k_base")
                return len(encoding.encode(text))
            except Exception:
                # Fall through to approximation
                pass

        # Fallback: len/4 * 1.1 (10% safety margin)
        return int(len(text) / 4 * 1.1)
