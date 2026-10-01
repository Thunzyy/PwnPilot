"""Security utilities for PwnPilot.

This module provides security-related functions to prevent common
vulnerabilities like path traversal attacks.
"""

from pathlib import Path

from app.core.errors import ErrorCode
from app.core.exceptions import AppException


def validate_workspace_path(requested_path: str, allowed_roots: list[str]) -> Path:
    """Validate that a path is under an allowed root directory.

    This prevents path traversal attacks where a malicious user might try
    to access files outside the allowed directories (e.g., /etc/passwd).

    Args:
        requested_path: The path requested by the user
        allowed_roots: List of allowed root directories (can use ~ for home)

    Returns:
        Resolved absolute Path if valid

    Raises:
        AppException: If path is not under any allowed root

    Example:
        >>> validate_workspace_path("~/PwnPilot/myproject", ["~/PwnPilot"])
        PosixPath('/home/user/PwnPilot/myproject')

        >>> validate_workspace_path("/etc/passwd", ["~/PwnPilot"])
        AppException: 1006:PROJECT_PATH_FORBIDDEN
    """
    # Resolve the requested path to absolute
    resolved = Path(requested_path).expanduser().resolve()

    # Check against each allowed root
    for root in allowed_roots:
        allowed = Path(root).expanduser().resolve()

        # Check if resolved path is the allowed root or under it
        if resolved == allowed:
            return resolved

        # Check if allowed root is a parent of resolved path
        try:
            resolved.relative_to(allowed)
            return resolved
        except ValueError:
            # Not a subpath, try next root
            continue

    # Path is not under any allowed root
    raise AppException(
        ErrorCode.PROJECT_PATH_FORBIDDEN,
        f"Path '{requested_path}' is not under allowed directories",
        {
            "requested": str(resolved),
            "allowed": allowed_roots,
        },
    )


def validate_vault_path(requested_path: str, vault_root: str) -> Path:
    """Validate that a path is safely within a vault root directory.

    Performs strict validation against path traversal, URL-encoded sequences,
    and symlinks pointing outside the vault.

    Args:
        requested_path: The path to validate
        vault_root: The vault root directory

    Returns:
        Resolved absolute Path if valid

    Raises:
        AppException: If path escapes or is invalid
    """
    if "%" in requested_path:
        raise AppException(
            ErrorCode.KB_VAULT_PATH_FORBIDDEN,
            "URL-encoded sequences are not allowed in vault paths",
            {"requested": requested_path},
        )

    raw = Path(requested_path)

    # Reject symlinks before resolving
    if raw.is_symlink():
        raise AppException(
            ErrorCode.KB_VAULT_PATH_FORBIDDEN,
            "Symlinks are not allowed in vault paths",
            {"requested": requested_path},
        )

    resolved = raw.resolve()
    vault = Path(vault_root).resolve()

    if resolved == vault:
        return resolved

    try:
        resolved.relative_to(vault)
        return resolved
    except ValueError:
        raise AppException(
            ErrorCode.KB_VAULT_PATH_FORBIDDEN,
            f"Path '{requested_path}' is not within the vault",
            {"requested": str(resolved), "vault_root": str(vault)},
        )


def sanitize_filename(filename: str) -> str:
    """Sanitize a filename to prevent directory traversal.

    Removes or replaces potentially dangerous characters.

    Args:
        filename: The filename to sanitize

    Returns:
        Sanitized filename safe for filesystem use
    """
    # Remove path separators and null bytes
    dangerous_chars = ["/", "\\", "\x00", "..", "~"]
    result = filename

    for char in dangerous_chars:
        result = result.replace(char, "_")

    # Remove leading/trailing whitespace and dots
    result = result.strip(". \t\n\r")

    # Ensure we have something left
    if not result:
        result = "unnamed"

    return result
