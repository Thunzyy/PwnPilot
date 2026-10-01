"""Ollama LLM provider implementation."""

import json
import time
from collections.abc import AsyncGenerator

import httpx

from app.services.llm.base import LLMProvider
from app.services.llm.types import HealthResult, StreamChunk, TokenUsage


class OllamaProvider(LLMProvider):
    """Provider for local Ollama instance.

    Ollama runs locally and provides access to various open-source LLMs
    like LLaMA, Mistral, CodeLlama, etc.

    Features:
    - No API key required (local deployment)
    - Streaming chat completions
    - Model listing via /api/tags endpoint
    - Token approximation (Ollama doesn't expose tokenizer)
    """

    def __init__(
        self,
        base_url: str,
        timeout: int,
        default_model: str,
        temperature: float,
        max_tokens: int,
        top_p: float,
        custom_headers: dict | None = None,
    ):
        """Initialize Ollama provider.

        Args:
            base_url: Ollama server URL (default: http://localhost:11434)
            timeout: Request timeout in seconds
            default_model: Default model to use (e.g., "llama3.1:8b")
            temperature: Sampling temperature (0.0-1.0)
            max_tokens: Maximum tokens to generate
            top_p: Top-p sampling parameter
            custom_headers: Optional custom HTTP headers
        """
        super().__init__(
            module_name="llm.ollama",
            base_url=base_url,
            api_key=None,  # Ollama doesn't need API key
            timeout=timeout,
            default_model=default_model,
            temperature=temperature,
            max_tokens=max_tokens,
            top_p=top_p,
            custom_headers=custom_headers,
        )

    async def test_connection(self) -> HealthResult:
        """Test connection to Ollama server.

        Checks if the Ollama server is reachable by calling /api/tags.

        Returns:
            HealthResult with status and latency information
        """
        start = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self.base_url}/api/tags")

            latency = int((time.monotonic() - start) * 1000)

            if response.status_code == 200:
                self.log.info("Ollama connection successful", latency_ms=latency)
                return HealthResult(status="ok", latency_ms=latency)
            else:
                self.log.warning(
                    "Ollama returned error",
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
            self.log.error("Ollama connection failed", error=str(e))
            return HealthResult(
                status="error",
                latency_ms=latency,
                error_code="AI_PROVIDER_UNREACHABLE",
                error_detail=str(e),
            )
        except httpx.TimeoutException:
            latency = int((time.monotonic() - start) * 1000)
            self.log.error("Ollama connection timed out")
            return HealthResult(
                status="error",
                latency_ms=latency,
                error_code="AI_TIMEOUT",
                error_detail="Connection timed out",
            )
        except Exception as e:
            latency = int((time.monotonic() - start) * 1000)
            self.log.error("Ollama connection error", error=str(e))
            return HealthResult(
                status="error",
                latency_ms=latency,
                error_code="AI_PROVIDER_UNREACHABLE",
                error_detail=str(e),
            )

    async def list_models(self) -> list[str]:
        """List available Ollama models.

        Queries the /api/tags endpoint to get all installed models.

        Returns:
            List of model names (e.g., ["llama3.1:8b", "mistral:7b"])
        """
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(f"{self.base_url}/api/tags")
                response.raise_for_status()
                data = response.json()
                models = [model["name"] for model in data.get("models", [])]
                self.log.debug("Listed Ollama models", count=len(models))
                return models
        except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPError) as e:
            self.log.warning("Ollama models unavailable", error=str(e))
            return []

    async def chat_stream(
        self,
        messages: list[dict],
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> AsyncGenerator[StreamChunk, None]:
        """Stream chat completion from Ollama.

        Uses the /api/chat endpoint with streaming enabled.

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
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens,
                "top_p": self.top_p,
            },
        }

        self.log.info(
            "Starting Ollama chat stream",
            model=model,
            message_count=len(messages),
        )

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/api/chat",
                json=payload,
                headers=self.custom_headers,
            ) as response:
                response.raise_for_status()

                async for line in response.aiter_lines():
                    if not line:
                        continue

                    data = json.loads(line)

                    content = data.get("message", {}).get("content", "")
                    done = data.get("done", False)

                    usage = None
                    if done and "eval_count" in data:
                        usage = TokenUsage(
                            prompt_tokens=data.get("prompt_eval_count", 0),
                            completion_tokens=data.get("eval_count", 0),
                        )
                        self.log.debug(
                            "Ollama chat completed",
                            prompt_tokens=usage.prompt_tokens,
                            completion_tokens=usage.completion_tokens,
                        )

                    yield StreamChunk(content=content, done=done, usage=usage)

    def count_tokens(self, text: str, model: str | None = None) -> int:
        """Approximate token count for Ollama models.

        Ollama doesn't expose a tokenization endpoint, so we use a simple
        approximation based on character count.

        Approximation formula: len(text) / 4 * 1.1
        - Division by 4: average ~4 characters per token for English
        - Multiply by 1.1: 10% safety margin

        Args:
            text: Text to count tokens for
            model: Ignored (same approximation for all models)

        Returns:
            Approximate token count
        """
        if not text:
            return 0
        return int(len(text) / 4 * 1.1)
