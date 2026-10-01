"""Type definitions for LLM providers."""
from dataclasses import dataclass
from typing import Any, Literal


@dataclass
class StreamChunk:
    """A chunk from streaming response."""

    content: str
    done: bool
    usage: "TokenUsage | None" = None
    metadata: dict[str, Any] | None = None


@dataclass
class TokenUsage:
    """Token usage statistics."""

    prompt_tokens: int
    completion_tokens: int

    def dict(self) -> dict:
        return {
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
        }


@dataclass
class HealthResult:
    """Result of a health check."""

    status: Literal["ok", "degraded", "error"]
    latency_ms: int
    error_code: str | None = None
    error_detail: str | None = None
