import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class TimelineKBLink(Base):
    """Association model linking timeline entries to knowledge base documents.

    Enables bidirectional queries:
    - "Related knowledge" for a timeline entry (forward lookup)
    - "Used in" for a KB article (reverse lookup)
    """

    __tablename__ = "timeline_kb_links"
    __table_args__ = (
        UniqueConstraint(
            "timeline_entry_id", "doc_id", name="uq_timeline_kb_link"
        ),
        Index("ix_timeline_kb_links_doc_id", "doc_id"),
        Index("ix_timeline_kb_links_entry_id", "timeline_entry_id"),
    )

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: str(uuid.uuid4())
    )
    timeline_entry_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("timeline.id", ondelete="CASCADE"),
        nullable=False,
    )
    doc_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("knowledge_docs.id", ondelete="CASCADE"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now()
    )
