"""CLI-backed LLM provider implementation."""

from __future__ import annotations

import asyncio
import json
import os
import re
import shlex
import shutil
import subprocess
import tempfile
import time
from collections.abc import AsyncGenerator

from app.services.cli_detector import get_known_cli_models
from app.services.llm.base import LLMProvider
from app.services.llm.types import HealthResult, StreamChunk

ANSI_ESCAPE_RE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")


class CLIProvider(LLMProvider):
    """Provider that runs a local AI CLI in non-interactive mode."""

    def __init__(
        self,
        *,
        cli_command: str,
        cli_args_template: str | None = None,
        cli_interactive_args: str | None = None,
        cli_env: dict[str, str] | None = None,
        working_directory: str | None = None,
        parse_mode: str = "raw",
        supports_streaming: bool = False,
        supports_resume: bool = False,
        session_flag: str | None = None,
        detected_version: str | None = None,
        detected_models: list[str] | None = None,
        timeout: int,
        default_model: str,
        temperature: float,
        max_tokens: int,
        top_p: float,
        custom_headers: dict | None = None,
        provider_label: str | None = None,
    ):
        super().__init__(
            module_name="llm.cli",
            base_url=None,
            api_key=None,
            timeout=timeout,
            default_model=default_model,
            temperature=temperature,
            max_tokens=max_tokens,
            top_p=top_p,
            custom_headers=custom_headers,
        )
        self.cli_command = cli_command
        self.cli_args_template = cli_args_template or "{prompt}"
        self.cli_interactive_args = cli_interactive_args
        self.cli_env = cli_env or {}
        self.working_directory = working_directory
        self.parse_mode = parse_mode
        self.supports_streaming = supports_streaming
        self.supports_resume = supports_resume
        self.session_flag = session_flag
        self.detected_version = detected_version
        self.detected_models = detected_models or []
        self.provider_name = provider_label or "CLI Provider"

    def get_source_mode(self) -> str:
        return "cli_orchestrated"

    async def test_connection(self) -> HealthResult:
        start = time.monotonic()
        command_tokens = self._split_template(self.cli_command)
        executable = command_tokens[0] if command_tokens else self.cli_command

        if shutil.which(executable) is None and not os.path.exists(executable):
            latency = int((time.monotonic() - start) * 1000)
            return HealthResult(
                status="error",
                latency_ms=latency,
                error_code="AI_PROVIDER_UNREACHABLE",
                error_detail=f"CLI not found: {self.cli_command}",
            )

        try:
            stdout, stderr, returncode = await self._run_command(
                [*command_tokens, "--version"]
            )
            latency = int((time.monotonic() - start) * 1000)
            if returncode == 0:
                return HealthResult(status="ok", latency_ms=latency)
            return HealthResult(
                status="error",
                latency_ms=latency,
                error_code="AI_PROVIDER_ERROR",
                error_detail=self._decode(stderr or stdout) or "CLI returned a non-zero exit code",
            )
        except FileNotFoundError:
            latency = int((time.monotonic() - start) * 1000)
            return HealthResult(
                status="error",
                latency_ms=latency,
                error_code="AI_PROVIDER_UNREACHABLE",
                error_detail=f"CLI not found: {self.cli_command}",
            )
        except Exception as exc:
            latency = int((time.monotonic() - start) * 1000)
            return HealthResult(
                status="error",
                latency_ms=latency,
                error_code="AI_PROVIDER_ERROR",
                error_detail=str(exc),
            )

    async def list_models(self) -> list[str]:
        models = get_known_cli_models(
            self.cli_command,
            self.detected_models,
            self.default_model,
        )
        if models:
            return models
        return [self.default_model]

    async def chat_stream(
        self,
        messages: list[dict],
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> AsyncGenerator[StreamChunk, None]:
        del temperature, max_tokens

        prompt = self._format_conversation(messages)
        resolved_model = self._get_model(model)
        command = self._build_command(prompt, resolved_model)
        command_preview = shlex.join(command)
        started_at = time.monotonic()

        metadata: dict[str, object] = {
            "source_mode": self.get_source_mode(),
            "cli_command": command_preview,
        }

        if self.supports_streaming and self.parse_mode == "json":
            process_command, process_cwd = self._build_process_invocation(command)
            try:
                process = await asyncio.create_subprocess_exec(
                    *process_command,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    cwd=process_cwd,
                    env=self._build_env(),
                )
            except NotImplementedError:
                stdout, stderr, returncode = await self._run_command_sync(command)
                parsed = self._parse_streaming_output(stdout)
                metadata.update(
                    {
                        "cli_exit_code": returncode,
                        "cli_duration_ms": int((time.monotonic() - started_at) * 1000),
                    }
                )
                if parsed["session_id"]:
                    metadata["cli_session_id"] = parsed["session_id"]

                if parsed["content"]:
                    yield StreamChunk(content=parsed["content"], done=False)

                if returncode != 0:
                    stderr_text = self._strip_ansi(self._decode(stderr))
                    raise RuntimeError(parsed["content"] or stderr_text or "CLI process failed")
                yield StreamChunk(content="", done=True, metadata=metadata)
                return

            accumulated_content = ""
            session_id: str | None = None
            process_deadline = time.monotonic() + float(self.timeout)
            assert process.stdout is not None
            async for line in self._iter_process_stdout(
                process.stdout,
                process,
                process_command,
                deadline=process_deadline,
            ):
                raw_line = self._decode(line).strip()
                if not raw_line:
                    continue
                try:
                    payload = json.loads(raw_line)
                except json.JSONDecodeError:
                    yield StreamChunk(content=self._strip_ansi(raw_line), done=False)
                    accumulated_content += self._strip_ansi(raw_line)
                    continue

                session_id = payload.get("session_id") or session_id
                chunk_text = self._extract_text_from_json(payload)
                payload_type = str(payload.get("type") or "").lower()

                if chunk_text and payload_type != "result":
                    accumulated_content += chunk_text
                    yield StreamChunk(content=chunk_text, done=False)

                if payload_type == "result":
                    final_text = chunk_text or accumulated_content
                    metadata.update(
                        {
                            "cli_exit_code": process.returncode,
                            "cli_duration_ms": int((time.monotonic() - started_at) * 1000),
                            "cli_session_id": session_id,
                        }
                    )
                    if final_text and final_text != accumulated_content:
                        yield StreamChunk(content=final_text, done=False)
                    await self._wait_for_process_exit(
                        process,
                        process_command,
                        deadline=process_deadline,
                    )
                    metadata["cli_exit_code"] = process.returncode
                    yield StreamChunk(content="", done=True, metadata=metadata)
                    return

            await self._wait_for_process_exit(
                process,
                process_command,
                deadline=process_deadline,
            )
            metadata.update(
                {
                    "cli_exit_code": process.returncode,
                    "cli_duration_ms": int((time.monotonic() - started_at) * 1000),
                    "cli_session_id": session_id,
                }
            )
            if process.returncode != 0:
                stderr_text = ""
                if process.stderr is not None:
                    stderr_text = self._decode(await process.stderr.read())
                raise RuntimeError(accumulated_content or stderr_text or "CLI process failed")
            yield StreamChunk(content="", done=True, metadata=metadata)
            return

        stdout, stderr, returncode = await self._run_command(command)
        metadata.update(
            {
                "cli_exit_code": returncode,
                "cli_duration_ms": int((time.monotonic() - started_at) * 1000),
            }
        )
        if returncode != 0:
            stderr_text = self._strip_ansi(self._decode(stderr))
            raise RuntimeError(stderr_text or "CLI process failed")

        parsed = self._parse_output(stdout)
        if parsed["session_id"]:
            metadata["cli_session_id"] = parsed["session_id"]

        if parsed["content"]:
            yield StreamChunk(content=parsed["content"], done=False)
        yield StreamChunk(content="", done=True, metadata=metadata)

    def count_tokens(self, text: str, model: str | None = None) -> int:
        del model
        if not text:
            return 0
        return max(1, len(text) // 4)

    def _build_command(self, prompt: str, model: str) -> list[str]:
        mapping = {
            "prompt": prompt,
            "model": model,
            "session_id": "",
        }
        command_tokens = self._split_template(self.cli_command)
        arg_tokens = self._split_template(self.cli_args_template)
        return [
            *self._replace_placeholders(command_tokens, mapping),
            *self._replace_placeholders(arg_tokens, mapping),
        ]

    def _replace_placeholders(
        self,
        tokens: list[str],
        mapping: dict[str, str],
    ) -> list[str]:
        replaced: list[str] = []
        for token in tokens:
            for key, value in mapping.items():
                token = token.replace(f"{{{key}}}", value)
            replaced.append(token)
        return replaced

    @staticmethod
    def _split_template(template: str | None) -> list[str]:
        if not template:
            return []
        stripped = template.strip()
        if not stripped:
            return []

        if "\\" in stripped and (":" in stripped or stripped.startswith(".\\") or stripped.startswith("..\\")):
            return [
                token[1:-1]
                if len(token) >= 2 and token[0] == token[-1] and token[0] in {'"', "'"}
                else token
                for token in shlex.split(stripped, posix=False)
            ]

        return shlex.split(stripped, posix=True)

    def _build_env(self) -> dict[str, str]:
        env = os.environ.copy()
        env.update(self.cli_env)
        return env

    def _build_process_invocation(
        self,
        command: list[str],
    ) -> tuple[list[str], str | None]:
        cwd = self._resolve_working_directory()
        if self._should_wrap_with_powershell():
            return self._wrap_command_for_powershell(command, cwd), None
        return command, cwd

    async def _run_command(self, command: list[str]) -> tuple[bytes, bytes, int]:
        process_command, process_cwd = self._build_process_invocation(command)
        try:
            process = await asyncio.create_subprocess_exec(
                *process_command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=process_cwd,
                env=self._build_env(),
            )
            stdout, stderr = await self._wait_for_process_communication(
                process,
                process_command,
            )
            return stdout, stderr, process.returncode
        except NotImplementedError:
            return await self._run_command_sync(command)

    async def _run_command_sync(self, command: list[str]) -> tuple[bytes, bytes, int]:
        process_command, process_cwd = self._build_process_invocation(command)
        completed = await asyncio.to_thread(
            subprocess.run,
            process_command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=process_cwd,
            env=self._build_env(),
            check=False,
            timeout=self.timeout,
        )
        return completed.stdout or b"", completed.stderr or b"", completed.returncode

    def _resolve_working_directory(self) -> str | None:
        if self.working_directory:
            return self.working_directory
        if self._is_codex_cli():
            return tempfile.gettempdir()
        return None

    def _should_wrap_with_powershell(self) -> bool:
        return os.name == "nt" and self._is_codex_cli()

    def _wrap_command_for_powershell(
        self,
        command: list[str],
        cwd: str | None,
    ) -> list[str]:
        wrapped_command = list(command)
        prompt = wrapped_command.pop() if wrapped_command else ""
        if cwd and not any(token in {"--cd", "-C"} for token in wrapped_command):
            if len(wrapped_command) >= 2 and wrapped_command[1] == "exec":
                wrapped_command = [
                    *wrapped_command[:2],
                    "--cd",
                    cwd,
                    *wrapped_command[2:],
                ]
            else:
                wrapped_command = [*wrapped_command, "--cd", cwd]

        shell = (
            shutil.which("pwsh.exe")
            or shutil.which("pwsh")
            or shutil.which("powershell.exe")
            or shutil.which("powershell")
            or "pwsh.exe"
        )
        wrapped_command.append("-")
        command_text = " ".join(self._quote_powershell(token) for token in wrapped_command[1:])
        prompt_block = prompt.replace("\r\n", "\n").replace("\r", "\n")
        return [
            shell,
            "-NoLogo",
            "-NoProfile",
            "-Command",
            (
                "@'\n"
                f"{prompt_block}\n"
                "'@ | "
                f"& {self._quote_powershell(wrapped_command[0])} {command_text}"
            ).strip(),
        ]

    @staticmethod
    def _quote_powershell(value: str) -> str:
        return "'" + value.replace("'", "''") + "'"

    def _is_codex_cli(self) -> bool:
        command_tokens = self._split_template(self.cli_command)
        executable = command_tokens[0] if command_tokens else self.cli_command
        executable_name = os.path.basename(executable).lower()
        provider_name = (self.provider_name or "").lower()
        return executable_name.startswith("codex") or "codex" in provider_name

    @staticmethod
    def _format_conversation(messages: list[dict]) -> str:
        blocks: list[str] = []
        for message in messages:
            role = str(message.get("role", "user")).upper()
            content = str(message.get("content", ""))
            blocks.append(f"{role}:\n{content}")
        return "\n\n".join(blocks)

    def _parse_output(self, stdout: bytes) -> dict[str, str | None]:
        text = self._strip_ansi(self._decode(stdout)).strip()
        if self.parse_mode == "json":
            payload = json.loads(text)
            return {
                "content": self._extract_text_from_json(payload) or text,
                "session_id": payload.get("session_id"),
            }

        if self.parse_mode in {"markdown", "raw"}:
            return {"content": text, "session_id": None}

        return {"content": text, "session_id": None}

    def _parse_streaming_output(self, stdout: bytes) -> dict[str, str | None]:
        session_id: str | None = None
        accumulated_content = ""
        final_content = ""

        for raw_line in self._decode(stdout).splitlines():
            line = self._strip_ansi(raw_line).strip()
            if not line:
                continue

            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                accumulated_content += line
                continue

            session_id = payload.get("session_id") or session_id
            chunk_text = self._extract_text_from_json(payload)
            payload_type = str(payload.get("type") or "").lower()

            if chunk_text and payload_type != "result":
                accumulated_content += chunk_text

            if payload_type == "result":
                final_content = chunk_text or accumulated_content

        return {
            "content": final_content or accumulated_content,
            "session_id": session_id,
        }

    @staticmethod
    def _extract_text_from_json(payload: dict) -> str:
        item = payload.get("item")
        if isinstance(item, dict):
            item_type = item.get("type")
            if item_type == "agent_message":
                text = item.get("text")
                if isinstance(text, str):
                    return text

        candidates = [
            payload.get("result"),
            payload.get("content"),
            payload.get("message"),
            payload.get("text"),
            payload.get("output_text"),
            payload.get("delta"),
            payload.get("error"),
        ]
        for candidate in candidates:
            if isinstance(candidate, str):
                return candidate
            if isinstance(candidate, dict):
                text = candidate.get("text")
                if isinstance(text, str):
                    return text
        return ""

    @staticmethod
    def _decode(value: bytes) -> str:
        return value.decode("utf-8", errors="replace")

    @staticmethod
    def _strip_ansi(text: str) -> str:
        return ANSI_ESCAPE_RE.sub("", text)

    async def _iter_process_stdout(
        self,
        stdout: AsyncGenerator[bytes, None],
        process: asyncio.subprocess.Process,
        process_command: list[str],
        deadline: float | None = None,
    ) -> AsyncGenerator[bytes, None]:
        while True:
            try:
                line = await asyncio.wait_for(
                    anext(stdout),
                    timeout=await self._remaining_process_timeout(
                        process,
                        process_command,
                        deadline,
                    ),
                )
            except StopAsyncIteration:
                return
            except TimeoutError as exc:
                await self._terminate_process(process)
                raise subprocess.TimeoutExpired(process_command, self.timeout) from exc
            yield line

    async def _wait_for_process_communication(
        self,
        process: asyncio.subprocess.Process,
        process_command: list[str],
    ) -> tuple[bytes, bytes]:
        try:
            return await asyncio.wait_for(process.communicate(), timeout=self.timeout)
        except TimeoutError as exc:
            await self._terminate_process(process)
            raise subprocess.TimeoutExpired(process_command, self.timeout) from exc

    async def _wait_for_process_exit(
        self,
        process: asyncio.subprocess.Process,
        process_command: list[str],
        deadline: float | None = None,
    ) -> int:
        try:
            return await asyncio.wait_for(
                process.wait(),
                timeout=await self._remaining_process_timeout(
                    process,
                    process_command,
                    deadline,
                ),
            )
        except TimeoutError as exc:
            await self._terminate_process(process)
            raise subprocess.TimeoutExpired(process_command, self.timeout) from exc

    async def _remaining_process_timeout(
        self,
        process: asyncio.subprocess.Process,
        process_command: list[str],
        deadline: float | None,
    ) -> float:
        if deadline is None:
            return float(self.timeout)

        remaining = deadline - time.monotonic()
        if remaining > 0:
            return remaining

        await self._terminate_process(process)
        raise subprocess.TimeoutExpired(process_command, self.timeout)

    @staticmethod
    async def _terminate_process(process: asyncio.subprocess.Process) -> None:
        try:
            process.kill()
        except (AttributeError, ProcessLookupError):
            pass

        try:
            await asyncio.wait_for(process.wait(), timeout=1)
        except (TimeoutError, AttributeError, ProcessLookupError):
            pass
