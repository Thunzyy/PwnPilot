import os
from unittest.mock import AsyncMock, MagicMock, patch

import app.core.crypto as crypto
import pytest
from cryptography.fernet import Fernet
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.project import Project
from httpx import AsyncClient

from app.schemas.settings import SettingsUpdate
from app.services.settings_service import SettingsService
from tests.conftest import unique_project_name


@pytest.mark.anyio
async def test_health_check(client: AsyncClient):
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"


@pytest.mark.anyio
async def test_create_project(client: AsyncClient, auth_headers):
    project_name = unique_project_name()
    project_data = {"name": project_name, "type": "htb", "variables": {"target_ip": "10.10.10.1"}}
    response = await client.post(
        "/api/v1/projects", json=project_data, headers=auth_headers
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == project_name
    assert data["type"] == "htb"
    assert data["variables"]["target_ip"] == "10.10.10.1"


@pytest.mark.anyio
async def test_list_projects(client: AsyncClient, auth_headers):
    response = await client.get("/api/v1/projects", headers=auth_headers)
    assert response.status_code == 200
    assert isinstance(response.json(), list)


@pytest.mark.anyio
async def test_get_project_not_found(client: AsyncClient, auth_headers):
    response = await client.get(
        "/api/v1/projects/nonexistent-id", headers=auth_headers
    )
    assert response.status_code == 404


@pytest.mark.anyio
async def test_list_projects_handles_non_string_variables(
    client: AsyncClient,
    auth_headers,
    test_db: AsyncSession,
):
    project_name = unique_project_name()
    project_data = {"name": project_name, "type": "htb"}
    response = await client.post(
        "/api/v1/projects", json=project_data, headers=auth_headers
    )
    assert response.status_code == 201
    project_id = response.json()["id"]

    project = await test_db.get(Project, project_id)
    project.variables = {
        "attack_graph_v2_seed": {"kind": "demo-ctf", "workspace_seeded": True}
    }
    await test_db.commit()

    list_response = await client.get("/api/v1/projects", headers=auth_headers)
    assert list_response.status_code == 200


@pytest.mark.anyio
async def test_delete_project_removes_project_and_workspace(
    client: AsyncClient,
    auth_headers,
    test_db: AsyncSession,
):
    project_name = unique_project_name()
    create_response = await client.post(
        "/api/v1/projects",
        json={"name": project_name, "type": "custom"},
        headers=auth_headers,
    )
    assert create_response.status_code == 201
    project = create_response.json()

    workspace_path = project["workspace_path"]
    assert workspace_path
    assert os.path.isdir(workspace_path)

    delete_response = await client.delete(
        f"/api/v1/projects/{project['id']}",
        headers=auth_headers,
    )
    assert delete_response.status_code == 204

    deleted_project = await test_db.get(Project, project["id"])
    assert deleted_project is None
    assert not os.path.exists(workspace_path)


@pytest.mark.anyio
async def test_delete_seeded_project_removes_seeded_relations_and_workspace(
    client: AsyncClient,
    auth_headers,
    test_db: AsyncSession,
):
    project_name = unique_project_name()
    create_response = await client.post(
        "/api/v1/projects",
        json={"name": project_name, "type": "ctf"},
        headers=auth_headers,
    )
    assert create_response.status_code == 201
    project = create_response.json()

    seed_response = await client.post(
        f"/api/v1/projects/{project['id']}/graph/demo-ctf",
        headers=auth_headers,
    )
    assert seed_response.status_code == 200

    workspace_path = project["workspace_path"]
    assert workspace_path
    assert os.path.isdir(workspace_path)

    delete_response = await client.delete(
        f"/api/v1/projects/{project['id']}",
        headers=auth_headers,
    )
    assert delete_response.status_code == 204, delete_response.text

    deleted_project = await test_db.get(Project, project["id"])
    assert deleted_project is None
    assert not os.path.exists(workspace_path)


@pytest.mark.anyio
async def test_import_project_context_enriches_htb_machine_via_api(
    client: AsyncClient,
    auth_headers,
    test_db: AsyncSession,
):
    await SettingsService(test_db).update(
        SettingsUpdate(
            vpn_platform_defaults={
                "htb": {
                    "label": "Hack The Box",
                    "connect_command": "sudo openvpn {{vpn_path}}",
                    "api_token": "token-for-tests",
                }
            }
        )
    )

    mock_response = MagicMock()
    mock_response.raise_for_status.return_value = None
    mock_response.json.return_value = {
        "info": {
            "id": 351,
            "name": "Cap",
            "os": "Linux",
            "difficultyText": "Easy",
            "ip": "10.10.10.245",
            "synopsis": "Cap synopsis from HTB API.",
            "active": True,
        }
    }

    with patch(
        "app.services.platform_context_service.httpx.AsyncClient.get",
        AsyncMock(return_value=mock_response),
    ):
        response = await client.post(
            "/api/v1/projects/context/import-url",
            json={
                "url": "https://app.hackthebox.com/machines/Cap?sort_by=created_at&sort_type=desc"
            },
            headers=auth_headers,
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["source"] == "htb_api"
    assert payload["context"]["platform_target_name"] == "Cap"
    assert payload["context"]["platform_target_slug"] == "Cap"
    assert payload["context"]["platform_difficulty"] == "Easy"
    assert payload["context"]["os"] == "Linux"
    assert payload["context"]["target_ip"] == "10.10.10.245"
    assert payload["context"]["notes"] == "Cap synopsis from HTB API."


@pytest.mark.anyio
async def test_import_project_context_falls_back_when_stored_htb_token_cannot_decrypt(
    client: AsyncClient,
    auth_headers,
    test_db: AsyncSession,
    monkeypatch,
):
    monkeypatch.setattr(crypto, "_RUNTIME_KEY", Fernet.generate_key())
    await SettingsService(test_db).update(
        SettingsUpdate(
            vpn_platform_defaults={
                "htb": {
                    "label": "Hack The Box",
                    "connect_command": "sudo openvpn {{vpn_path}}",
                    "api_token": "token-from-previous-runtime",
                }
            }
        )
    )
    monkeypatch.setattr(crypto, "_RUNTIME_KEY", Fernet.generate_key())

    mock_response = MagicMock()
    mock_response.raise_for_status.return_value = None
    mock_response.text = (
        "<html><head><title>Cap (Easy) | Hack The Box</title>"
        '<meta name="description" content="Cap synopsis from public page."></head></html>'
    )

    with patch(
        "app.services.platform_context_service.httpx.AsyncClient.get",
        AsyncMock(return_value=mock_response),
    ):
        response = await client.post(
            "/api/v1/projects/context/import-url",
            json={
                "url": "https://app.hackthebox.com/machines/Cap?sort_by=created_at&sort_type=desc"
            },
            headers=auth_headers,
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["source"] == "htb_public_page"
    assert payload["context"]["platform_target_name"] == "Cap"
    assert payload["context"]["platform_difficulty"] == "Easy"
    assert payload["context"]["notes"] == "Cap synopsis from public page."


@pytest.mark.anyio
async def test_project_vpn_status_reports_connected_process_for_platform_default(
    client: AsyncClient,
    auth_headers,
    test_db: AsyncSession,
):
    await SettingsService(test_db).update(
        SettingsUpdate(
            vpn_platform_defaults={
                "htb": {
                    "label": "Hack The Box",
                    "config_path": "/vpn/htb.ovpn",
                    "connect_command": "sudo openvpn {{vpn_path}}",
                }
            }
        )
    )

    create_response = await client.post(
        "/api/v1/projects",
        json={"name": unique_project_name(), "type": "htb"},
        headers=auth_headers,
    )
    assert create_response.status_code == 201
    project = create_response.json()

    # This endpoint test consumes normalized processes, independently of whether
    # the host discovers them with POSIX ps or Windows CIM/JSON.
    mock_processes = [{
        "pid": 4242,
        "name": "openvpn",
        "command": "openvpn /vpn/htb.ovpn --config /vpn/htb.ovpn",
    }]

    with patch(
        "app.services.project_vpn_service.ProjectVpnService._list_processes",
        return_value=mock_processes,
    ):
        response = await client.get(
            f"/api/v1/projects/{project['id']}/vpn-status",
            headers=auth_headers,
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["platform_id"] == "htb"
    assert payload["platform_label"] == "Hack The Box"
    assert payload["button_label"] == "Connect HTB VPN"
    assert payload["state"] == "connected"
    assert payload["config_path"] == "/vpn/htb.ovpn"
    assert payload["command"] == "sudo openvpn /vpn/htb.ovpn"
    assert payload["disconnect_command"] == "sudo kill 4242"
    assert payload["connected_process_pid"] == 4242
    assert payload["connected_process_name"] == "openvpn"


@pytest.mark.anyio
async def test_project_vpn_status_resolves_custom_platform_override(
    client: AsyncClient,
    auth_headers,
    test_db: AsyncSession,
):
    await SettingsService(test_db).update(
        SettingsUpdate(
            vpn_platform_defaults={
                "academy": {
                    "label": "HTB Academy",
                    "config_path": "/vpn/academy.ovpn",
                    "connect_command": "sudo openvpn {{vpn_path}}",
                }
            }
        )
    )

    create_response = await client.post(
        "/api/v1/projects",
        json={
            "name": unique_project_name(),
            "type": "custom",
            "variables": {"vpn_platform": "academy"},
        },
        headers=auth_headers,
    )
    assert create_response.status_code == 201
    project = create_response.json()

    empty_processes = MagicMock(returncode=0, stdout="")

    with patch("app.services.project_vpn_service.subprocess.run", return_value=empty_processes):
        response = await client.get(
            f"/api/v1/projects/{project['id']}/vpn-status",
            headers=auth_headers,
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["platform_id"] == "academy"
    assert payload["platform_label"] == "HTB Academy"
    assert payload["button_label"] == "Connect HTB Academy VPN"
    assert payload["state"] == "disconnected"
    assert payload["config_path"] == "/vpn/academy.ovpn"
    assert payload["command"] == "sudo openvpn /vpn/academy.ovpn"
    assert payload["disconnect_command"] is None
