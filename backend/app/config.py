import re
from pathlib import Path

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent


def get_default_env_files() -> tuple[str]:
    return (str(REPO_ROOT / ".env"),)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=get_default_env_files(),
        extra="ignore",
    )

    app_name: str = "PwnPilot"
    debug: bool = True
    database_url: str = "sqlite+aiosqlite:///./data/pwnpilot.db"
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
        "http://127.0.0.1:3000",
    ]
    cors_origin_regex: str = r"^https?://(localhost|127\.0\.0\.1):\d+$"

    # Logging settings
    log_level: str = "INFO"  # DEBUG, INFO, WARNING, ERROR
    log_modules: str = ""  # Comma-separated list, empty = all modules
    log_format: str = "console"  # console (colored) or json (production)

    # Console provider settings
    console_provider: str = "tmux_ttyd"  # "legacy" | "tmux_ttyd"
    ttyd_host: str = "localhost"
    ttyd_port_start: int = 7680
    ttyd_port_end: int = 7780
    ttyd_use_ssl: bool = False
    backend_host: str = "localhost"
    backend_port: int = 8000

    # Workspace settings
    projects_root: str = str(Path.home() / "PwnPilot" / "projects")
    allowed_workspace_roots: list[str] = ["~/PwnPilot"]

    # Internal API URL for shell hooks
    api_base_url: str | None = None

    # Auth settings
    jwt_secret: str = "dev-change-me-please-use-32-bytes-min"
    jwt_algorithm: str = "HS256"
    access_token_ttl_minutes: int = 15
    refresh_token_ttl_days: int = 14

    # AI settings
    ai_encryption_key: str = ""  # Fernet key for API key encryption (generate if empty)
    ai_default_timeout: int = 30
    ai_models_cache_ttl: int = 30
    ai_context_cache_ttl: int = 30
    ai_max_upload_bytes: int = 10 * 1024 * 1024  # 10MB
    ai_attachments_dir: str = "data/attachments"

    # Engagement provider settings (local|mcp), prepared for MCP extension.
    engagement_event_provider: str = "local"
    engagement_state_store: str = "project_variables"
    engagement_mcp_base_url: str = ""
    engagement_mcp_api_key: str = ""
    engagement_mcp_timeout_seconds: float = 5.0

    # Attack graph settings
    attack_graph_auto_seed_demo: bool = False

    # Report evaluation runtime settings
    report_evaluation_lease_seconds: float = 30.0
    report_evaluation_heartbeat_interval_seconds: float = 10.0
    report_evaluation_reclaim_poll_interval_seconds: float = 15.0
    # Report evaluation task settings
    report_evaluation_max_runtime_seconds: float = 300.0

    # Admin seed settings
    seed_admin_enabled: bool = False
    seed_admin_username: str = "admin"
    seed_admin_password: str = "admin"
    seed_admin_email: str = "admin@example.com"
    seed_admin_project_name: str = "CTF Demo Admin"
    seed_admin_project_type: str = "ctf"

    @field_validator("debug", mode="before")
    @classmethod
    def normalize_debug(cls, value: bool | str) -> bool | str:
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"release", "prod", "production"}:
                return False
            if normalized in {"debug", "dev", "development"}:
                return True
        return value

    @model_validator(mode="after")
    def apply_derived_defaults(self) -> "Settings":
        if not self.api_base_url:
            self.api_base_url = (
                f"http://{self.backend_host}:{self.backend_port}/api/v1"
            )
        return self

    def is_allowed_origin(self, origin: str | None) -> bool:
        if not origin:
            return False
        return origin in self.cors_origins or bool(
            re.match(self.cors_origin_regex, origin)
        )

settings = Settings()
Path(settings.projects_root).expanduser().mkdir(parents=True, exist_ok=True)
