from contextlib import asynccontextmanager
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.main import app
from app.models.user import User
from app.routers.auth import get_current_user


def make_template(
    *,
    template_id: int,
    prompt_type: str = "template",
    category: str = "general",
    name: str = "Template",
    description: str | None = None,
    variables: list[str] | None = None,
    content: str = "echo test",
    is_default: bool = False,
    user_id: str | None = "test-user-id",
):
    template = MagicMock()
    template.id = template_id
    template.type = prompt_type
    template.category = category
    template.name = name
    template.description = description
    template.variables = variables or []
    template.content = content
    template.is_default = is_default
    template.user_id = user_id
    template.created_at = datetime.now(UTC)
    template.updated_at = datetime.now(UTC)
    return template


@pytest.fixture
def mock_user():
    user = MagicMock(spec=User)
    user.id = "test-user-id"
    user.username = "testuser"
    user.is_active = True
    return user


@pytest.fixture
def mock_db():
    return AsyncMock()


@pytest.fixture
def client(mock_user, mock_db):
    @asynccontextmanager
    async def noop_lifespan(_app):
        yield

    app.dependency_overrides[get_current_user] = lambda: mock_user
    app.dependency_overrides[get_db] = lambda: mock_db
    original_lifespan = app.router.lifespan_context
    app.router.lifespan_context = noop_lifespan
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.router.lifespan_context = original_lifespan
        app.dependency_overrides.clear()


class TestPromptTemplates:
    def test_list_templates_by_category_groups_user_templates(self, client, mock_db):
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [
            make_template(
                template_id=1,
                category="recon",
                name="HTTP Enum",
                content="ffuf -u http://$target/FUZZ",
            ),
            make_template(
                template_id=2,
                category="recon",
                name="Port Sweep",
                content="nmap -p- $target",
            ),
            make_template(
                template_id=3,
                category="web",
                name="SQLi Check",
                content="sqlmap -u http://$target",
            ),
        ]
        mock_db.execute.return_value = mock_result

        response = client.get("/api/v1/prompts/templates")

        assert response.status_code == 200
        data = response.json()
        assert [category["id"] for category in data["categories"]] == ["recon", "web"]
        assert [template["name"] for template in data["categories"][0]["templates"]] == [
            "HTTP Enum",
            "Port Sweep",
        ]

    @patch("app.routers.prompts.save_user_template", new_callable=AsyncMock)
    def test_create_prompt_calls_sync_service(self, mock_save_user_template, client, mock_db):
        mock_save_user_template.return_value = make_template(
            template_id=7,
            category="recon",
            name="Directory Bust",
            variables=["target"],
            content="ffuf -u http://$target/FUZZ",
        )

        response = client.post(
            "/api/v1/prompts",
            json={
                "type": "template",
                "name": "Directory Bust",
                "description": "HTTP directory enumeration",
                "category": "recon",
                "variables": ["target"],
                "content": "ffuf -u http://$target/FUZZ",
            },
        )

        assert response.status_code == 201
        body = response.json()
        assert body["name"] == "Directory Bust"
        assert body["category"] == "recon"
        mock_save_user_template.assert_awaited_once_with(
            db=mock_db,
            user_id="test-user-id",
            prompt_type="template",
            name="Directory Bust",
            description="HTTP directory enumeration",
            category="recon",
            variables=["target"],
            content="ffuf -u http://$target/FUZZ",
        )

    def test_delete_prompt_returns_not_found_when_template_is_not_owned(self, client, mock_db):
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute.return_value = mock_result

        response = client.delete("/api/v1/prompts/404")

        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()
