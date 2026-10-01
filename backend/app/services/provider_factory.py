"""
Provider Factory - Creates the appropriate ConsoleProvider based on config
"""

import logging
import sys
from functools import lru_cache

from app.config import settings
from app.services.console_provider import ConsoleProvider
from app.services.providers import LegacyPtyProvider

logger = logging.getLogger(__name__)


def _build_tmux_provider() -> ConsoleProvider:
    if sys.platform == "win32":
        return LegacyPtyProvider()

    from app.services.providers import TmuxTtydProvider

    try:
        return TmuxTtydProvider(
            host=settings.ttyd_host,
            use_ssl=settings.ttyd_use_ssl,
        )
    except RuntimeError as exc:
        logger.warning(
            "Falling back to legacy terminal provider because tmux_ttyd could not start: %s",
            exc,
        )
        return LegacyPtyProvider()


@lru_cache
def get_provider() -> ConsoleProvider:
    """Get the configured console provider (singleton)"""
    if settings.console_provider == "tmux_ttyd":
        return _build_tmux_provider()
    return LegacyPtyProvider()
