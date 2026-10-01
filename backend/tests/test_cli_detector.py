"""Tests for CLI provider auto-detection helpers."""

from unittest.mock import AsyncMock, patch

import pytest

from app.services.cli_detector import resolve_cli_command


@pytest.mark.anyio
@patch("app.services.cli_detector._detect_version", new_callable=AsyncMock)
async def test_resolve_cli_command_matches_windows_executable_path(mock_detect_version):
    mock_detect_version.return_value = "1.2.3"

    result = await resolve_cli_command(r"C:\Users\operator\.local\bin\claude.EXE")

    assert result == {
        "provider_type": "cli",
        "name": "Claude Code",
        "default_model": "claude-sonnet-4-20250514",
        "cli_command": r"C:\Users\operator\.local\bin\claude.EXE",
        "cli_args_template": "-p {prompt} --output-format json --model {model}",
        "cli_interactive_args": "--resume {session_id}",
        "cli_env": None,
        "working_directory": None,
        "parse_mode": "json",
        "supports_streaming": True,
        "supports_resume": True,
        "session_flag": "--resume",
        "detected_version": "1.2.3",
        "detected_models": [
            "claude-sonnet-4-20250514",
            "claude-opus-4-20250514",
        ],
    }
    mock_detect_version.assert_awaited_once_with(
        r"C:\Users\operator\.local\bin\claude.EXE"
    )


@pytest.mark.anyio
@patch("app.services.cli_detector._detect_version", new_callable=AsyncMock)
async def test_resolve_cli_command_returns_current_codex_model_catalog(mock_detect_version):
    mock_detect_version.return_value = "codex-cli 0.114.0"

    result = await resolve_cli_command("codex")

    assert result == {
        "provider_type": "cli",
        "name": "Codex",
        "default_model": "gpt-5.4",
        "cli_command": "codex",
        "cli_args_template": "exec --skip-git-repo-check --json --model {model} {prompt}",
        "cli_interactive_args": "--model {model}",
        "cli_env": None,
        "working_directory": None,
        "parse_mode": "json",
        "supports_streaming": True,
        "supports_resume": False,
        "session_flag": None,
        "detected_version": "codex-cli 0.114.0",
        "detected_models": [
            "gpt-5.4",
            "gpt-5.4-mini",
            "gpt-5-codex",
            "gpt-5.3-codex",
            "gpt-5.2-codex",
            "gpt-5.1-codex",
            "gpt-5.1-codex-max",
            "gpt-5.1-codex-mini",
            "codex-mini-latest",
        ],
    }
    mock_detect_version.assert_awaited_once_with("codex")
