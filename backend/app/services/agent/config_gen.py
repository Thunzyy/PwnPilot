"""MCP config file generators for CLI agent subprocesses.

Each agent type expects its MCP server configuration in a different format:
  - Claude Code: JSON file passed via ``--mcp-config <path>``
  - Codex CLI: TOML file passed via ``--mcp-config <path>``
  - Custom: no config generated (user supplies their own)

Config files are written to secure temp files (``0o600``) so that bearer
tokens are not exposed to other users on the system.  Temp files are used
instead of inline JSON in tmux ``send-keys`` because shell escaping of
nested JSON inside tmux is unreliable (Pitfall #6 from research).

No TOML library is needed -- the Codex config is only three lines and is
trivially assembled with string formatting.
"""

import json
import os
import tempfile
from pathlib import Path

from app.core.logging import get_logger

log = get_logger("agent.config")


def generate_claude_code_config(mcp_url: str, token: str) -> str:
    """Create a JSON MCP config for Claude Code and return its path.

    The file is created with restrictive permissions (``0o600``) before
    any content is written, preventing other users from reading the
    bearer token.

    Args:
        mcp_url: Full URL of the PwnPilot MCP endpoint.
        token: Bearer token for MCP authentication.

    Returns:
        Absolute path to the temporary JSON config file.
    """
    config = {
        "mcpServers": {
            "pwnpilot": {
                "type": "http",
                "url": mcp_url,
                "headers": {
                    "Authorization": f"Bearer {token}",
                },
            }
        }
    }

    fd, path = tempfile.mkstemp(suffix=".json", prefix="ppagent-mcp-")
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(config, f, indent=2)

    log.debug("Claude Code MCP config written", path=path)
    return path


def generate_codex_config(
    mcp_url: str,
    token_env_var: str = "PP_MCP_TOKEN",
) -> str:
    """Create a TOML MCP config for Codex CLI and return its path.

    The Codex CLI reads the bearer token from an environment variable
    rather than embedding it directly in the config file.  The config is
    written as ``config.toml`` inside an isolated temp directory so that
    Codex (which expects ``CODEX_HOME/config.toml``) finds it correctly.

    Args:
        mcp_url: Full URL of the PwnPilot MCP endpoint.
        token_env_var: Name of the env var holding the bearer token.

    Returns:
        Absolute path to the ``config.toml`` file inside a temp directory.
    """
    content = (
        "[mcp_servers.pwnpilot]\n"
        f'url = "{mcp_url}"\n'
        f'bearer_token_env_var = "{token_env_var}"\n'
    )

    tmp_dir = tempfile.mkdtemp(prefix="ppagent-codex-")
    config_path = Path(tmp_dir) / "config.toml"

    fd = os.open(str(config_path), os.O_WRONLY | os.O_CREAT | os.O_EXCL)
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(content)

    log.debug("Codex MCP config written", path=str(config_path))
    return str(config_path)


def cleanup_config(config_path: str) -> bool:
    """Safely delete a temporary MCP config file and its parent directory.

    If the parent directory name starts with ``ppagent-`` and is empty
    after file removal, it is also removed.

    Args:
        config_path: Absolute path to the config file.

    Returns:
        ``True`` if the file existed and was deleted, ``False`` if it
        was already gone.
    """
    try:
        target = Path(config_path)
        if target.exists():
            target.unlink(missing_ok=True)
            log.debug("MCP config cleaned up", path=config_path)
            # Clean up ppagent temp directory if now empty
            parent = target.parent
            if parent.name.startswith("ppagent-"):
                try:
                    parent.rmdir()  # Only removes if empty
                    log.debug("Cleaned up temp dir", path=str(parent))
                except OSError:
                    pass  # Dir not empty or already removed
            return True
        return False
    except Exception:
        log.warning("Failed to clean up MCP config", path=config_path)
        return False
