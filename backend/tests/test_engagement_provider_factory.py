from unittest.mock import patch

from app.services.engagement_provider import (
    AISignalEventProvider,
    CommandHistoryEventProvider,
    GraphEventProvider,
    MergedEngagementEventProvider,
    ProjectVariableEngagementStateStore,
    TimelineEventProvider,
)
from app.services.engagement_provider_factory import (
    get_engagement_event_provider,
    get_engagement_state_store,
)


def test_get_engagement_event_provider_local_by_default():
    get_engagement_event_provider.cache_clear()

    with patch("app.services.engagement_provider_factory.settings") as mock_settings:
        mock_settings.engagement_event_provider = "local"
        mock_settings.engagement_mcp_base_url = ""
        mock_settings.engagement_mcp_timeout_seconds = 4.0
        mock_settings.engagement_mcp_api_key = ""

        provider = get_engagement_event_provider()

    assert isinstance(provider, MergedEngagementEventProvider)
    assert any(
        isinstance(child_provider, CommandHistoryEventProvider)
        for child_provider in provider.providers
    )
    assert any(
        isinstance(child_provider, TimelineEventProvider)
        for child_provider in provider.providers
    )
    assert any(
        isinstance(child_provider, AISignalEventProvider)
        for child_provider in provider.providers
    )
    assert any(
        isinstance(child_provider, GraphEventProvider)
        for child_provider in provider.providers
    )


def test_get_engagement_event_provider_mcp_uses_mcp_provider_when_url_is_set():
    get_engagement_event_provider.cache_clear()

    with patch("app.services.engagement_provider_factory.settings") as mock_settings:
        mock_settings.engagement_event_provider = "mcp"
        mock_settings.engagement_mcp_base_url = "http://localhost:8080"
        mock_settings.engagement_mcp_timeout_seconds = 5.0
        mock_settings.engagement_mcp_api_key = "dev-token"

        provider = get_engagement_event_provider()

    assert provider.__class__.__name__ == "McpEngagementEventProvider"


def test_get_engagement_event_provider_mcp_falls_back_to_local_without_url():
    get_engagement_event_provider.cache_clear()

    with patch("app.services.engagement_provider_factory.settings") as mock_settings:
        mock_settings.engagement_event_provider = "mcp"
        mock_settings.engagement_mcp_base_url = ""
        mock_settings.engagement_mcp_timeout_seconds = 5.0
        mock_settings.engagement_mcp_api_key = ""

        provider = get_engagement_event_provider()

    assert isinstance(provider, MergedEngagementEventProvider)


def test_get_engagement_state_store_defaults_to_project_variables():
    get_engagement_state_store.cache_clear()

    with patch("app.services.engagement_provider_factory.settings") as mock_settings:
        mock_settings.engagement_state_store = "project_variables"
        store = get_engagement_state_store()

    assert isinstance(store, ProjectVariableEngagementStateStore)


def test_get_engagement_state_store_mcp_uses_mcp_store_when_url_is_set():
    get_engagement_state_store.cache_clear()

    with patch("app.services.engagement_provider_factory.settings") as mock_settings:
        mock_settings.engagement_state_store = "mcp"
        mock_settings.engagement_mcp_base_url = "http://localhost:8080"
        mock_settings.engagement_mcp_timeout_seconds = 5.0
        mock_settings.engagement_mcp_api_key = "dev-token"
        store = get_engagement_state_store()

    assert store.__class__.__name__ == "McpEngagementStateStore"


def test_get_engagement_state_store_mcp_falls_back_without_url():
    get_engagement_state_store.cache_clear()

    with patch("app.services.engagement_provider_factory.settings") as mock_settings:
        mock_settings.engagement_state_store = "mcp"
        mock_settings.engagement_mcp_base_url = ""
        mock_settings.engagement_mcp_timeout_seconds = 5.0
        mock_settings.engagement_mcp_api_key = ""
        store = get_engagement_state_store()

    assert isinstance(store, ProjectVariableEngagementStateStore)
