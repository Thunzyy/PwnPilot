"""Structured logging configuration using loguru.

Usage:
    from app.core.logging import get_logger

    log = get_logger("service.project")
    log.info("Creating project", name="box-1")

Log format:
    [LEVEL] [MODULE] message (key=value key=value)

Configuration via environment:
    LOG_LEVEL: DEBUG, INFO, WARNING, ERROR (default: INFO)
    LOG_MODULES: Comma-separated list of modules to enable (empty = all)
    LOG_FORMAT: console (colored) or json (for production)
"""

import sys
from typing import TYPE_CHECKING

from loguru import logger

if TYPE_CHECKING:
    from app.config import Settings

# Global state for module filtering
_enabled_modules: set[str] | None = None
_is_setup = False


def setup_logging(settings: "Settings") -> None:
    """Initialize logging configuration. Call once at startup."""
    global _enabled_modules, _is_setup

    if _is_setup:
        return

    # Remove default handler
    logger.remove()

    # Parse enabled modules
    if settings.log_modules:
        _enabled_modules = set(settings.log_modules.split(","))
    else:
        _enabled_modules = None  # All modules enabled

    # Ensure the `module` extra key always exists, even when some code logs
    # via the raw `loguru.logger` instance instead of `get_logger(...)`.
    logger.configure(extra={"module": "app"})

    # Define format
    if settings.log_format == "json":
        # JSON format for production/log aggregation
        logger.add(
            sys.stdout,
            serialize=True,
            level=settings.log_level.upper(),
        )
    else:
        # Console format with colors
        log_format = (
            "<level>[{level.name}]</level> "
            "<cyan>[{extra[module]}]</cyan> "
            "{message}"
        )
        logger.add(
            sys.stdout,
            format=log_format,
            level=settings.log_level.upper(),
            colorize=True,
        )

    _is_setup = True
    logger.bind(module="core").info("Logging initialized", level=settings.log_level)


def get_logger(module: str) -> logger:
    """Get a logger instance for a specific module.

    Args:
        module: Module identifier (e.g., "api", "service.project", "terminal")

    Returns:
        Logger instance bound to the module
    """
    bound_logger = logger.bind(module=module)

    # Check if module is enabled
    if _enabled_modules is not None:
        # Check if module or its parent is enabled
        # e.g., "service.project" is enabled if "service" or "service.project" is in the list
        module_parts = module.split(".")
        is_enabled = any(
            ".".join(module_parts[:i+1]) in _enabled_modules
            for i in range(len(module_parts))
        )
        if not is_enabled:
            return bound_logger.disable(__name__)

    return bound_logger
