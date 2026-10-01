import re
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.crypto import decrypt_api_key, encrypt_api_key, get_or_create_key
from app.core.security import sanitize_filename
from app.models.app_settings import AppSettings
from app.services.base import BaseService


class SettingsService(BaseService):
    def __init__(self, db: AsyncSession):
        super().__init__("service.settings")
        self.db = db

    async def get_or_create(self) -> AppSettings:
        result = await self.db.execute(select(AppSettings).where(AppSettings.id == 1))
        settings = result.scalar_one_or_none()
        if not settings:
            settings = AppSettings(id=1)
            self.db.add(settings)
            await self.db.commit()
            await self.db.refresh(settings)
        return settings

    async def get_or_create_response(self) -> dict:
        settings = await self.get_or_create()
        return self._serialize_settings(settings)

    async def update(self, data) -> AppSettings:
        settings = await self.get_or_create()
        update = data.model_dump(exclude_unset=True)
        if "vpn_platform_defaults" in update:
            update["vpn_platform_defaults"] = self._prepare_vpn_platform_defaults(
                current=settings.vpn_platform_defaults,
                incoming=update["vpn_platform_defaults"],
            )
        for key, value in update.items():
            setattr(settings, key, value)
        await self.db.commit()
        await self.db.refresh(settings)
        return settings

    async def update_response(self, data) -> dict:
        settings = await self.update(data)
        return self._serialize_settings(settings)

    def _prepare_vpn_platform_defaults(
        self,
        current: dict | None,
        incoming: dict | None,
    ) -> dict[str, dict]:
        existing = current or {}
        next_profiles: dict[str, dict] = {}
        stale_managed_paths: list[Path] = []

        incoming_profiles = incoming or {}

        for platform_id, stored_profile in existing.items():
            if platform_id not in incoming_profiles and stored_profile.get("managed"):
                stale_managed_paths.append(Path(stored_profile.get("config_path", "")))

        for raw_platform_id, raw_profile in incoming_profiles.items():
            platform_id = self._normalize_platform_id(raw_platform_id)
            stored_profile = existing.get(platform_id, {})

            label = self._trim(raw_profile.get("label")) or self._humanize_platform_id(
                platform_id
            )
            config_path = self._trim(raw_profile.get("config_path"))
            connect_command = self._trim(raw_profile.get("connect_command"))
            uploaded_file_name = self._trim(raw_profile.get("uploaded_file_name"))
            uploaded_file_content = raw_profile.get("uploaded_file_content") or ""
            file_name = self._trim(raw_profile.get("file_name")) or uploaded_file_name
            managed = bool(raw_profile.get("managed"))
            disabled = bool(raw_profile.get("disabled"))
            api_token = self._trim(raw_profile.get("api_token"))
            clear_api_token = bool(raw_profile.get("clear_api_token"))

            normalized = {
                "label": label,
                "config_path": config_path or "",
                "connect_command": connect_command,
                "file_name": file_name,
                "managed": managed,
                "disabled": disabled,
            }

            previous_path_value = self._trim(stored_profile.get("config_path"))
            previous_path = Path(previous_path_value) if previous_path_value else None
            previous_managed = bool(stored_profile.get("managed"))
            previous_encrypted_token = self._trim(stored_profile.get("api_token_encrypted"))

            encrypted_token = previous_encrypted_token
            if clear_api_token:
                encrypted_token = None
            elif api_token:
                encrypted_value = encrypt_api_key(api_token, get_or_create_key())
                encrypted_token = encrypted_value.decode("utf-8") if encrypted_value else None

            if encrypted_token:
                normalized["api_token_encrypted"] = encrypted_token

            if disabled:
                normalized["config_path"] = ""
                normalized["file_name"] = None
                normalized["managed"] = False
                if previous_managed and previous_path:
                    stale_managed_paths.append(previous_path)
                next_profiles[platform_id] = normalized
                continue

            if uploaded_file_content:
                managed_path, managed_file_name = self._write_vpn_platform_file(
                    platform_id=platform_id,
                    requested_file_name=uploaded_file_name or file_name or f"{platform_id}.ovpn",
                    content=uploaded_file_content,
                )
                normalized["config_path"] = str(managed_path)
                normalized["file_name"] = managed_file_name
                normalized["managed"] = True
                if previous_managed and previous_path and previous_path != managed_path:
                    stale_managed_paths.append(previous_path)
            elif previous_managed and previous_path and managed and config_path == str(previous_path):
                normalized["config_path"] = str(previous_path)
                normalized["file_name"] = file_name or stored_profile.get("file_name")
                normalized["managed"] = True
            elif config_path:
                normalized["managed"] = False
                normalized["file_name"] = file_name
                if previous_managed and previous_path and config_path != str(previous_path):
                    stale_managed_paths.append(previous_path)
            elif previous_managed and previous_path and managed:
                normalized["config_path"] = str(previous_path)
                normalized["file_name"] = file_name or stored_profile.get("file_name")
                normalized["managed"] = True
            elif previous_managed and previous_path:
                stale_managed_paths.append(previous_path)
                normalized["managed"] = False

            next_profiles[platform_id] = normalized

        for stale_path in stale_managed_paths:
            self._delete_managed_file(stale_path)

        return next_profiles

    def _serialize_settings(self, settings_obj: AppSettings) -> dict:
        return {
            "workspace_base_path": settings_obj.workspace_base_path,
            "vault_path": settings_obj.vault_path,
            "vpn_path": settings_obj.vpn_path,
            "vpn_content": settings_obj.vpn_content,
            "vpn_platform_defaults": self._sanitize_vpn_platform_defaults(
                settings_obj.vpn_platform_defaults
            ),
            "report_evaluation_lease_seconds": self._coalesce_runtime_override(
                settings_obj.report_evaluation_lease_seconds,
                settings.report_evaluation_lease_seconds,
            ),
            "report_evaluation_heartbeat_interval_seconds": self._coalesce_runtime_override(
                settings_obj.report_evaluation_heartbeat_interval_seconds,
                settings.report_evaluation_heartbeat_interval_seconds,
            ),
            "report_evaluation_reclaim_poll_interval_seconds": self._coalesce_runtime_override(
                settings_obj.report_evaluation_reclaim_poll_interval_seconds,
                settings.report_evaluation_reclaim_poll_interval_seconds,
            ),
            "report_evaluation_max_runtime_seconds": self._coalesce_runtime_override(
                settings_obj.report_evaluation_max_runtime_seconds,
                settings.report_evaluation_max_runtime_seconds,
            ),
        }

    def get_platform_api_token(
        self,
        platform_id: str,
        *,
        settings_obj: AppSettings | None = None,
    ) -> str | None:
        current_settings = settings_obj
        if current_settings is None:
            raise RuntimeError("settings_obj is required when reading platform tokens synchronously")

        stored_profile = (current_settings.vpn_platform_defaults or {}).get(platform_id) or {}
        encrypted_token = self._trim(stored_profile.get("api_token_encrypted"))
        if not encrypted_token:
            return None

        try:
            return decrypt_api_key(encrypted_token.encode("utf-8"), get_or_create_key())
        except Exception:
            self.logger.warning("Failed to decrypt platform API token", extra={"platform_id": platform_id})
            return None

    def _sanitize_vpn_platform_defaults(self, profiles: dict | None) -> dict[str, dict]:
        sanitized: dict[str, dict] = {}
        for platform_id, raw_profile in (profiles or {}).items():
            profile = dict(raw_profile or {})
            encrypted_token = self._trim(profile.pop("api_token_encrypted", None))
            profile["has_api_token"] = bool(encrypted_token)
            sanitized[platform_id] = profile
        return sanitized

    @staticmethod
    def _coalesce_runtime_override(value: float | None, default: float) -> float:
        return default if value is None else value

    @staticmethod
    def _trim(value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @staticmethod
    def _normalize_platform_id(value: str) -> str:
        normalized = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
        return normalized or "custom-platform"

    @staticmethod
    def _humanize_platform_id(value: str) -> str:
        return value.replace("-", " ").replace("_", " ").title()

    @staticmethod
    def _vpn_platform_storage_dir() -> Path:
        storage_dir = Path(settings.projects_root).expanduser().resolve() / "vpn-platforms"
        storage_dir.mkdir(parents=True, exist_ok=True)
        return storage_dir

    def _write_vpn_platform_file(
        self,
        platform_id: str,
        requested_file_name: str,
        content: str,
    ) -> tuple[Path, str]:
        safe_name = sanitize_filename(requested_file_name)
        file_name = safe_name or f"{platform_id}.ovpn"
        platform_dir = self._vpn_platform_storage_dir() / platform_id
        platform_dir.mkdir(parents=True, exist_ok=True)
        target_path = platform_dir / file_name
        target_path.write_text(content, encoding="utf-8")
        return target_path, file_name

    @staticmethod
    def _delete_managed_file(path: Path) -> None:
        try:
            resolved = path.expanduser().resolve()
        except FileNotFoundError:
            return
        storage_root = SettingsService._vpn_platform_storage_dir()
        try:
            resolved.relative_to(storage_root)
        except ValueError:
            return
        resolved.unlink(missing_ok=True)
        parent = resolved.parent
        if parent != storage_root:
            try:
                parent.rmdir()
            except OSError:
                pass
