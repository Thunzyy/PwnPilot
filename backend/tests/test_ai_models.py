"""Tests for AI models."""
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai import AIContextRouting, AIPreset, AIProviderConfig, AISystemPrompt


@pytest.mark.anyio
async def test_create_provider_config(test_db: AsyncSession):
    """Test creating an AI provider config."""
    config = AIProviderConfig(
        user_id="test-user-123",
        provider_type="ollama",
        name="Local Ollama",
        base_url="http://localhost:11434",
        default_model="llama3.1:8b",
    )
    test_db.add(config)
    await test_db.commit()
    await test_db.refresh(config)

    assert config.id is not None
    assert config.provider_type == "ollama"
    assert config.is_enabled is True
    assert config.temperature == 0.7
    assert config.max_tokens == 2048
    assert config.timeout_seconds == 30


@pytest.mark.anyio
async def test_create_provider_config_with_custom_params(test_db: AsyncSession):
    """Test creating provider config with custom generation parameters."""
    config = AIProviderConfig(
        user_id="test-user-123",
        provider_type="openai",
        name="Custom GPT",
        default_model="gpt-4o",
        temperature=0.5,
        max_tokens=4096,
        top_p=0.9,
        frequency_penalty=0.2,
        presence_penalty=0.1,
    )
    test_db.add(config)
    await test_db.commit()
    await test_db.refresh(config)

    assert config.temperature == 0.5
    assert config.max_tokens == 4096
    assert config.top_p == 0.9
    assert config.frequency_penalty == 0.2
    assert config.presence_penalty == 0.1


@pytest.mark.anyio
async def test_create_context_routing(test_db: AsyncSession):
    """Test creating context routing."""
    config = AIProviderConfig(
        user_id="test-user-123",
        provider_type="openai",
        name="GPT-4",
        default_model="gpt-4o",
    )
    test_db.add(config)
    await test_db.commit()

    routing = AIContextRouting(
        user_id="test-user-123",
        context_type="chat",
        provider_config_id=config.id,
    )
    test_db.add(routing)
    await test_db.commit()
    await test_db.refresh(routing)

    assert routing.id is not None
    assert routing.project_id is None
    assert routing.context_type == "chat"


@pytest.mark.anyio
async def test_create_context_routing_with_project(test_db: AsyncSession):
    """Test creating context routing for a specific project."""
    config = AIProviderConfig(
        user_id="test-user-123",
        provider_type="anthropic",
        name="Claude",
        default_model="claude-sonnet-4-20250514",
    )
    test_db.add(config)
    await test_db.commit()

    routing = AIContextRouting(
        user_id="test-user-123",
        project_id="test-project-456",
        context_type="terminal",
        provider_config_id=config.id,
    )
    test_db.add(routing)
    await test_db.commit()
    await test_db.refresh(routing)

    assert routing.project_id == "test-project-456"
    assert routing.context_type == "terminal"


@pytest.mark.anyio
async def test_create_context_routing_with_model_override(test_db: AsyncSession):
    """Test creating context routing with an explicit model override."""
    config = AIProviderConfig(
        user_id="test-user-123",
        provider_type="openai",
        name="OpenAI",
        default_model="gpt-4o",
    )
    test_db.add(config)
    await test_db.commit()

    routing = AIContextRouting(
        user_id="test-user-123",
        context_type="reporting",
        provider_config_id=config.id,
        model="gemini-2.5-pro",
    )
    test_db.add(routing)
    await test_db.commit()
    await test_db.refresh(routing)

    assert routing.model == "gemini-2.5-pro"


@pytest.mark.anyio
async def test_create_system_prompt(test_db: AsyncSession):
    """Test creating a system prompt."""
    prompt = AISystemPrompt(
        user_id="test-user-123",
        context_type="chat",
        name="Pentest Expert",
        content="You are a penetration testing expert...",
        is_default=True,
    )
    test_db.add(prompt)
    await test_db.commit()
    await test_db.refresh(prompt)

    assert prompt.id is not None
    assert prompt.is_default is True
    assert prompt.name == "Pentest Expert"
    assert "penetration testing" in prompt.content


@pytest.mark.anyio
async def test_create_system_prompt_non_default(test_db: AsyncSession):
    """Test creating a non-default system prompt."""
    prompt = AISystemPrompt(
        user_id="test-user-123",
        context_type="terminal",
        name="Terminal Helper",
        content="You help with terminal commands...",
    )
    test_db.add(prompt)
    await test_db.commit()
    await test_db.refresh(prompt)

    assert prompt.is_default is False


@pytest.mark.anyio
async def test_create_ai_preset(test_db: AsyncSession):
    """Test creating an AI preset."""
    config = AIProviderConfig(
        user_id="test-user-123",
        provider_type="ollama",
        name="Local Ollama",
        default_model="llama3.1:8b",
    )
    test_db.add(config)
    await test_db.commit()

    preset = AIPreset(
        user_id="test-user-123",
        name="Creative Writing",
        provider_config_id=config.id,
        model="llama3.1:70b",
        temperature=0.9,
        max_tokens=8192,
    )
    test_db.add(preset)
    await test_db.commit()
    await test_db.refresh(preset)

    assert preset.id is not None
    assert preset.name == "Creative Writing"
    assert preset.model == "llama3.1:70b"
    assert preset.temperature == 0.9


@pytest.mark.anyio
async def test_provider_config_health_status(test_db: AsyncSession):
    """Test provider config health status fields."""
    from datetime import UTC, datetime

    config = AIProviderConfig(
        user_id="test-user-123",
        provider_type="ollama",
        name="Local Ollama",
        default_model="llama3.1:8b",
        health_status="healthy",
        last_health_check=datetime.now(UTC),
    )
    test_db.add(config)
    await test_db.commit()
    await test_db.refresh(config)

    assert config.health_status == "healthy"
    assert config.last_health_check is not None
