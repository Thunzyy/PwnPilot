import uuid

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class CommandFavorite(Base):
    __tablename__ = "command_favorites"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "command_id", "project_id", name="uq_command_favorites_user_command_project"
        ),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False)
    command_id: Mapped[str] = mapped_column(String, ForeignKey("commands.id"), nullable=False)
    project_id: Mapped[str | None] = mapped_column(String, ForeignKey("projects.id"), nullable=True)
