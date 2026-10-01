"""Tests for CLI-based LLM provider."""

from __future__ import annotations

import asyncio
import os
import subprocess
import tempfile
from collections.abc import AsyncIterator

import pytest

from app.services.llm.cli_provider import CLIProvider


class _AsyncLineStream:
    def __init__(self, lines: list[bytes]):
        self._lines = list(lines)

    def __aiter__(self) -> AsyncIterator[bytes]:
        return self

    async def __anext__(self) -> bytes:
        if not self._lines:
            raise StopAsyncIteration
        return self._lines.pop(0)


class _FakeStreamingProcess:
    def __init__(self, lines: list[bytes], returncode: int = 0):
        self.stdout = _AsyncLineStream(lines)
        self.stderr = _AsyncLineStream([])
        self.returncode = returncode

    async def wait(self) -> int:
        return self.returncode


class _FakeBufferedProcess:
    def __init__(self, stdout: bytes, stderr: bytes = b"", returncode: int = 0):
        self.stdout = None
        self.stderr = None
        self._stdout = stdout
        self._stderr = stderr
        self.returncode = returncode

    async def communicate(self) -> tuple[bytes, bytes]:
        return self._stdout, self._stderr


class _HangingBufferedProcess:
    def __init__(self):
        self.stdout = None
        self.stderr = None
        self.returncode = None
        self.killed = False
        self._killed = asyncio.Event()

    async def communicate(self) -> tuple[bytes, bytes]:
        await self._killed.wait()
        return b"", b""

    def kill(self) -> None:
        self.killed = True
        self.returncode = -9
        self._killed.set()

    terminate = kill

    async def wait(self) -> int:
        await self._killed.wait()
        return int(self.returncode or -9)


class _NeverLineStream:
    def __aiter__(self) -> AsyncIterator[bytes]:
        return self

    async def __anext__(self) -> bytes:
        await asyncio.Future()
        raise StopAsyncIteration


class _ScheduledLineStream:
    def __init__(
        self,
        scheduled_lines: list[tuple[float, bytes]],
        *,
        hang_after: bool = False,
    ):
        self._scheduled_lines = list(scheduled_lines)
        self._hang_after = hang_after

    def __aiter__(self) -> AsyncIterator[bytes]:
        return self

    async def __anext__(self) -> bytes:
        if self._scheduled_lines:
            delay, line = self._scheduled_lines.pop(0)
            await asyncio.sleep(delay)
            return line
        if self._hang_after:
            await asyncio.Future()
        raise StopAsyncIteration


class _HangingStreamingProcess:
    def __init__(self, stdout: AsyncIterator[bytes] | None = None):
        self.stdout = stdout or _NeverLineStream()
        self.stderr = _AsyncLineStream([])
        self.returncode = None
        self.killed = False
        self._killed = asyncio.Event()

    def kill(self) -> None:
        self.killed = True
        self.returncode = -9
        self._killed.set()

    terminate = kill

    async def wait(self) -> int:
        await self._killed.wait()
        return int(self.returncode or -9)


@pytest.fixture
def cli_provider():
    return CLIProvider(
        cli_command="claude",
        cli_args_template='-p {prompt} --output-format json --model {model}',
        cli_interactive_args="--resume {session_id}",
        cli_env={"PATH": "C:/tools"},
        working_directory="C:/workspace",
        parse_mode="json",
        supports_streaming=False,
        supports_resume=True,
        session_flag="--resume",
        detected_version="1.0.0",
        detected_models=["claude-sonnet-4-20250514"],
        timeout=120,
        default_model="claude-sonnet-4-20250514",
        temperature=0.7,
        max_tokens=4096,
        top_p=1.0,
        provider_label="Claude Code",
    )


