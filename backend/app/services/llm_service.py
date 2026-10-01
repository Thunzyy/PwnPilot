"""LLM service — factory + context-based routing."""
from __future__ import annotations

import json
import os
from collections.abc import AsyncGenerator

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.core.crypto import decrypt_api_key, get_or_create_key
from app.models.ai import AIContextRouting, AIProviderConfig
from app.services.base import BaseService
from app.services.cli_detector import get_effective_cli_settings
from app.services.llm import (
    AnthropicProvider,
    CLIProvider,
    LLMProvider,
    OllamaProvider,
    OpenAICompatibleProvider,
    OpenAIProvider,
)
from app.services.llm.types import HealthResult, StreamChunk

_FAKE_REPORTING_PROVIDER_ENV = "PWNPILOT_FAKE_REPORTING_PROVIDER"


class _DeterministicReportingProvider(LLMProvider):
    def __init__(self):
        super().__init__(
            module_name="llm.fake_reporting",
            base_url=None,
            api_key=None,
            timeout=5,
            default_model="pwnpilot-reporting-test",
            temperature=0.0,
            max_tokens=2048,
            top_p=1.0,
            custom_headers=None,
        )
        self.provider_name = "Deterministic Reporting"

    async def test_connection(self) -> HealthResult:
        return HealthResult(status="ok", latency_ms=0)

    async def list_models(self) -> list[str]:
        return [self.default_model]

    async def chat_stream(
        self,
        messages: list[dict],
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> AsyncGenerator[StreamChunk, None]:
        del model, temperature, max_tokens
        payload = self._build_payload(messages)
        metadata = {
            "source_mode": "test_reporting",
            "provider": self.provider_name,
        }
        yield StreamChunk(content=json.dumps(payload), done=False, metadata=metadata)
        yield StreamChunk(content="", done=True, metadata=metadata)

    def count_tokens(self, text: str, model: str | None = None) -> int:
        del model
        return max(1, len(text.split()))

    def _build_payload(self, messages: list[dict]) -> dict:
        system_prompt = next(
            (str(message.get("content", "")) for message in messages if message.get("role") == "system"),
            "",
        )
        user_prompt = next(
            (str(message.get("content", "")) for message in messages if message.get("role") == "user"),
            "{}",
        )
        data = json.loads(user_prompt)
        if "evaluate whether new offensive security evidence" in system_prompt.lower():
            return self._build_judge_payload(data)
        return self._build_writer_payload(data)

    def _build_judge_payload(self, delta_pack: dict) -> dict:
        sections = self._determine_sections(delta_pack)
        if not sections:
            return {
                "decision": "no_update",
                "summary": "No material reporting update detected.",
                "sections": [],
            }
        return {
            "decision": "update",
            "summary": f"Update sections: {', '.join(sections)}",
            "sections": sections,
        }

    def _build_writer_payload(self, payload: dict) -> dict:
        delta_pack = payload.get("delta_pack", {})
        judge_result = payload.get("judge_result", {})
        section_keys = self._normalize_section_keys(
            delta_pack.get("target_section_keys") or judge_result.get("sections")
        ) or self._determine_sections(delta_pack)
        sections = [
            self._build_section(section_key, delta_pack)
            for section_key in section_keys
        ]
        sections = [section for section in sections if section is not None]
        return {
            "summary": f"Drafted {len(sections)} report update(s)",
            "sections": sections,
        }

    def _build_section(self, section_key: str, delta_pack: dict) -> dict | None:
        title = section_key.replace("_", " ").title()
        if section_key == "overview":
            return self._build_overview_section(delta_pack)
        if section_key == "attack_path":
            return self._build_attack_path_section(delta_pack)

        if section_key in {"recon", "enumeration"}:
            nmap_command = self._find_command(
                delta_pack,
                "nmap",
                "ftp",
                "http",
            )
            capture_listing = self._find_command(
                delta_pack,
                "/data/",
                "/capture/",
            )
            capture_download = self._find_command(
                delta_pack,
                "0.pcap",
                "download/0",
            )
            tshark_command = self._find_command(
                delta_pack,
                "tshark",
                "ftp.request.command",
            )
            service_summary = self._format_service_summary(delta_pack)
            lines = [
                f"`{nmap_command['command']}` identified {service_summary}."
                if nmap_command and service_summary
                else None,
                (
                    "The web interface exposed capture data under "
                    f"`{self._command_detail(capture_listing, '/capture/ and /data/0')}`, and "
                    f"`{capture_download['command']}` saved `0.pcap` for offline review."
                )
                if capture_listing and capture_download
                else (
                    f"`{capture_download['command']}` saved `0.pcap` for offline review."
                    if capture_download
                    else None
                ),
                (
                    f"`{tshark_command['command']}` recovered the FTP exchange, including `USER nathan` and the matching password."
                )
                if tshark_command
                else None,
            ]
            evidence = self._collect_evidence(
                nmap_command,
                capture_listing,
                capture_download,
                tshark_command,
                *self._service_nodes(delta_pack),
            )
            content_md = self._join_markdown_paragraphs(lines) or (
                f"{title} update: new enumeration evidence captured."
            )
            return {
                "section_key": section_key,
                "content_md": content_md,
                "summary": f"Refresh {title.lower()}",
                "evidence": evidence,
            }

        if section_key in {"initial_access", "foothold"}:
            credential = next(iter(delta_pack.get("credentials", [])), None)
            username = self._inferred_username(delta_pack)
            tshark_command = self._find_command_all(
                delta_pack,
                "tshark",
                "USER",
                "PASS",
            )
            ssh_validation = self._find_command(
                delta_pack,
                "uid=1001(",
                "sshpass",
                "spawn ssh",
            )
            user_flag_command = self._find_command(
                delta_pack,
                "/home/",
                "user.txt",
            )
            credential_signal = credential or self._find_graph_node(delta_pack, "Credential:")
            if credential_signal is None and tshark_command is None and ssh_validation is None and user_flag_command is None:
                return None
            username = username or "the recovered account"
            lines = [
                (
                    f"Reviewing the packet capture exposed an FTP credential for `{username}`, which was immediately reusable over SSH."
                )
                if credential_signal is not None or tshark_command is not None
                else None,
                (
                    f"`{ssh_validation['command']}` confirmed interactive access as `{username}`."
                )
                if ssh_validation is not None
                else None,
                (
                    f"Reading `/home/{username}/user.txt` validated the foothold and recovered the user flag."
                )
                if user_flag_command is not None
                else None,
            ]
            content_md = self._join_markdown_paragraphs(lines) or (
                f"{title} update: obtained credential for `{username}`."
            )
            return {
                "section_key": section_key,
                "content_md": content_md,
                "summary": f"Refresh {title.lower()}",
                "evidence": self._collect_evidence(
                    credential_signal,
                    tshark_command,
                    ssh_validation,
                    user_flag_command,
                    self._find_graph_node(delta_pack, "SSH session:"),
                ),
            }

        if section_key == "privilege_escalation":
            getcap_command = self._find_command_all(
                delta_pack,
                "getcap",
                "cap_setuid",
            )
            root_shell_command = self._find_command_all(
                delta_pack,
                "os.setuid(0)",
            ) or self._find_command_all(
                delta_pack,
                "uid=0(root)",
                "python3.8",
            )
            root_flag_command = self._find_command(
                delta_pack,
                "/root/root.txt",
                "391aad4e9ee903704a5c0208a52afdd7",
            )
            privesc_node = self._find_graph_node(delta_pack, "python3.8 cap_setuid")
            detail = getcap_command["command"] if getcap_command is not None else "local privesc evidence"
            content_md = self._join_markdown_paragraphs(
                [
                    (
                        f"`{getcap_command['command']}` showed `/usr/bin/python3.8 cap_setuid=ep`, giving the interpreter the ability to switch its effective uid to root."
                    )
                    if getcap_command is not None
                    else None,
                    (
                        f"Abusing `{root_shell_command['command']}` produced `uid=0(root)` and confirmed the path from `nathan` to full root execution."
                    )
                    if root_shell_command is not None
                    else None,
                    (
                        "With that root context, reading `/root/root.txt` completed the escalation."
                    )
                    if root_flag_command is not None
                    else None,
                ]
            ) or f"{title} update: validated escalation path from `{detail}`."
            return {
                "section_key": section_key,
                "content_md": content_md,
                "summary": "Refresh privilege escalation",
                "evidence": self._collect_evidence(
                    getcap_command,
                    root_shell_command,
                    root_flag_command,
                    privesc_node,
                ),
            }

        if section_key in {"loot_evidence", "flags_evidence"}:
            flags = list(delta_pack.get("flags", []))
            user_flag = next((flag for flag in flags if flag.get("type") == "user"), None)
            root_flag = next((flag for flag in flags if flag.get("type") == "root"), None)
            user_flag_value = (
                str(user_flag["value"])
                if user_flag is not None and user_flag.get("value")
                else self._find_flag_value_from_commands(delta_pack, "user")
            )
            root_flag_value = (
                str(root_flag["value"])
                if root_flag is not None and root_flag.get("value")
                else self._find_flag_value_from_commands(delta_pack, "root")
            )
            user_flag_command = self._find_command(
                delta_pack,
                "/home/",
                "user.txt",
                user_flag_value or "",
            )
            root_flag_command = self._find_command(
                delta_pack,
                "/root/root.txt",
                root_flag_value or "",
            )
            user_loot_node = self._find_graph_node(delta_pack, "user.txt")
            root_loot_node = self._find_graph_node(delta_pack, "root.txt")
            if not any([flags, user_flag_value, root_flag_value, user_loot_node, root_loot_node]):
                return None
            credential = next(iter(delta_pack.get("credentials", [])), None) or self._find_graph_node(delta_pack, "Credential:")
            username = self._inferred_username(delta_pack)
            privesc_node = self._find_graph_node(delta_pack, "python3.8 cap_setuid")
            bullet_lines = [
                f"- `user.txt`: `{user_flag_value}`" if user_flag_value else None,
                f"- `root.txt`: `{root_flag_value}`" if root_flag_value else None,
                (
                    f"- Low-privileged access: credential for `{username}` reused over SSH"
                )
                if username
                else None,
                "- Privilege escalation pivot: `python3.8 cap_setuid`"
                if privesc_node is not None
                else None,
            ]
            content_md = self._join_markdown_paragraphs(
                [
                    "Recovered artifacts from the final attack path:",
                    "\n".join(line for line in bullet_lines if line),
                ]
            )
            return {
                "section_key": section_key,
                "content_md": content_md or f"{title} update: captured reporting artifacts.",
                "summary": f"Refresh {title.lower()}",
                "evidence": self._collect_evidence(
                    user_flag,
                    root_flag,
                    user_flag_command,
                    root_flag_command,
                    user_loot_node,
                    root_loot_node,
                    credential,
                    privesc_node,
                ),
            }

        if section_key == "command_timeline":
            return self._build_command_timeline_section(delta_pack)

        return None

    def _build_overview_section(self, delta_pack: dict) -> dict | None:
        host_label = self._host_label(delta_pack)
        service_summary = self._format_service_summary(delta_pack)
        credential = next(iter(delta_pack.get("credentials", [])), None)
        username = self._inferred_username(delta_pack)
        capture_command = self._find_command(
            delta_pack,
            "/data/",
            "0.pcap",
            "/capture/",
        )
        getcap_command = self._find_command(
            delta_pack,
            "getcap",
            "cap_setuid",
        )
        if not any([host_label, service_summary, username, capture_command, getcap_command]):
            return None

        lines = [
            (
                f"`{host_label}` exposed {service_summary}. "
                f"The HTTP dashboard leaked packet captures that could be pulled from `{self._command_detail(capture_command, '/data/0')}` and reviewed offline."
            )
            if host_label and service_summary and capture_command
            else (
                f"`{host_label}` exposed {service_summary}."
                if host_label and service_summary
                else None
            ),
            (
                f"Parsing the captured FTP traffic disclosed a credential for `{username}`, which reused cleanly over SSH and established the initial shell."
            )
            if username
            else None,
            (
                f"Post-exploitation then pivoted through `{getcap_command['command']}`, exposing `python3.8 cap_setuid` and turning the foothold into root access."
            )
            if getcap_command is not None
            else None,
        ]
        return {
            "section_key": "overview",
            "content_md": self._join_markdown_paragraphs(lines),
            "summary": "Refresh overview",
            "evidence": self._collect_evidence(
                credential,
                capture_command,
                getcap_command,
                self._find_graph_node(delta_pack, host_label) if host_label else None,
                *self._service_nodes(delta_pack),
            ),
        }

    def _build_attack_path_section(self, delta_pack: dict) -> dict | None:
        host_label = self._host_label(delta_pack) or "the target host"
        service_summary = self._format_service_summary(delta_pack)
        credential_label = self._graph_label(delta_pack, "Credential:")
        session_label = self._graph_label(delta_pack, "SSH session:")
        privesc_label = self._graph_label(delta_pack, "python3.8 cap_setuid")
        root_session_label = self._graph_label(delta_pack, "Root session:")
        root_loot_label = self._graph_label(delta_pack, "root.txt")
        capture_command = self._find_command(
            delta_pack,
            "download/0",
            "0.pcap",
        )

        steps = [
            (
                f"1. Recon on `{host_label}` established the exposed surface: {service_summary}."
                if service_summary
                else f"1. Recon on `{host_label}` established the initial attack surface."
            ),
            (
                f"2. The HTTP dashboard yielded packet capture data, and `{capture_command['command']}` pulled `0.pcap` for offline review."
                if capture_command is not None
                else None
            ),
            (
                f"3. Parsing the capture disclosed `{credential_label}`, which was reused to open `{session_label}`."
                if credential_label and session_label
                else (
                    f"3. Parsing the capture disclosed `{credential_label}`."
                    if credential_label
                    else None
                )
            ),
            (
                f"4. Local enumeration identified `{privesc_label}`, which escalated the foothold into `{root_session_label}`."
                if privesc_label and root_session_label
                else (
                    f"4. Local enumeration identified `{privesc_label}` and enabled privilege escalation."
                    if privesc_label
                    else None
                )
            ),
            (
                f"5. Final proof of compromise came from reading `{root_loot_label}`."
                if root_loot_label
                else None
            ),
        ]
        content_md = self._join_markdown_paragraphs(["\n".join(step for step in steps if step)])
        if not content_md:
            return None
        return {
            "section_key": "attack_path",
            "content_md": content_md,
            "summary": "Refresh attack path",
            "evidence": self._collect_evidence(
                self._find_graph_node(delta_pack, host_label) if host_label else None,
                *self._service_nodes(delta_pack),
                self._find_graph_node(delta_pack, "Credential:"),
                self._find_graph_node(delta_pack, "SSH session:"),
                self._find_graph_node(delta_pack, "python3.8 cap_setuid"),
                self._find_graph_node(delta_pack, "Root session:"),
                self._find_graph_node(delta_pack, "root.txt"),
                capture_command,
            ),
        }

    def _build_command_timeline_section(self, delta_pack: dict) -> dict | None:
        timeline_entries: list[tuple[dict | None, str | None]] = [
            (
                self._find_command_all(delta_pack, "nmap", "http"),
                "Enumerated the exposed FTP, SSH, and HTTP services.",
            ),
            (
                self._find_command(delta_pack, "download/0", "0.pcap"),
                "Downloaded the packet capture exposed by the web interface.",
            ),
            (
                self._find_command_all(delta_pack, "tshark", "USER", "PASS"),
                "Extracted the FTP username and password from the capture.",
            ),
            (
                self._find_command_all(delta_pack, "id", "uid=1001("),
                "Validated the SSH foothold as the recovered user.",
            ),
            (
                self._find_command_all(delta_pack, "getcap", "python3.8"),
                "Confirmed the `cap_setuid` capability on Python.",
            ),
            (
                self._find_command_all(delta_pack, "os.setuid(0)", "/root/root.txt"),
                "Used the Python capability to read the root flag.",
            ),
        ]
        lines: list[str] = []
        evidence_items: list[dict | None] = []
        step_index = 1
        for command, summary in timeline_entries:
            if command is None:
                continue
            evidence_items.append(command)
            command_text = str(command.get("command", "")).strip()
            if not command_text:
                continue
            lines.append(f"{step_index}. `{command_text}`")
            if summary:
                lines.append(f"   - {summary}")
            output_snippet = self._command_timeline_snippet(command)
            if output_snippet:
                lines.append(f"   - Result: {output_snippet}")
            step_index += 1

        if not lines:
            return None
        return {
            "section_key": "command_timeline",
            "content_md": "\n".join(lines),
            "summary": "Refresh command timeline",
            "evidence": self._collect_evidence(*evidence_items),
        }

    def _determine_sections(self, delta_pack: dict) -> list[str]:
        target_sections = self._normalize_section_keys(delta_pack.get("target_section_keys"))
        if target_sections:
            return target_sections

        available = {
            str(section.get("key"))
            for section in delta_pack.get("report_sections", [])
            if section.get("key")
        }
        sections: list[str] = []
        if available and "overview" in available and any(
            delta_pack.get(key)
            for key in ("commands", "timeline", "credentials", "flags", "graph_nodes", "graph_edges")
        ):
            sections.append("overview")
        if "attack_path" in available and (
            delta_pack.get("graph_nodes")
            or delta_pack.get("graph_edges")
            or delta_pack.get("commands")
        ):
            sections.append("attack_path")
        if delta_pack.get("commands") or delta_pack.get("timeline") or delta_pack.get("graph_nodes") or delta_pack.get("graph_edges"):
            recon_key = "enumeration" if "enumeration" in available else "recon"
            if recon_key in available:
                sections.append(recon_key)
        if self._has_foothold_signal(delta_pack):
            access_key = "foothold" if "foothold" in available else "initial_access"
            if access_key in available:
                sections.append(access_key)
        if self._has_privilege_escalation_signal(delta_pack) and "privilege_escalation" in available:
            sections.append("privilege_escalation")
        if self._has_loot_signal(delta_pack):
            loot_key = "flags_evidence" if "flags_evidence" in available else "loot_evidence"
            if loot_key in available:
                sections.append(loot_key)
        if "command_timeline" in available and delta_pack.get("commands"):
            sections.append("command_timeline")
        if not sections:
            first_key = next(iter(available), None)
            if first_key:
                sections.append(first_key)
        return self._normalize_section_keys(sections) or []

    @staticmethod
    def _collect_evidence(*items: dict | None) -> list[dict[str, str]]:
        evidence: list[dict[str, str]] = []
        seen: set[tuple[str, str]] = set()
        for item in items:
            if not item:
                continue
            source_type = item.get("source_type")
            source_id = item.get("id")
            if not source_type or not source_id:
                continue
            key = (str(source_type), str(source_id))
            if key in seen:
                continue
            seen.add(key)
            evidence.append({"source_type": str(source_type), "source_id": str(source_id)})
        return evidence

    @staticmethod
    def _has_privilege_escalation_signal(delta_pack: dict) -> bool:
        if any(flag.get("type") == "root" for flag in delta_pack.get("flags", [])):
            return True
        for command in delta_pack.get("commands", []):
            haystack = f"{command.get('command', '')} {command.get('output', '')}".lower()
            if any(keyword in haystack for keyword in ("getcap", "cap_setuid", "sudo -l", "root.txt")):
                return True
        return False

    @staticmethod
    def _normalize_section_keys(section_keys: list[str] | None) -> list[str] | None:
        if not section_keys:
            return None
        normalized = sorted({key.strip() for key in section_keys if key and key.strip()})
        return normalized or None

    @staticmethod
    def _join_markdown_paragraphs(lines: list[str | None]) -> str:
        paragraphs = [line.strip() for line in lines if isinstance(line, str) and line.strip()]
        return "\n\n".join(paragraphs)

    @staticmethod
    def _command_haystack(command: dict | None) -> str:
        if not command:
            return ""
        return f"{command.get('command', '')} {command.get('output', '')}".lower()

    def _find_command(self, delta_pack: dict, *keywords: str) -> dict | None:
        lowered = tuple(keyword.lower() for keyword in keywords if keyword)
        for command in delta_pack.get("commands", []):
            haystack = self._command_haystack(command)
            if any(keyword in haystack for keyword in lowered):
                return command
        return None

    def _find_command_all(self, delta_pack: dict, *keywords: str) -> dict | None:
        lowered = tuple(keyword.lower() for keyword in keywords if keyword)
        for command in delta_pack.get("commands", []):
            haystack = self._command_haystack(command)
            if all(keyword in haystack for keyword in lowered):
                return command
        return None

    @staticmethod
    def _find_graph_node(delta_pack: dict, label_fragment: str) -> dict | None:
        if not label_fragment:
            return None
        needle = label_fragment.lower()
        for node in delta_pack.get("graph_nodes", []):
            if needle in str(node.get("label", "")).lower():
                return node
        return None

    @staticmethod
    def _service_nodes(delta_pack: dict) -> list[dict]:
        return [
            node
            for node in delta_pack.get("graph_nodes", [])
            if str(node.get("type", "")).lower() == "service"
        ]

    @staticmethod
    def _host_label(delta_pack: dict) -> str | None:
        for node in delta_pack.get("graph_nodes", []):
            if str(node.get("type", "")).lower() == "host" and node.get("label"):
                return str(node["label"])
        return None

    @classmethod
    def _format_service_summary(cls, delta_pack: dict) -> str | None:
        labels: list[str] = []
        for node in cls._service_nodes(delta_pack):
            label = str(node.get("label", "")).strip()
            if not label:
                continue
            if ":" in label:
                service_name, port = label.split(":", 1)
                labels.append(f"{service_name.strip().upper()} on `{port.strip()}/tcp`")
            else:
                labels.append(f"`{label}`")
        if not labels:
            return None
        if len(labels) == 1:
            return labels[0]
        if len(labels) == 2:
            return f"{labels[0]} and {labels[1]}"
        return f"{', '.join(labels[:-1])}, and {labels[-1]}"

    @staticmethod
    def _credential_username(credential: dict | None) -> str | None:
        if credential is None:
            return None
        username = credential.get("username")
        if isinstance(username, str) and username.strip():
            return username.strip()
        return None

    def _graph_label(self, delta_pack: dict, label_fragment: str) -> str | None:
        if not label_fragment:
            return None
        exact_needle = label_fragment.strip().lower()
        for node in delta_pack.get("graph_nodes", []):
            label = str(node.get("label", "")).strip()
            if label.lower() == exact_needle:
                return label
        node = self._find_graph_node(delta_pack, label_fragment)
        if node is None:
            return None
        label = node.get("label")
        return str(label) if isinstance(label, str) and label.strip() else None

    def _inferred_username(self, delta_pack: dict) -> str | None:
        direct_username = self._credential_username(next(iter(delta_pack.get("credentials", [])), None))
        if direct_username:
            return direct_username

        credential_node = self._find_graph_node(delta_pack, "Credential:")
        if credential_node is not None:
            label = str(credential_node.get("label", ""))
            if ":" in label:
                _, username = label.split(":", 1)
                normalized = username.strip()
                if normalized:
                    return normalized

        session_node = self._find_graph_node(delta_pack, "SSH session:")
        if session_node is not None:
            label = str(session_node.get("label", ""))
            if ":" in label:
                _, session_target = label.split(":", 1)
                session_target = session_target.strip()
                if "@" in session_target:
                    username = session_target.split("@", 1)[0].strip()
                    if username:
                        return username

        tshark_command = self._find_command(delta_pack, "user\tnathan", "pass\t")
        if tshark_command is not None:
            output = str(tshark_command.get("output", ""))
            for line in output.splitlines():
                if line.upper().startswith("USER"):
                    username = line.split()[-1].strip()
                    if username:
                        return username
        return None

    def _find_flag_value_from_commands(self, delta_pack: dict, flag_type: str) -> str | None:
        command = None
        if flag_type == "user":
            command = self._find_command(delta_pack, "/home/", "user.txt")
        elif flag_type == "root":
            command = self._find_command(delta_pack, "/root/root.txt")
        if command is None:
            return None

        output = str(command.get("output", "")).strip()
        if not output:
            return None
        for line in reversed(output.splitlines()):
            normalized = line.strip()
            if len(normalized) >= 32 and normalized.replace("-", "").isalnum():
                return normalized
        return output.splitlines()[-1].strip() if output.splitlines() else None

    @staticmethod
    def _command_detail(command: dict | None, fallback: str) -> str:
        if command is None:
            return fallback
        output = str(command.get("output", "")).strip()
        if "/data/0" in output:
            return "/data/0"
        if "/capture/" in output:
            return "/capture/"
        return fallback

    def _has_foothold_signal(self, delta_pack: dict) -> bool:
        if delta_pack.get("credentials"):
            return True
        if self._find_graph_node(delta_pack, "Credential:") is not None:
            return True
        if self._find_graph_node(delta_pack, "SSH session:") is not None:
            return True
        if self._find_command(delta_pack, "user.txt", "/home/") is not None:
            return True
        return self._find_command(delta_pack, "sshpass", "uid=1001(") is not None

    def _has_loot_signal(self, delta_pack: dict) -> bool:
        if delta_pack.get("flags"):
            return True
        if self._find_graph_node(delta_pack, "user.txt") is not None:
            return True
        if self._find_graph_node(delta_pack, "root.txt") is not None:
            return True
        if self._find_command(delta_pack, "/root/root.txt") is not None:
            return True
        return self._find_command(delta_pack, "user.txt", "/home/") is not None

    @staticmethod
    def _command_timeline_snippet(command: dict) -> str | None:
        output = str(command.get("output", "")).strip()
        if not output:
            return None
        for line in reversed(output.splitlines()):
            normalized = line.strip()
            if _DeterministicReportingProvider._looks_like_artifact(normalized):
                return f"`{normalized}`"
        for line in output.splitlines():
            normalized = line.strip()
            if normalized and normalized != "...":
                return f"`{normalized}`"
        return None

    @staticmethod
    def _looks_like_artifact(value: str) -> bool:
        if not value or " " in value:
            return False
        normalized = value.strip()
        return len(normalized) >= 24 and normalized.replace("-", "").isalnum()


class LLMService(BaseService):
    """Manages provider creation, caching, and context-based routing."""

    def __init__(self, db: AsyncSession):
        super().__init__("service.llm")
        self.db = db
        self._cache: dict[tuple[int, str | None], LLMProvider] = {}

    # ------------------------------------------------------------------
    # Factory
    # ------------------------------------------------------------------

    def create_provider(
        self,
        config: AIProviderConfig,
        *,
        model_override: str | None = None,
    ) -> LLMProvider:
        """Create (or return cached) provider from DB config.

        Raises:
            ValueError: If provider type is unknown or provider is disabled.
        """
        if not config.is_enabled:
            raise ValueError("Provider is disabled")

        # Return cached instance if available
        cache_key = (config.id, model_override)
        if cache_key in self._cache:
            return self._cache[cache_key]

        provider = self._build_provider(config, model_override=model_override)
        provider.provider_name = config.name
        provider.provider_config_id = config.id
        provider.provider_type = config.provider_type
        self._cache[cache_key] = provider
        return provider

    def _build_provider(
        self,
        config: AIProviderConfig,
        *,
        model_override: str | None = None,
    ) -> LLMProvider:
        """Build a new provider instance from config."""
        ptype = config.provider_type
        effective_model = model_override or config.default_model

        if ptype == "ollama":
            return OllamaProvider(
                base_url=config.base_url or "http://localhost:11434",
                timeout=config.timeout_seconds,
                default_model=effective_model,
                temperature=config.temperature,
                max_tokens=config.max_tokens,
                top_p=config.top_p,
                custom_headers=config.custom_headers,
            )

        if ptype == "openai_compat":
            api_key = self._decrypt_key(config.api_key_encrypted)
            return OpenAICompatibleProvider(
                base_url=config.base_url or "http://localhost:1234/v1",
                api_key=api_key,
                timeout=config.timeout_seconds,
                default_model=effective_model,
                temperature=config.temperature,
                max_tokens=config.max_tokens,
                top_p=config.top_p,
                custom_headers=config.custom_headers,
            )

        if ptype == "openai":
            api_key = self._decrypt_key(config.api_key_encrypted)
            return OpenAIProvider(
                api_key=api_key,
                timeout=config.timeout_seconds,
                default_model=effective_model,
                temperature=config.temperature,
                max_tokens=config.max_tokens,
                top_p=config.top_p,
                custom_headers=config.custom_headers,
            )

        if ptype == "anthropic":
            api_key = self._decrypt_key(config.api_key_encrypted)
            return AnthropicProvider(
                api_key=api_key,
                timeout=config.timeout_seconds,
                default_model=effective_model,
                temperature=config.temperature,
                max_tokens=config.max_tokens,
                top_p=config.top_p,
                custom_headers=config.custom_headers,
            )

        if ptype == "cli":
            effective = get_effective_cli_settings(
                config.cli_command or "",
                cli_args_template=config.cli_args_template,
                cli_interactive_args=config.cli_interactive_args,
                parse_mode=config.parse_mode,
                supports_streaming=config.supports_streaming,
                supports_resume=config.supports_resume,
                session_flag=config.session_flag,
            )
            return CLIProvider(
                cli_command=config.cli_command or "",
                cli_args_template=effective.cli_args_template,
                cli_interactive_args=effective.cli_interactive_args,
                cli_env=config.cli_env,
                working_directory=config.working_directory,
                parse_mode=effective.parse_mode or "raw",
                supports_streaming=effective.supports_streaming,
                supports_resume=effective.supports_resume,
                session_flag=effective.session_flag,
                detected_version=config.detected_version,
                detected_models=config.detected_models,
                timeout=config.timeout_seconds,
                default_model=effective_model,
                temperature=config.temperature,
                max_tokens=config.max_tokens,
                top_p=config.top_p,
                custom_headers=config.custom_headers,
                provider_label=config.name,
            )

        raise ValueError(f"Unknown provider type: {ptype}")

    # ------------------------------------------------------------------
    # Routing
    # ------------------------------------------------------------------

    async def get_provider_for_context(
        self,
        user_id: str,
        context_type: str,
        project_id: str | None = None,
    ) -> LLMProvider | None:
        """Resolve provider via context routing (project override → global).

        Returns None when no routing is configured.
        """
        if (
            context_type == "reporting"
            and os.getenv(_FAKE_REPORTING_PROVIDER_ENV) == "deterministic"
        ):
            return _DeterministicReportingProvider()

        # 1. Try project-specific routing
        if project_id:
            routing = await self._find_routing(user_id, context_type, project_id)
            if routing:
                return self.create_provider(
                    routing.provider_config,
                    model_override=routing.model,
                )

        # 2. Fall back to global routing
        routing = await self._find_routing(user_id, context_type, project_id=None)
        if routing:
            return self.create_provider(
                routing.provider_config,
                model_override=routing.model,
            )

        # 3. Fall back to first enabled provider for the user
        config = await self._find_first_enabled(user_id)
        if config:
            return self.create_provider(config)

        return None

    async def resolve_context_selection(
        self,
        *,
        user_id: str,
        context_type: str,
        project_id: str | None = None,
    ) -> tuple[int | None, str | None]:
        """Resolve provider_config_id + effective model for a context."""
        routing: AIContextRouting | None = None

        if project_id:
            routing = await self._find_routing(user_id, context_type, project_id)

        if routing is None:
            routing = await self._find_routing(user_id, context_type, project_id=None)

        if routing is not None:
            return routing.provider_config_id, routing.model or routing.provider_config.default_model

        config = await self._find_first_enabled(user_id)
        if config is not None:
            return config.id, config.default_model

        return None, None

    async def _find_routing(
        self,
        user_id: str,
        context_type: str,
        project_id: str | None,
    ) -> AIContextRouting | None:
        """Find a single routing row."""
        stmt = (
            select(AIContextRouting)
            .options(joinedload(AIContextRouting.provider_config))
            .where(
                AIContextRouting.user_id == user_id,
                AIContextRouting.context_type == context_type,
                AIContextRouting.project_id == project_id,
            )
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def _find_first_enabled(
        self,
        user_id: str,
    ) -> AIProviderConfig | None:
        """Return the first enabled provider config for the user."""
        stmt = (
            select(AIProviderConfig)
            .where(
                AIProviderConfig.user_id == user_id,
                AIProviderConfig.is_enabled.is_(True),
            )
            .order_by(AIProviderConfig.created_at)
            .limit(1)
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    # ------------------------------------------------------------------
    # Lookup by ID
    # ------------------------------------------------------------------

    async def get_provider_by_id(
        self,
        provider_id: int,
        user_id: str,
    ) -> LLMProvider | None:
        """Get a provider by its config ID, scoped to user."""
        config = await self.db.get(AIProviderConfig, provider_id)
        if config is None:
            return None
        if config.user_id != user_id:
            return None
        return self.create_provider(config)

    # ------------------------------------------------------------------
    # Cache management
    # ------------------------------------------------------------------

    def clear_cache(self, provider_id: int | None = None) -> None:
        """Clear cached provider instances."""
        if provider_id is not None:
            stale_keys = [
                cache_key
                for cache_key in self._cache
                if cache_key[0] == provider_id
            ]
            for cache_key in stale_keys:
                self._cache.pop(cache_key, None)
        else:
            self._cache.clear()

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _decrypt_key(encrypted: bytes | None) -> str | None:
        """Decrypt an API key from DB storage."""
        if encrypted is None:
            return None
        key = get_or_create_key()
        return decrypt_api_key(encrypted, key)
