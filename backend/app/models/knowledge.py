import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.sqlite import JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class KnowledgeSource(Base):
    __tablename__ = "knowledge_sources"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: str(uuid.uuid4())
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    source_type: Mapped[str] = mapped_column(String, nullable=False)
    origin: Mapped[str | None] = mapped_column(String, nullable=True)
    path: Mapped[str | None] = mapped_column(String, nullable=True)
    remote_url: Mapped[str | None] = mapped_column(String, nullable=True)
    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id"), nullable=False
    )
    project_id: Mapped[str] = mapped_column(
        String, ForeignKey("projects.id"), nullable=False
    )
    read_only: Mapped[bool] = mapped_column(default=False)
    include_paths: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    opsec_acknowledged: Mapped[bool] = mapped_column(default=False)
    sync_status: Mapped[str | None] = mapped_column(String, nullable=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    docs: Mapped[list["KnowledgeDoc"]] = relationship(
        "KnowledgeDoc", back_populates="source"
    )


class KnowledgeDoc(Base):
    __tablename__ = "knowledge_docs"
    __table_args__ = (
        UniqueConstraint(
            "source_id", "relative_path", name="uq_knowledge_docs_source_path"
        ),
    )

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: str(uuid.uuid4())
    )
    source_id: Mapped[str] = mapped_column(
        String, ForeignKey("knowledge_sources.id"), nullable=False
    )
    title: Mapped[str] = mapped_column(String, nullable=False)
    relative_path: Mapped[str] = mapped_column(String, nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    tags: Mapped[str | None] = mapped_column(String, nullable=True)
    content_hash: Mapped[str | None] = mapped_column(String, nullable=True)
    wikilinks: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    frontmatter: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    source: Mapped["KnowledgeSource"] = relationship(
        "KnowledgeSource", back_populates="docs"
    )
    bookmarks: Mapped[list["KnowledgeBookmark"]] = relationship(
        "KnowledgeBookmark", back_populates="doc", cascade="all, delete-orphan"
    )


class KnowledgeBookmark(Base):
    __tablename__ = "knowledge_bookmarks"
    __table_args__ = (
        UniqueConstraint("user_id", "doc_id", name="uq_bookmarks_user_doc"),
    )

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id"), nullable=False
    )
    doc_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("knowledge_docs.id", ondelete="CASCADE"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now()
    )

    doc: Mapped["KnowledgeDoc"] = relationship(
        "KnowledgeDoc", back_populates="bookmarks"
    )
