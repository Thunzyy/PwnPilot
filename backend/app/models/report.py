from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utc_now() -> datetime:
    return datetime.now(UTC)


class ReportDB(Base):
    __tablename__ = "reports"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    profile: Mapped[str] = mapped_column(String(32), nullable=False, default="hybrid")
    markdown_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    current_revision: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_evaluated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_accepted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utc_now, onupdate=utc_now, nullable=False
    )

    sections: Mapped[list[ReportSectionDB]] = relationship(
        "ReportSectionDB",
        back_populates="report",
        cascade="all, delete-orphan",
        order_by="ReportSectionDB.position",
    )
    proposals: Mapped[list[ReportUpdateProposalDB]] = relationship(
        "ReportUpdateProposalDB",
        back_populates="report",
        cascade="all, delete-orphan",
        order_by="ReportUpdateProposalDB.created_at",
    )
    artifacts: Mapped[list[ReportArtifactDB]] = relationship(
        "ReportArtifactDB",
        back_populates="report",
        cascade="all, delete-orphan",
        order_by="ReportArtifactDB.created_at",
    )


class ReportSectionDB(Base):
    __tablename__ = "report_sections"
    __table_args__ = (
        UniqueConstraint("report_id", "key", name="uq_report_sections_report_key"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    report_id: Mapped[str] = mapped_column(
        String, ForeignKey("reports.id", ondelete="CASCADE"), nullable=False, index=True
    )
    key: Mapped[str] = mapped_column(String(64), nullable=False)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    content_md: Mapped[str] = mapped_column(Text, default="", nullable=False)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utc_now, onupdate=utc_now, nullable=False
    )

    report: Mapped[ReportDB] = relationship("ReportDB", back_populates="sections")


class ReportUpdateProposalDB(Base):
    __tablename__ = "report_update_proposals"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    report_id: Mapped[str] = mapped_column(
        String, ForeignKey("reports.id", ondelete="CASCADE"), nullable=False, index=True
    )
    trigger_type: Mapped[str] = mapped_column(String(32), nullable=False, default="manual")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", index=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utc_now, onupdate=utc_now, nullable=False
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    report: Mapped[ReportDB] = relationship("ReportDB", back_populates="proposals")
    section_patches: Mapped[list[ReportUpdateSectionPatchDB]] = relationship(
        "ReportUpdateSectionPatchDB",
        back_populates="proposal",
        cascade="all, delete-orphan",
        order_by="ReportUpdateSectionPatchDB.created_at",
    )
    evidence_links: Mapped[list[ReportEvidenceLinkDB]] = relationship(
        "ReportEvidenceLinkDB",
        back_populates="proposal",
        cascade="all, delete-orphan",
        order_by="ReportEvidenceLinkDB.created_at",
    )
    evaluation_tasks: Mapped[list[ReportEvaluationTaskDB]] = relationship(
        "ReportEvaluationTaskDB",
        back_populates="proposal",
    )


class ReportUpdateSectionPatchDB(Base):
    __tablename__ = "report_update_section_patches"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    proposal_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("report_update_proposals.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    section_key: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    content_md: Mapped[str] = mapped_column(Text, default="", nullable=False)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)

    proposal: Mapped[ReportUpdateProposalDB] = relationship(
        "ReportUpdateProposalDB", back_populates="section_patches"
    )
    evidence_links: Mapped[list[ReportEvidenceLinkDB]] = relationship(
        "ReportEvidenceLinkDB",
        back_populates="patch",
    )


class ReportEvidenceLinkDB(Base):
    __tablename__ = "report_evidence_links"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    proposal_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("report_update_proposals.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    patch_id: Mapped[str | None] = mapped_column(
        String,
        ForeignKey("report_update_section_patches.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    source_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    source_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)

    proposal: Mapped[ReportUpdateProposalDB] = relationship(
        "ReportUpdateProposalDB", back_populates="evidence_links"
    )
    patch: Mapped[ReportUpdateSectionPatchDB | None] = relationship(
        "ReportUpdateSectionPatchDB", back_populates="evidence_links"
    )


class ReportEvaluationTaskDB(Base):
    __tablename__ = "report_evaluation_tasks"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    proposal_id: Mapped[str | None] = mapped_column(
        String,
        ForeignKey("report_update_proposals.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    trigger_type: Mapped[str] = mapped_column(String(32), nullable=False, default="manual")
    target_section_keys: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="queued", index=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    lease_version: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utc_now, onupdate=utc_now, nullable=False
    )

    proposal: Mapped[ReportUpdateProposalDB | None] = relationship(
        "ReportUpdateProposalDB",
        back_populates="evaluation_tasks",
    )


class ReportArtifactDB(Base):
    __tablename__ = "report_artifacts"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    report_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("reports.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    kind: Mapped[str] = mapped_column(String(32), nullable=False, default="bundle")
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    content: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    report_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    graph_node_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    graph_edge_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    accepted_command_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    accepted_command_ids: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    manifest_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)

    report: Mapped[ReportDB] = relationship("ReportDB", back_populates="artifacts")