@pytest.mark.anyio
async def test_cli_provider_parses_json_result(monkeypatch, cli_provider):
    async def fake_exec(*args, **kwargs):
        return _FakeBufferedProcess(
            b'{"type":"result","result":"The scan reveals SMB signing disabled.","model":"claude-sonnet-4-20250514","session_id":"abc-123"}'
        )

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)

    chunks = [chunk async for chunk in cli_provider.chat_stream(
        messages=[{"role": "user", "content": "scan 10.10.10.5"}]
    )]

    assert [chunk.content for chunk in chunks] == [
        "The scan reveals SMB signing disabled.",
        "",
    ]
    assert chunks[-1].done is True
    assert chunks[-1].metadata["source_mode"] == "cli_orchestrated"
    assert chunks[-1].metadata["cli_exit_code"] == 0
    assert chunks[-1].metadata["cli_session_id"] == "abc-123"
    assert "claude" in chunks[-1].metadata["cli_command"]
    assert "scan 10.10.10.5" in chunks[-1].metadata["cli_command"]
    assert isinstance(chunks[-1].metadata["cli_duration_ms"], int)


def test_cli_provider_preserves_windows_executable_path():
    assert CLIProvider._split_template(
        r"C:\Users\operator\.local\bin\claude.exe"
    ) == [r"C:\Users\operator\.local\bin\claude.exe"]


@pytest.mark.anyio
async def test_cli_provider_streams_line_delimited_json(monkeypatch):
    provider = CLIProvider(
        cli_command="claude",
        cli_args_template='-p {prompt} --output-format stream-json --model {model}',
        parse_mode="json",
        supports_streaming=True,
        timeout=120,
        default_model="claude-sonnet-4-20250514",
        temperature=0.7,
        max_tokens=4096,
        top_p=1.0,
        provider_label="Claude Code",
    )

    async def fake_exec(*args, **kwargs):
        return _FakeStreamingProcess(
            [
                b'{"type":"content","delta":"First chunk"}\n',
                b'{"type":"content","delta":" second chunk"}\n',
                b'{"type":"result","result":"First chunk second chunk","session_id":"sess-1"}\n',
            ]
        )

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)

    chunks = [chunk async for chunk in provider.chat_stream(
        messages=[{"role": "user", "content": "hello"}]
    )]

    assert [chunk.content for chunk in chunks] == ["First chunk", " second chunk", ""]
    assert chunks[-1].metadata["cli_session_id"] == "sess-1"


@pytest.mark.anyio
async def test_cli_provider_streams_nested_codex_agent_messages(monkeypatch):
    provider = CLIProvider(
        cli_command="codex",
        cli_args_template="exec --skip-git-repo-check --json --model {model} {prompt}",
        parse_mode="json",
        supports_streaming=True,
        timeout=120,
        default_model="gpt-5.4",
        temperature=0.7,
        max_tokens=4096,
        top_p=1.0,
        provider_label="Codex",
    )

    async def fake_exec(*args, **kwargs):
        return _FakeStreamingProcess(
            [
                b'{"type":"thread.started","thread_id":"t-1"}\n',
                b'{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Bootstrapping"}}\n',
                b'{"type":"item.completed","item":{"id":"item_1","type":"command_execution","aggregated_output":"ignored"}}\n',
                b'{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"Hello."}}\n',
                b'{"type":"turn.completed"}\n',
            ]
        )

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)

    chunks = [chunk async for chunk in provider.chat_stream(
        messages=[{"role": "user", "content": "hello"}]
    )]

    assert [chunk.content for chunk in chunks] == ["Bootstrapping", "Hello.", ""]
    assert chunks[-1].done is True


@pytest.mark.anyio
async def test_cli_provider_strips_ansi_from_markdown_output(monkeypatch):
    provider = CLIProvider(
        cli_command="codex",
        cli_args_template="--quiet --model {model} {prompt}",
        parse_mode="markdown",
        supports_streaming=False,
        timeout=120,
        default_model="o4-mini",
        temperature=0.7,
        max_tokens=4096,
        top_p=1.0,
        provider_label="Codex",
    )

    async def fake_exec(*args, **kwargs):
        return _FakeBufferedProcess(b"\x1b[32mAnswer with color\x1b[0m")

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)

    chunks = [chunk async for chunk in provider.chat_stream(
        messages=[{"role": "user", "content": "hello"}]
    )]

    assert chunks[0].content == "Answer with color"
    assert chunks[-1].done is True


