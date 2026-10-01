from datetime import datetime

from sqlalchemy import JSON, DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AppSettings(Base):
    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    workspace_base_path: Mapped[str | None] = mapped_column(String, nullable=True)
    vault_path: Mapped[str | None] = mapped_column(String, nullable=True)
    vpn_path: Mapped[str | None] = mapped_column(String, nullable=True)
    vpn_content: Mapped[str | None] = mapped_column(String, nullable=True)
    vpn_platform_defaults: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    report_evaluation_lease_seconds: Mapped[float | None] = mapped_column(nullable=True)
    report_evaluation_heartbeat_interval_seconds: Mapped[float | None] = mapped_column(nullable=True)
    report_evaluation_reclaim_poll_interval_seconds: Mapped[float | None] = mapped_column(nullable=True)
    report_evaluation_max_runtime_seconds: Mapped[float | None] = mapped_column(nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
