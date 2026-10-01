from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
from pathlib import Path
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_settings import AppSettings
from app.models.project import Project
from app.services.base import BaseService
from app.services.settings_service import SettingsService

VPN_PLATFORM_ORDER = ["htb", "thm", "real", "ctf", "custom"]
DEFAULT_VPN_CONNECT_COMMAND = "sudo openvpn {{vpn_path}}"
VPN_PLATFORM_META: dict[str, dict[str, str]] = {
    "htb": {
        "label": "Hack The Box",
        "short_label": "HTB",
    },
    "thm": {
        "label": "TryHackMe",
        "short_label": "THM",
    },
    "real": {
        "label": "Real Engagement",
        "short_label": "Client",
    },
    "ctf": {
        "label": "CTF / Event",
        "short_label": "CTF",
    },
    "custom": {
        "label": "Custom / Misc",
        "short_label": "Custom",
    },
}
VPN_EXECUTABLE_HINTS = (
    "openvpn",
    "openconnect",
    "openfortivpn",
    "wg-quick",
    "wireguard",
    "forticlient",
    "fortivpn",
    "globalprotect",
    "gp-saml-gui",
)


class ProjectVpnService(BaseService):
    def __init__(self, db: AsyncSession):
        super().__init__("service.project_vpn")
        self.db = db
        self.settings_service = SettingsService(db)

    async def get_status(self, project: Project) -> dict[str, Any]:
        settings_obj = await self.settings_service.get_or_create()
        resolved = self._resolve_connection(project, settings_obj)

        if not resolved["command"]:
            resolved["state"] = "missing"
            return resolved

        try:
            connected_process = self._find_connected_process(
                config_path=resolved["config_path"],
                command=resolved["command"],
            )
        except Exception:
            self.logger.exception(
                "Failed to inspect VPN process state",
                extra={"project_id": project.id},
            )
            resolved["state"] = "unknown"
            resolved["reason"] = "Failed to inspect the local VPN process state."
            return resolved

        if connected_process:
            resolved["state"] = "connected"
            resolved["connected_process_pid"] = connected_process["pid"]
            resolved["connected_process_name"] = connected_process["name"]
            resolved["connected_process_command"] = connected_process["command"]
            resolved["disconnect_command"] = f"sudo kill {connected_process['pid']}"
        else:
            resolved["state"] = "disconnected"
            resolved["disconnect_command"] = None

        return resolved

    def _resolve_connection(
        self,
        project: Project,
        settings_obj: AppSettings,
    ) -> dict[str, Any]:
        registry = self._get_platform_registry(settings_obj)
        requested_platform_id = self._normalize_platform_id(
            self._trim(project.variables.get("vpn_platform")) or project.type
        )
        selected_platform = registry.get(requested_platform_id) or registry.get(project.type)
        fallback_meta = self._get_platform_meta(project.type)

        project_path = self._trim(project.variables.get("vpn_path"))
        platform_path = self._trim(selected_platform.get("config_path") if selected_platform else None)
        legacy_path = self._trim(settings_obj.vpn_path)
        config_path = project_path or platform_path or legacy_path or ""

        connect_command = (
            self._trim(project.variables.get("vpn_connect_command"))
            or self._trim(selected_platform.get("connect_command") if selected_platform else None)
            or DEFAULT_VPN_CONNECT_COMMAND
        )

        platform_id = selected_platform.get("id") if selected_platform else self._normalize_platform_id(project.type)
        platform_label = selected_platform.get("label") if selected_platform else fallback_meta["label"]
        platform_short_label = (
            selected_platform.get("short_label") if selected_platform else fallback_meta["short_label"]
        )

        button_label = f"Connect {platform_short_label or platform_label} VPN"
        source_label = (
            "project override"
            if project_path
            else f"{platform_label} default"
            if platform_path
            else "legacy global default"
            if legacy_path
            else "missing"
        )

        if not config_path:
            return {
                "platform_id": platform_id,
                "platform_label": platform_label,
                "button_label": button_label,
                "state": "missing",
                "command": None,
                "disconnect_command": None,
                "config_path": "",
                "source_label": source_label,
                "reason": f"Configure a VPN path or upload a VPN file for {platform_label}.",
                "connected_process_pid": None,
                "connected_process_name": None,
                "connected_process_command": None,
            }

        command = self._render_template(
            connect_command,
            {
                "vpn_path": config_path,
                "project_name": project.name,
                "project_slug": project.slug,
                "project_path": project.workspace_path,
                "project_type": project.type,
            },
        ).strip()

        return {
            "platform_id": platform_id,
            "platform_label": platform_label,
            "button_label": button_label,
            "state": "unknown",
            "command": command or None,
            "disconnect_command": None,
            "config_path": config_path,
            "source_label": source_label,
            "reason": None if command else "VPN connect command is empty.",
            "connected_process_pid": None,
            "connected_process_name": None,
            "connected_process_command": None,
        }

    def _get_platform_registry(self, settings_obj: AppSettings) -> dict[str, dict[str, str]]:
        stored_defaults = settings_obj.vpn_platform_defaults or {}
        registry: dict[str, dict[str, str]] = {}

        for platform_id in VPN_PLATFORM_ORDER:
            stored_profile = stored_defaults.get(platform_id) or {}
            if stored_profile.get("disabled") is True:
                continue
            registry[platform_id] = self._normalize_platform_profile(platform_id, stored_profile)

        for raw_platform_id, raw_profile in stored_defaults.items():
            platform_id = self._normalize_platform_id(raw_platform_id)
            if raw_profile.get("disabled") is True:
                registry.pop(platform_id, None)
                continue
            registry[platform_id] = self._normalize_platform_profile(platform_id, raw_profile)

        return registry

    def _normalize_platform_profile(self, platform_id: str, profile: dict[str, Any]) -> dict[str, str]:
        meta = self._get_platform_meta(platform_id)
        resolved_label = self._trim(profile.get("label")) or meta["label"]
        return {
            "id": platform_id,
            "label": resolved_label,
            "short_label": meta["short_label"] if platform_id in VPN_PLATFORM_META else resolved_label,
            "config_path": self._trim(profile.get("config_path")) or "",
            "connect_command": self._trim(profile.get("connect_command")) or DEFAULT_VPN_CONNECT_COMMAND,
        }

    def _find_connected_process(
        self,
        *,
        config_path: str,
        command: str,
    ) -> dict[str, Any] | None:
        processes = self._list_processes()
        if not processes:
            return None

        path_variants = self._build_path_variants(config_path)
        command_tokens = self._build_command_tokens(command)

        for process in processes:
            process_name = self._trim(process.get("name")) or ""
            process_command = self._trim(process.get("command")) or ""
            lowered_command = process_command.lower()
            lowered_name = process_name.lower()
            is_vpn_process = any(
                hint in lowered_name or hint in lowered_command for hint in VPN_EXECUTABLE_HINTS
            )
            if not is_vpn_process:
                continue

            if any(variant in lowered_command for variant in path_variants):
                return process

            if command_tokens and all(token in lowered_command for token in command_tokens):
                return process

        return None

    def _list_processes(self) -> list[dict[str, Any]]:
        return self._list_windows_processes() if os.name == "nt" else self._list_posix_processes()

    def _list_posix_processes(self) -> list[dict[str, Any]]:
        result = subprocess.run(
            ["ps", "-eo", "pid=,comm=,args="],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            return []

        processes: list[dict[str, Any]] = []
        for raw_line in result.stdout.splitlines():
            line = raw_line.strip()
            if not line:
                continue
            parts = line.split(None, 2)
            if len(parts) < 2:
                continue
            pid_raw, name = parts[0], parts[1]
            command = parts[2] if len(parts) > 2 else name
            try:
                pid = int(pid_raw)
            except ValueError:
                continue
            processes.append({"pid": pid, "name": name, "command": command})
        return processes

    def _list_windows_processes(self) -> list[dict[str, Any]]:
        result = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-Command",
                (
                    "Get-CimInstance Win32_Process | "
                    "Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress"
                ),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0 or not result.stdout.strip():
            return []

        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError:
            return []

        if isinstance(payload, dict):
            payload = [payload]
        if not isinstance(payload, list):
            return []

        processes: list[dict[str, Any]] = []
        for item in payload:
            if not isinstance(item, dict):
                continue
            try:
                pid = int(item.get("ProcessId"))
            except (TypeError, ValueError):
                continue
            name = self._trim(item.get("Name")) or ""
            command = self._trim(item.get("CommandLine")) or name
            processes.append({"pid": pid, "name": name, "command": command})
        return processes

    def _build_path_variants(self, path_value: str) -> set[str]:
        raw_path = self._trim(path_value)
        if not raw_path:
            return set()

        variants = {raw_path.lower()}
        try:
            expanded = str(Path(raw_path).expanduser())
            variants.add(expanded.lower())
            variants.add(Path(expanded).name.lower())
        except (RuntimeError, ValueError):
            pass

        return {variant for variant in variants if variant}

    def _build_command_tokens(self, command: str) -> list[str]:
        raw_command = self._trim(command)
        if not raw_command:
            return []

        try:
            tokens = shlex.split(raw_command, posix=os.name != "nt")
        except ValueError:
            tokens = raw_command.split()

        ignored_tokens = {
            "sudo",
            "doas",
            "pkexec",
            "--config",
            "-c",
        }
        significant_tokens: list[str] = []
        for token in tokens:
            normalized = token.strip().lower()
            if not normalized or normalized in ignored_tokens:
                continue
            if normalized.startswith("{{") and normalized.endswith("}}"):
                continue
            if "/" in normalized or "\\" in normalized:
                continue
            significant_tokens.append(normalized)
        return significant_tokens[:3]

    @staticmethod
    def _render_template(template: str, variables: dict[str, str]) -> str:
        return re.sub(
            r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}",
            lambda match: variables.get(match.group(1), ""),
            template,
        )

    @staticmethod
    def _trim(value: Any) -> str:
        return value.strip() if isinstance(value, str) else ""

    @staticmethod
    def _normalize_platform_id(value: str) -> str:
        normalized = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
        return normalized or "custom-platform"

    def _get_platform_meta(self, platform_id: str) -> dict[str, str]:
        if platform_id in VPN_PLATFORM_META:
            return VPN_PLATFORM_META[platform_id]

        label = self._humanize_platform_id(platform_id)
        return {
            "label": label,
            "short_label": label,
        }

    @staticmethod
    def _humanize_platform_id(value: str) -> str:
        normalized = value.replace("-", " ").replace("_", " ").strip()
        return normalized.title() if normalized else "VPN Platform"
