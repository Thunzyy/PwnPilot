"""Console provider implementations"""

from typing import TYPE_CHECKING

from .legacy_pty import LegacyPtyProvider

__all__ = ["TmuxTtydProvider", "LegacyPtyProvider"]

if TYPE_CHECKING:
    from .tmux_ttyd import TmuxTtydProvider


def __getattr__(name: str):
    if name == "TmuxTtydProvider":
        from .tmux_ttyd import TmuxTtydProvider

        return TmuxTtydProvider
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
