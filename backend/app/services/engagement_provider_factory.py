"""Factory for engagement providers/stores.

Uses app settings to pick local or MCP-backed providers while preserving a
safe local fallback.
"""

from __future__ import annotations

from functools import lru_cache

from app.config import settings
from app.services.engagement_provider import (
    AISignalEventProvider,
    CommandHistoryEventProvider,
    EngagementEventProvider,
    EngagementStateStore,
    GraphEventProvider,
    McpEngagementEventProvider,
    McpEngagementStateStore,
    MergedEngagementEventProvider,
    ProjectVariableEngagementStateStore,
    TimelineEventProvider,
)


@lru_cache
def get_engagement_event_provider() -> EngagementEventProvider:
    local_provider = MergedEngagementEventProvider(
        CommandHistoryEventProvider(),
        GraphEventProvider(),
        TimelineEventProvider(),
        AISignalEventProvider(),
    )
    provider_name = (settings.engagement_event_provider or "local").strip().lower()

    if provider_name == "mcp":
        base_url = (settings.engagement_mcp_base_url or "").strip()
        if not base_url:
            return local_provider
        return McpEngagementEventProvider(
            base_url=base_url,
            timeout_seconds=settings.engagement_mcp_timeout_seconds,
            api_key=(settings.engagement_mcp_api_key or "").strip() or None,
            fallback_provider=local_provider,
        )

    return local_provider


@lru_cache
def get_engagement_state_store() -> EngagementStateStore:
    local_store = ProjectVariableEngagementStateStore()
    store_name = (settings.engagement_state_store or "project_variables").strip().lower()

    if store_name == "mcp":
        base_url = (settings.engagement_mcp_base_url or "").strip()
        if not base_url:
            return local_store
        return McpEngagementStateStore(
            base_url=base_url,
            timeout_seconds=settings.engagement_mcp_timeout_seconds,
            api_key=(settings.engagement_mcp_api_key or "").strip() or None,
            fallback_store=local_store,
        )

    return local_store