@pytest.mark.anyio
async def test_cli_provider_buffered_async_path_times_out(monkeypatch, cli_provider):
    cli_provider.timeout = 0.01
    process = _HangingBufferedProcess()

    async def fake_exec(*args, **kwargs):
        return process

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)

    async def collect() -> list:
        return [
            chunk
            async for chunk in cli_provider.chat_stream(
                messages=[{"role": "user", "content": "hello"}]
            )
        ]

    with pytest.raises(subprocess.TimeoutExpired):
        await asyncio.wait_for(collect(), timeout=0.2)

    assert process.killed is True


@pytest.mark.anyio
async def test_cli_provider_streaming_async_path_times_out_on_stalled_output(
    monkeypatch,
):
    provider = CLIProvider(
        cli_command="codex",
        cli_args_template="exec --skip-git-repo-check --json --model {model} {prompt}",
        parse_mode="json",
        supports_streaming=True,
        timeout=0.01,
        default_model="gpt-5.4",
        temperature=0.7,
        max_tokens=4096,
        top_p=1.0,
        provider_label="Codex",
    )
    process = _HangingStreamingProcess()

    async def fake_exec(*args, **kwargs):
        return process

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)

    async def collect() -> list:
        return [
            chunk
            async for chunk in provider.chat_stream(
                messages=[{"role": "user", "content": "hello"}]
            )
        ]

    with pytest.raises(subprocess.TimeoutExpired):
        await asyncio.wait_for(collect(), timeout=0.2)

    assert process.killed is True


@pytest.mark.anyio
async def test_cli_provider_streaming_async_path_enforces_overall_deadline(
    monkeypatch,
):
    provider = CLIProvider(
        cli_command="codex",
        cli_args_template="exec --skip-git-repo-check --json --model {model} {prompt}",
        parse_mode="json",
        supports_streaming=True,
        timeout=0.05,
        default_model="gpt-5.4",
        temperature=0.7,
        max_tokens=4096,
        top_p=1.0,
        provider_label="Codex",
    )
    process = _HangingStreamingProcess(
        _ScheduledLineStream(
            [
                (0.03, b'{"type":"content","delta":"First chunk"}\n'),
                (0.03, b'{"type":"content","delta":" second chunk"}\n'),
            ],
            hang_after=True,
        )
    )

    async def fake_exec(*args, **kwargs):
        return process

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)

    async def collect() -> list:
        return [
            chunk
            async for chunk in provider.chat_stream(
                messages=[{"role": "user", "content": "hello"}]
            )
        ]

    with pytest.raises(subprocess.TimeoutExpired):
        await asyncio.wait_for(collect(), timeout=0.08)

    assert process.killed is True


@pytest.mark.anyio
async def test_cli_provider_streaming_async_path_times_out_when_exit_wait_exceeds_remaining_deadline(
    monkeypatch,
):
    provider = CLIProvider(
        cli_command="codex",
        cli_args_template="exec --skip-git-repo-check --json --model {model} {prompt}",
        parse_mode="json",
        supports_streaming=True,
        timeout=0.05,
        default_model="gpt-5.4",
        temperature=0.7,
        max_tokens=4096,
        top_p=1.0,
        provider_label="Codex",
    )
    process = _HangingStreamingProcess(
        _ScheduledLineStream(
            [
                (0.03, b'{"type":"content","delta":"First chunk"}\n'),
                (
                    0.015,
                    b'{"type":"result","result":"First chunk","session_id":"sess-1"}\n',
                ),
            ]
        )
    )

    async def fake_exec(*args, **kwargs):
        return process

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)

    async def collect() -> list:
        return [
            chunk
            async for chunk in provider.chat_stream(
                messages=[{"role": "user", "content": "hello"}]
            )
        ]

    with pytest.raises(subprocess.TimeoutExpired):
        await asyncio.wait_for(collect(), timeout=0.08)

    assert process.killed is True


@pytest.mark.anyio
async def test_cli_provider_lists_current_codex_models_for_saved_provider():
    provider = CLIProvider(
        cli_command="codex",
        cli_args_template="--quiet --model {model} {prompt}",
        parse_mode="markdown",
        supports_streaming=False,
        detected_models=["o3-mini", "o4-mini", "gpt-4.1"],
        timeout=120,
        default_model="o4-mini",
        temperature=0.7,
        max_tokens=4096,
        top_p=1.0,
        provider_label="Codex",
    )

    assert await provider.list_models() == [
        "gpt-5.4",
        "gpt-5.4-mini",
        "gpt-5-codex",
        "gpt-5.3-codex",
        "gpt-5.2-codex",
        "gpt-5.1-codex",
        "gpt-5.1-codex-max",
        "gpt-5.1-codex-mini",
        "codex-mini-latest",
        "o3-mini",
        "o4-mini",
        "gpt-4.1",
    ]


