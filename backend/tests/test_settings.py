from pathlib import Path
from types import SimpleNamespace

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.schemas.settings import SettingsUpdate
from app.services import settings_service as settings_service_module
from app.services.settings_service import SettingsService


@pytest.mark.anyio
async def test_settings_requires_super_admin(client: AsyncClient):
    await client.post(
        "/api/v1/auth/signup",
        json={"username": "admin", "email": "admin@example.com", "password": "secret123"},
    )
    login = await client.post(
        "/api/v1/auth/login",
        json={"username_or_email": "admin", "password": "secret123"},
    )
    token = login.json()["access_token"]
    response = await client.put(
        "/api/v1/settings",
        json={
            "workspace_base_path": "PwnPilot/projects",
            "vpn_platform_defaults": {
                "htb": {
                    "label": "Hack The Box",
                    "config_path": "/vpn/htb.ovpn",
                    "connect_command": "sudo openvpn {{vpn_path}}",
                }
            },
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["vpn_platform_defaults"]["htb"]["config_path"] == "/vpn/htb.ovpn"


@pytest.mark.anyio
async def test_settings_support_dynamic_vpn_platforms_and_managed_files(
    test_db: AsyncSession,
):
    uploaded_file_name = "release_arena_eu-release-2.ovpn"
    service = SettingsService(test_db)

    saved = await service.update(
        SettingsUpdate(
            vpn_platform_defaults={
                "academy": {
                    "label": "HTB Academy",
                    "connect_command": "sudo openvpn --config {{vpn_path}}",
                    "uploaded_file_name": uploaded_file_name,
                    "uploaded_file_content": "client\nremote academy.htb 1194\n",
                }
            }
        )
    )

    academy = saved.vpn_platform_defaults["academy"]
    assert academy["label"] == "HTB Academy"
    assert academy["file_name"] == uploaded_file_name
    assert academy["managed"] is True

    config_path = Path(academy["config_path"])
    expected_path = (
        Path(settings.projects_root).expanduser() / "vpn-platforms" / "academy" / uploaded_file_name
    )
    assert config_path == expected_path
    assert config_path.exists()
    assert config_path.read_text(encoding="utf-8") == "client\nremote academy.htb 1194\n"

    deleted = await service.update(SettingsUpdate(vpn_platform_defaults={}))

    assert deleted.vpn_platform_defaults == {}
    assert not config_path.exists()
    assert not config_path.parent.exists()


@pytest.mark.anyio
async def test_settings_can_disable_builtin_vpn_platform_and_remove_managed_file(
    test_db: AsyncSession,
):
    uploaded_file_name = "release_arena_eu-release-2.ovpn"
    service = SettingsService(test_db)

    saved = await service.update(
        SettingsUpdate(
            vpn_platform_defaults={
                "htb": {
                    "label": "Hack The Box",
                    "connect_command": "sudo openvpn {{vpn_path}}",
                    "uploaded_file_name": uploaded_file_name,
                    "uploaded_file_content": "client\nremote release-arena.htb 1194\n",
                }
            }
        )
    )

    config_path = Path(saved.vpn_platform_defaults["htb"]["config_path"])
    assert config_path.exists()

    disabled = await service.update(
        SettingsUpdate(
            vpn_platform_defaults={
                "htb": {
                    "label": "Hack The Box",
                    "connect_command": "sudo openvpn {{vpn_path}}",
                    "disabled": True,
                }
            }
        )
    )

    htb = disabled.vpn_platform_defaults["htb"]
    assert htb["disabled"] is True
    assert htb["config_path"] == ""
    assert htb["managed"] is False
    assert not config_path.exists()


@pytest.mark.anyio
async def test_settings_encrypt_platform_api_tokens_and_hide_them_from_api(
    client: AsyncClient,
    auth_headers,
    test_db: AsyncSession,
):
    response = await client.put(
        "/api/v1/settings",
        json={
            "vpn_platform_defaults": {
                "htb": {
                    "label": "Hack The Box",
                    "connect_command": "sudo openvpn {{vpn_path}}",
                    "api_token": "secret-htb-token",
                }
            }
        },
        headers=auth_headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["vpn_platform_defaults"]["htb"]["has_api_token"] is True
    assert "api_token" not in payload["vpn_platform_defaults"]["htb"]
    assert "api_token_encrypted" not in payload["vpn_platform_defaults"]["htb"]

    stored = await SettingsService(test_db).get_or_create()
    encrypted = stored.vpn_platform_defaults["htb"]["api_token_encrypted"]
    assert encrypted
    assert encrypted != "secret-htb-token"

    cleared = await client.put(
        "/api/v1/settings",
        json={
            "vpn_platform_defaults": {
                "htb": {
                    "label": "Hack The Box",
                    "connect_command": "sudo openvpn {{vpn_path}}",
                    "clear_api_token": True,
                }
            }
        },
        headers=auth_headers,
    )

    assert cleared.status_code == 200
    assert cleared.json()["vpn_platform_defaults"]["htb"]["has_api_token"] is False


@pytest.mark.anyio
async def test_settings_response_uses_report_runtime_defaults_from_config(
    test_db: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(
        settings_service_module,
        "settings",
        SimpleNamespace(
            projects_root=settings.projects_root,
            report_evaluation_lease_seconds=41.0,
            report_evaluation_heartbeat_interval_seconds=9.5,
            report_evaluation_reclaim_poll_interval_seconds=17.0,
            report_evaluation_max_runtime_seconds=260.0,
        ),
    )

    response = await SettingsService(test_db).get_or_create_response()

    assert response["report_evaluation_lease_seconds"] == 41.0
    assert response["report_evaluation_heartbeat_interval_seconds"] == 9.5
    assert response["report_evaluation_reclaim_poll_interval_seconds"] == 17.0
    assert response["report_evaluation_max_runtime_seconds"] == 260.0


@pytest.mark.anyio
async def test_settings_persist_report_runtime_overrides(test_db: AsyncSession):
    service = SettingsService(test_db)

    saved = await service.update_response(
        SettingsUpdate(
            report_evaluation_lease_seconds=12.0,
            report_evaluation_heartbeat_interval_seconds=4.0,
            report_evaluation_reclaim_poll_interval_seconds=8.0,
            report_evaluation_max_runtime_seconds=180.0,
        )
    )

    assert saved["report_evaluation_lease_seconds"] == 12.0
    assert saved["report_evaluation_heartbeat_interval_seconds"] == 4.0
    assert saved["report_evaluation_reclaim_poll_interval_seconds"] == 8.0
    assert saved["report_evaluation_max_runtime_seconds"] == 180.0

    stored = await service.get_or_create()
    assert stored.report_evaluation_lease_seconds == 12.0
    assert stored.report_evaluation_heartbeat_interval_seconds == 4.0
    assert stored.report_evaluation_reclaim_poll_interval_seconds == 8.0
    assert stored.report_evaluation_max_runtime_seconds == 180.0
