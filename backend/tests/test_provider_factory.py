import importlib
import sys
from unittest.mock import patch

import pytest

from app.services.console_provider import ConsoleProvider
from app.services.providers.legacy_pty import LegacyPtyProvider


def _clear_provider_modules() -> None:
    for module_name in [
        "app.services.provider_factory",
        "app.services.providers",
        "app.services.providers.tmux_ttyd",
    ]:
        sys.modules.pop(module_name, None)


def _import_provider_factory():
    _clear_provider_modules()
    return importlib.import_module("app.services.provider_factory")


def test_provider_factory_imports_without_loading_posix_only_provider():
    module = _import_provider_factory()
    assert callable(module.get_provider)


def test_get_provider_returns_console_provider():
    module = _import_provider_factory()
    module.get_provider.cache_clear()

    with patch.object(module, "settings") as mock_settings:
        mock_settings.console_provider = "legacy"
        mock_settings.ttyd_host = "localhost"
        mock_settings.ttyd_use_ssl = False

        provider = module.get_provider()

    assert isinstance(provider, ConsoleProvider)
    assert isinstance(provider, LegacyPtyProvider)


def test_get_provider_legacy_by_default():
    module = _import_provider_factory()
    module.get_provider.cache_clear()

    with patch.object(module, "settings") as mock_settings:
        mock_settings.console_provider = "legacy"
        mock_settings.ttyd_host = "localhost"
        mock_settings.ttyd_use_ssl = False

        provider = module.get_provider()

    assert isinstance(provider, LegacyPtyProvider)


@pytest.mark.skipif(sys.platform == "win32", reason="tmux+ttyd provider is POSIX only")
def test_get_provider_tmux_ttyd():
    module = _import_provider_factory()
    module.get_provider.cache_clear()

    with patch.object(module, "settings") as mock_settings:
        with patch(
            "app.services.providers.tmux_ttyd.shutil.which",
            return_value="/usr/bin/mock",
        ):
            mock_settings.console_provider = "tmux_ttyd"
            mock_settings.ttyd_host = "localhost"
            mock_settings.ttyd_use_ssl = False
            provider = module.get_provider()

    from app.services.providers.tmux_ttyd import TmuxTtydProvider

    assert isinstance(provider, TmuxTtydProvider)


@pytest.mark.skipif(sys.platform != "win32", reason="Windows-specific regression coverage")
def test_get_provider_falls_back_to_legacy_on_windows_when_tmux_requested():
    module = _import_provider_factory()
    module.get_provider.cache_clear()

    with patch.object(module, "settings") as mock_settings:
        mock_settings.console_provider = "tmux_ttyd"
        mock_settings.ttyd_host = "localhost"
        mock_settings.ttyd_use_ssl = False

        provider = module.get_provider()

    assert isinstance(provider, LegacyPtyProvider)


def test_get_provider_falls_back_to_legacy_when_tmux_provider_cannot_start():
    module = _import_provider_factory()
    module.get_provider.cache_clear()

    with patch.object(module, "settings") as mock_settings:
        with patch.object(module.sys, "platform", "linux"):
            with patch(
                "app.services.providers.TmuxTtydProvider",
                side_effect=RuntimeError("tmux not found in PATH"),
            ):
                mock_settings.console_provider = "tmux_ttyd"
                mock_settings.ttyd_host = "localhost"
                mock_settings.ttyd_use_ssl = False

                provider = module.get_provider()

    assert isinstance(provider, LegacyPtyProvider)