@pytest.mark.anyio
async def test_cli_provider_health_check_falls_back_when_async_subprocess_is_unavailable(
    monkeypatch,
):
    provider = CLIProvider(
        cli_command=r"C:\Users\operator\AppData\Roaming\npm\codex.CMD",
        cli_args_template="--quiet --model {model} {prompt}",
        parse_mode="markdown",
        supports_streaming=False,
        timeout=120,
        default_model="gpt-5.4",
        temperature=0.7,
        max_tokens=4096,
        top_p=1.0,
        provider_label="Codex",
    )

    async def fake_exec(*args, **kwargs):
        raise NotImplementedError()

    def fake_run(*args, **kwargs):
        return subprocess.CompletedProcess(
            args=args[0],
            returncode=0,
            stdout=b"codex-cli 0.114.0\n",
            stderr=b"",
        )

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)
    monkeypatch.setattr(subprocess, "run", fake_run)
    monkeypatch.setattr(os.path, "exists", lambda path: path == provider.cli_command)

    result = await provider.test_connection()

    assert result.status == "ok"
    assert result.error_detail is None


@pytest.mark.anyio
async def test_cli_provider_chat_falls_back_when_async_subprocess_is_unavailable(
    monkeypatch,
):
    provider = CLIProvider(
        cli_command=r"C:\Users\operator\AppData\Roaming\npm\codex.CMD",
        cli_args_template="--quiet --model {model} {prompt}",
        parse_mode="markdown",
        supports_streaming=False,
        timeout=120,
        default_model="gpt-5.4",
        temperature=0.7,
        max_tokens=4096,
        top_p=1.0,
        provider_label="Codex",
    )

    async def fake_exec(*args, **kwargs):
        raise NotImplementedError()

    def fake_run(*args, **kwargs):
        return subprocess.CompletedProcess(
            args=args[0],
            returncode=0,
            stdout=b"Buffered Codex output",
            stderr=b"",
        )

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)
    monkeypatch.setattr(subprocess, "run", fake_run)

    chunks = [
        chunk
        async for chunk in provider.chat_stream(
            messages=[{"role": "user", "content": "hello"}]
        )
    ]

    assert [chunk.content for chunk in chunks] == ["Buffered Codex output", ""]
    assert chunks[-1].done is True


@pytest.mark.anyio
async def test_cli_provider_runs_noninteractive_codex_from_temp_directory_when_workspace_is_unset(
    monkeypatch,
):
    provider = CLIProvider(
        cli_command=r"C:\Users\operator\AppData\Roaming\npm\codex.CMD",
        cli_args_template="exec --skip-git-repo-check --json --model {model} {prompt}",
        parse_mode="json",
        supports_streaming=True,
        timeout=120,
        default_model="gpt-5.4",
        temperature=0.7,
        max_tokens=4096,
        top_p=1.0,
        provider_label="Codex",
    )

    captured: dict[str, object] = {}

    async def fake_exec(*args, **kwargs):
        captured["cwd"] = kwargs.get("cwd")
        captured["args"] = args
        return _FakeStreamingProcess(
            [
                b'{"type":"item.completed","item":{"type":"agent_message","text":"CODEX OK"}}\n',
                b'{"type":"result","result":"CODEX OK"}\n',
            ]
        )

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)

    chunks = [
        chunk
        async for chunk in provider.chat_stream(
            messages=[{"role": "user", "content": "Reply with exactly: CODEX OK"}]
        )
    ]

    invocation = " ".join(str(part) for part in captured["args"])
    assert captured["cwd"] in {None, tempfile.gettempdir()}
    if captured["cwd"] is None:
        assert tempfile.gettempdir() in invocation
    else:
        assert captured["cwd"] == tempfile.gettempdir()
    assert [chunk.content for chunk in chunks] == ["CODEX OK", ""]


