"""Unit tests for MCP config file generators."""

import json
import os
import tempfile

import pytest

from app.services.agent.config_gen import (
    cleanup_config,
    generate_claude_code_config,
    generate_codex_config,
)

MCP_URL = "http://localhost:8000/mcp"
TOKEN = "test-bearer-token-abc123"


@pytest.fixture
def _cleanup_paths():
    """Track and clean up any config files created during tests."""
    paths: list[str] = []
    yield paths
    for p in paths:
        try:
            os.unlink(p)
        except FileNotFoundError:
            pass


class TestClaudeCodeConfig:
    """Tests for generate_claude_code_config."""

    def test_creates_valid_json(self, _cleanup_paths):
        """Config is valid JSON with expected mcpServers structure."""
        path = generate_claude_code_config(MCP_URL, TOKEN)
        _cleanup_paths.append(path)

        with open(path) as f:
            config = json.load(f)

        assert "mcpServers" in config
        server = config["mcpServers"]["pwnpilot"]
        assert server["type"] == "http"
        assert server["url"] == MCP_URL
        assert server["headers"]["Authorization"] == f"Bearer {TOKEN}"

    def test_file_permissions(self, _cleanup_paths):
        """Config file has restrictive permissions on the current OS."""
        path = generate_claude_code_config(MCP_URL, TOKEN)
        _cleanup_paths.append(path)

        mode = os.stat(path).st_mode & 0o777
        if os.name == "nt":
            # Windows does not expose POSIX ACLs through st_mode.  The
            # synthetic mode still needs to preserve owner read/write.
            assert mode & 0o600 == 0o600, f"Expected owner rw, got {oct(mode)}"
        else:
            assert mode == 0o600, f"Expected 0o600, got {oct(mode)}"


class TestCodexConfig:
    """Tests for generate_codex_config."""

    def test_creates_valid_toml(self, _cleanup_paths):
        """Config contains expected TOML keys for Codex CLI."""
        path = generate_codex_config(MCP_URL)
        _cleanup_paths.append(path)

        with open(path) as f:
            content = f.read()

        assert "[mcp_servers.pwnpilot]" in content
        assert f'url = "{MCP_URL}"' in content
        assert 'bearer_token_env_var = "PP_MCP_TOKEN"' in content

    def test_file_permissions(self, _cleanup_paths):
        """Config file has restrictive permissions on the current OS."""
        path = generate_codex_config(MCP_URL)
        _cleanup_paths.append(path)

        mode = os.stat(path).st_mode & 0o777
        if os.name == "nt":
            # Windows does not expose POSIX ACLs through st_mode.  The
            # synthetic mode still needs to preserve owner read/write.
            assert mode & 0o600 == 0o600, f"Expected owner rw, got {oct(mode)}"
        else:
            assert mode == 0o600, f"Expected 0o600, got {oct(mode)}"


class TestCleanupConfig:
    """Tests for cleanup_config."""

    def test_removes_existing_file(self):
        """cleanup_config deletes the file and returns True."""
        fd, path = tempfile.mkstemp(prefix="test-cleanup-")
        os.close(fd)
        assert os.path.exists(path)

        result = cleanup_config(path)

        assert result is True
        assert not os.path.exists(path)

    def test_missing_file_returns_false(self):
        """cleanup_config on non-existent path returns False without error."""
        result = cleanup_config("/tmp/nonexistent-ppagent-test-xyz.json")
        assert result is False
