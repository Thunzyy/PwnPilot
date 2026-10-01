from pydantic import BaseModel, ConfigDict


class VpnPlatformProfile(BaseModel):
    label: str | None = None
    config_path: str | None = None
    connect_command: str | None = None
    file_name: str | None = None
    managed: bool | None = None
    disabled: bool | None = None
    has_api_token: bool | None = None


class VpnPlatformProfileUpdate(VpnPlatformProfile):
    uploaded_file_name: str | None = None
    uploaded_file_content: str | None = None
    api_token: str | None = None
    clear_api_token: bool | None = None


class SettingsResponse(BaseModel):
    """Schema for settings API responses."""

    model_config = ConfigDict(from_attributes=True)

    workspace_base_path: str | None = None
    vault_path: str | None = None
    vpn_path: str | None = None
    vpn_content: str | None = None
    vpn_platform_defaults: dict[str, VpnPlatformProfile] | None = None
    report_evaluation_lease_seconds: float | None = None
    report_evaluation_heartbeat_interval_seconds: float | None = None
    report_evaluation_reclaim_poll_interval_seconds: float | None = None
    report_evaluation_max_runtime_seconds: float | None = None


class SettingsUpdate(BaseModel):
    """Schema for updating app settings."""

    workspace_base_path: str | None = None
    vault_path: str | None = None
    vpn_path: str | None = None
    vpn_content: str | None = None
    vpn_platform_defaults: dict[str, VpnPlatformProfileUpdate] | None = None
    report_evaluation_lease_seconds: float | None = None
    report_evaluation_heartbeat_interval_seconds: float | None = None
    report_evaluation_reclaim_poll_interval_seconds: float | None = None
    report_evaluation_max_runtime_seconds: float | None = None


class PathValidationResponse(BaseModel):
    """Response for server-side path validation."""

    path: str
    exists: bool
    is_directory: bool
    is_obsidian_vault: bool
