import os
import subprocess
from pathlib import Path

import pytest
from pydantic import ValidationError


def _reload_config_module():
    from importlib import reload
    from app import config

    return reload(config)


def test_console_provider_config_default():
    # Clear env and reimport
    os.environ.pop("CONSOLE_PROVIDER", None)
    config = _reload_config_module()
    assert config.settings.console_provider == "tmux_ttyd"


def test_console_provider_config_ttyd_ports():
    from app.config import settings

    assert settings.ttyd_port_start == 7680
    assert settings.ttyd_port_end == 7780
    assert settings.ttyd_host == "localhost"


def test_debug_release_env_is_treated_as_false(monkeypatch):
    monkeypatch.setenv("DEBUG", "release")

    config = _reload_config_module()

    assert config.settings.debug is False


def test_debug_development_env_is_treated_as_true(monkeypatch):
    monkeypatch.setenv("DEBUG", "development")

    config = _reload_config_module()

    assert config.settings.debug is True


def test_invalid_debug_env_still_raises_validation_error(monkeypatch):
    monkeypatch.setenv("DEBUG", "definitely-not-a-bool")

    with pytest.raises(ValidationError):
        _reload_config_module()


def test_config_looks_up_repo_root_env_only():
    from app import config

    env_files = tuple(config.get_default_env_files())

    assert env_files == (str(config.REPO_ROOT / ".env"),)
    assert Path(env_files[0]).parent == config.REPO_ROOT


def test_env_example_is_shell_sourceable():
    repo_root = Path(__file__).resolve().parents[2]
    result = subprocess.run(
        ["bash", "-lc", "set -euo pipefail; source ./.env.example"],
        cwd=repo_root,
        capture_output=True,
        text=True,
    )

    if result.returncode != 0 and "execvpe(/bin/bash) failed" in result.stderr:
        pytest.skip("bash is not available in this Windows/WSL environment")

    assert result.returncode == 0, result.stderr
def test_api_base_url_defaults_to_backend_host_and_port(monkeypatch):
    monkeypatch.delenv("API_BASE_URL", raising=False)
    monkeypatch.setenv("BACKEND_HOST", "127.0.0.1")
    monkeypatch.setenv("BACKEND_PORT", "8123")

    config = _reload_config_module()

    assert config.settings.api_base_url == "http://127.0.0.1:8123/api/v1"

