"""Detection helpers for installed AI CLI runtimes."""

from __future__ import annotations

import asyncio
import shlex
import shutil
from dataclasses import dataclass


@dataclass(frozen=True)
class KnownCLIProfile:
    name: str
    command: str
    default_model: str
    recommended_timeout_seconds: int
    cli_args_template: str
    cli_interactive_args: str | None
    parse_mode: str
    supports_streaming: bool
    supports_resume: bool
    session_flag: str | None
    detected_models: list[str]


@dataclass(frozen=True)
class EffectiveCLISettings:
    cli_args_template: str | None
    cli_interactive_args: str | None
    parse_mode: str | None
    supports_streaming: bool
    supports_resume: bool
    session_flag: str | None


LEGACY_CODEX_ARGS_TEMPLATE = "--quiet --model {model} {prompt}"


KNOWN_CLIS: dict[str, KnownCLIProfile] = {
    "claude": KnownCLIProfile(
        name="Claude Code",
        command="claude",
        default_model="claude-sonnet-4-20250514",
        recommended_timeout_seconds=120,
        cli_args_template="-p {prompt} --output-format json --model {model}",
        cli_interactive_args="--resume {session_id}",
        parse_mode="json",
        supports_streaming=True,
        supports_resume=True,
        session_flag="--resume",
        detected_models=["claude-sonnet-4-20250514", "claude-opus-4-20250514"],
    ),
    "codex": KnownCLIProfile(
        name="Codex",
        command="codex",
        default_model="gpt-5.4",
        recommended_timeout_seconds=240,
        cli_args_template="exec --skip-git-repo-check --json --model {model} {prompt}",
        cli_interactive_args="--model {model}",
        parse_mode="json",
        supports_streaming=True,
        supports_resume=False,
        session_flag=None,
        detected_models=[
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
    ),
    "gemini": KnownCLIProfile(
        name="Gemini CLI",
        command="gemini",
        default_model="gemini-2.5-pro",
        recommended_timeout_seconds=120,
        cli_args_template="-p {prompt} --model {model}",
        cli_interactive_args=None,
        parse_mode="markdown",
        supports_streaming=True,
        supports_resume=False,
        session_flag=None,
        detected_models=["gemini-2.5-pro", "gemini-2.5-flash"],
    ),
    "aider": KnownCLIProfile(
        name="Aider",
        command="aider",
        default_model="gpt-4.1",
        recommended_timeout_seconds=120,
        cli_args_template="--message {prompt} --no-auto-commits --model {model}",
        cli_interactive_args="--restore-chat-history {session_id}",
        parse_mode="raw",
        supports_streaming=False,
        supports_resume=True,
        session_flag="--restore-chat-history",
        detected_models=["gpt-4.1"],
    ),
}


def _merge_models(*model_lists: list[str]) -> list[str]:
    merged: list[str] = []
    seen: set[str] = set()

    for model_list in model_lists:
        for candidate in model_list:
            trimmed = candidate.strip()
            if not trimmed:
                continue

            normalized = trimmed.lower()
            if normalized in seen:
                continue

            seen.add(normalized)
            merged.append(trimmed)

    return merged


def _strip_wrapping_quotes(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        return value[1:-1]
    return value


def _split_command(command: str) -> list[str]:
    stripped = command.strip()
    if not stripped:
        return []

    if "\\" in stripped and (":" in stripped or stripped.startswith(".\\") or stripped.startswith("..\\")):
        return [_strip_wrapping_quotes(token) for token in shlex.split(stripped, posix=False)]

    return shlex.split(stripped, posix=True)


def _command_lookup_key(command: str) -> str:
    tokens = _split_command(command)
    executable = tokens[0] if tokens else command.strip()
    basename = executable.replace("\\", "/").rsplit("/", maxsplit=1)[-1].lower()
    for suffix in (".exe", ".cmd", ".bat", ".ps1", ".sh"):
        if basename.endswith(suffix):
            basename = basename[:-len(suffix)]
            break
    return basename


def get_known_cli_profile(command: str) -> KnownCLIProfile | None:
    stripped = command.strip()
    if not stripped:
        return None
    return KNOWN_CLIS.get(_command_lookup_key(stripped))


def get_known_cli_models(
    command: str,
    configured_models: list[str] | None = None,
    default_model: str | None = None,
) -> list[str]:
    profile = get_known_cli_profile(command)
    known_models = profile.detected_models if profile else []
    fallback_models = [default_model] if default_model else []
    return _merge_models(known_models, configured_models or [], fallback_models)


def get_recommended_cli_timeout(command: str, default_timeout: int = 30) -> int:
    profile = get_known_cli_profile(command)
    if profile is None:
        return default_timeout
    return profile.recommended_timeout_seconds


def get_effective_cli_settings(
    command: str,
    *,
    cli_args_template: str | None,
    cli_interactive_args: str | None,
    parse_mode: str | None,
    supports_streaming: bool,
    supports_resume: bool,
    session_flag: str | None,
) -> EffectiveCLISettings:
    profile = get_known_cli_profile(command)

    resolved_args_template = cli_args_template
    resolved_interactive_args = cli_interactive_args
    resolved_parse_mode = parse_mode
    resolved_supports_streaming = supports_streaming
    resolved_supports_resume = supports_resume
    resolved_session_flag = session_flag

    if profile and profile.command == "codex":
        if not resolved_args_template or resolved_args_template.strip() == LEGACY_CODEX_ARGS_TEMPLATE:
            resolved_args_template = profile.cli_args_template
            resolved_parse_mode = profile.parse_mode
            resolved_supports_streaming = profile.supports_streaming
            resolved_supports_resume = profile.supports_resume
            resolved_session_flag = profile.session_flag

        if not resolved_interactive_args:
            resolved_interactive_args = profile.cli_interactive_args

    return EffectiveCLISettings(
        cli_args_template=resolved_args_template,
        cli_interactive_args=resolved_interactive_args,
        parse_mode=resolved_parse_mode,
        supports_streaming=resolved_supports_streaming,
        supports_resume=resolved_supports_resume,
        session_flag=resolved_session_flag,
    )


def _build_detected_cli(
    profile: KnownCLIProfile,
    *,
    cli_command: str,
    version: str | None,
) -> dict:
    return {
        "provider_type": "cli",
        "name": profile.name,
        "default_model": profile.default_model,
        "cli_command": cli_command,
        "cli_args_template": profile.cli_args_template,
        "cli_interactive_args": profile.cli_interactive_args,
        "cli_env": None,
        "working_directory": None,
        "parse_mode": profile.parse_mode,
        "supports_streaming": profile.supports_streaming,
        "supports_resume": profile.supports_resume,
        "session_flag": profile.session_flag,
        "detected_version": version,
        "detected_models": get_known_cli_models(profile.command, profile.detected_models, profile.default_model),
    }


async def detect_installed_clis() -> list[dict]:
    """Scan PATH for known AI CLIs and return provider presets."""
    detections: list[dict] = []

    for profile in KNOWN_CLIS.values():
        executable = shutil.which(profile.command)
        if not executable:
            continue

        version = await _detect_version(executable)
        detections.append(_build_detected_cli(profile, cli_command=executable, version=version))

    return detections


async def resolve_cli_command(command: str) -> dict | None:
    """Resolve a manually entered CLI command/path to a known CLI profile."""
    stripped = command.strip()
    if not stripped:
        return None

    profile = get_known_cli_profile(stripped)
    if profile is None:
        return None

    tokens = _split_command(stripped)
    executable = tokens[0] if tokens else stripped
    version = await _detect_version(executable)
    return _build_detected_cli(profile, cli_command=stripped, version=version)


async def _detect_version(command: str) -> str | None:
    try:
        process = await asyncio.create_subprocess_exec(
            command,
            "--version",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate()
        output = (stdout or stderr).decode("utf-8", errors="replace").strip()
        if not output:
            return None
        return output.splitlines()[0]
    except Exception:
        return None