@pytest.mark.anyio
async def test_cli_provider_wraps_windows_codex_exec_in_powershell(
    monkeypatch,
):
    if os.name != "nt":
        pytest.skip("Windows-specific Codex wrapper test")

    provider = CLIProvider(
        cli_command=r"C:\Users\operator\AppData\Roaming\npm\codex.CMD",
        cli_args_template="exec --skip-git-repo-check --json --model {model} {prompt}",
        parse_mode="json",
        supports_streaming=True,
        timeout=120,
        default_model="gpt-5.4",
        temperature=0.7,
        max_tokens=4096,
        top_p=1.0,
        provider_label="Codex",
    )

    captured: dict[str, object] = {}

    async def fake_exec(*args, **kwargs):
        captured["args"] = args
        return _FakeStreamingProcess(
            [
                b'{"type":"item.completed","item":{"type":"agent_message","text":"CODEX OK"}}\n',
                b'{"type":"result","result":"CODEX OK"}\n',
            ]
        )

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)

    chunks = [
        chunk
        async for chunk in provider.chat_stream(
            messages=[{"role": "user", "content": "Reply with exactly: CODEX OK"}]
        )
    ]

    args = captured["args"]
    assert isinstance(args, tuple)
    assert str(args[0]).lower().endswith("pwsh.exe")
    assert any("codex.CMD" in str(arg) for arg in args)
    assert [chunk.content for chunk in chunks] == ["CODEX OK", ""]


@pytest.mark.anyio
async def test_cli_provider_pipes_multiline_codex_prompt_via_powershell_stdin(
    monkeypatch,
):
    if os.name != "nt":
        pytest.skip("Windows-specific Codex wrapper test")

    provider = CLIProvider(
        cli_command=r"C:\Users\operator\AppData\Roaming\npm\codex.CMD",
        cli_args_template="exec --skip-git-repo-check --json --model {model} {prompt}",
        parse_mode="json",
        supports_streaming=True,
        timeout=120,
        default_model="gpt-5.4",
        temperature=0.7,
        max_tokens=4096,
        top_p=1.0,
        provider_label="Codex",
    )

    captured: dict[str, object] = {}

    async def fake_exec(*args, **kwargs):
        captured["args"] = args
        return _FakeStreamingProcess(
            [
                b'{"type":"item.completed","item":{"type":"agent_message","text":"CODEX OK"}}\n',
                b'{"type":"result","result":"CODEX OK"}\n',
            ]
        )

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)

    chunks = [
        chunk
        async for chunk in provider.chat_stream(
            messages=[{"role": "user", "content": "Reply with exactly: CODEX OK"}]
        )
    ]

    args = captured["args"]
    assert isinstance(args, tuple)
    assert str(args[0]).lower().endswith("pwsh.exe")
    assert "@'" in str(args[-1])
    assert " '-'" in str(args[-1])
    assert [chunk.content for chunk in chunks] == ["CODEX OK", ""]


@pytest.mark.anyio
async def test_cli_provider_sync_streaming_fallback_surfaces_json_error_message(
    monkeypatch,
):
    provider = CLIProvider(
        cli_command=r"C:\Users\operator\AppData\Roaming\npm\codex.CMD",
        cli_args_template="exec --skip-git-repo-check --json --model {model} {prompt}",
        cli_interactive_args="--model {model}",
        parse_mode="json",
        supports_streaming=True,
        timeout=120,
        default_model="gpt-5.4",
        temperature=0.7,
        max_tokens=4096,
        top_p=1.0,
        provider_label="Codex",
    )

    async def fake_exec(*args, **kwargs):
        raise NotImplementedError()

    def fake_run(*args, **kwargs):
        return subprocess.CompletedProcess(
            args=args[0],
            returncode=1,
            stdout=(
                b'{"type":"thread.started","thread_id":"t-1"}\n'
                b'{"type":"error","message":"Usage limit reached"}\n'
            ),
            stderr=b"warning from stderr\n",
        )

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)
    monkeypatch.setattr(subprocess, "run", fake_run)

    collected: list[str] = []
    with pytest.raises(RuntimeError, match="Usage limit reached"):
        async for chunk in provider.chat_stream(
            messages=[{"role": "user", "content": "hello"}]
        ):
            collected.append(chunk.content)

    assert collected == ["Usage limit reached"]
