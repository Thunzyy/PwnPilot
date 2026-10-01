"""add living write-up tables

Revision ID: 9f2c1d4a7b10
Revises: 6d5f9e7a1c42
Create Date: 2026-04-21 22:05:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "9f2c1d4a7b10"
down_revision: str | None = "6d5f9e7a1c42"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "reports",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("project_id", sa.String(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("markdown_path", sa.String(length=500), nullable=True),
        sa.Column("current_revision", sa.Integer(), nullable=False),
        sa.Column("last_evaluated_at", sa.DateTime(), nullable=True),
        sa.Column("last_accepted_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id"),
    )
    op.create_index("ix_reports_project_id", "reports", ["project_id"], unique=True)

    op.create_table(
        "report_sections",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("report_id", sa.String(), nullable=False),
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("content_md", sa.Text(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["report_id"], ["reports.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("report_id", "key", name="uq_report_sections_report_key"),
    )
    op.create_index("ix_report_sections_report_id", "report_sections", ["report_id"], unique=False)

    op.create_table(
        "report_update_proposals",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("report_id", sa.String(), nullable=False),
        sa.Column("trigger_type", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["report_id"], ["reports.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_report_update_proposals_report_id",
        "report_update_proposals",
        ["report_id"],
        unique=False,
    )
    op.create_index(
        "ix_report_update_proposals_status",
        "report_update_proposals",
        ["status"],
        unique=False,
    )
    op.create_index(
        "ix_report_proposals_report_status_created",
        "report_update_proposals",
        ["report_id", "status", "created_at"],
        unique=False,
    )

    op.create_table(
        "report_update_section_patches",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("proposal_id", sa.String(), nullable=False),
        sa.Column("section_key", sa.String(length=64), nullable=False),
        sa.Column("content_md", sa.Text(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["proposal_id"], ["report_update_proposals.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_report_update_section_patches_proposal_id",
        "report_update_section_patches",
        ["proposal_id"],
        unique=False,
    )
    op.create_index(
        "ix_report_update_section_patches_section_key",
        "report_update_section_patches",
        ["section_key"],
        unique=False,
    )

    op.create_table(
        "report_evidence_links",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("proposal_id", sa.String(), nullable=False),
        sa.Column("patch_id", sa.String(), nullable=True),
        sa.Column("source_type", sa.String(length=32), nullable=False),
        sa.Column("source_id", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["patch_id"], ["report_update_section_patches.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["proposal_id"], ["report_update_proposals.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_report_evidence_links_proposal_id",
        "report_evidence_links",
        ["proposal_id"],
        unique=False,
    )
    op.create_index(
        "ix_report_evidence_links_patch_id",
        "report_evidence_links",
        ["patch_id"],
        unique=False,
    )
    op.create_index(
        "ix_report_evidence_links_source_type",
        "report_evidence_links",
        ["source_type"],
        unique=False,
    )
    op.create_index(
        "ix_report_evidence_links_source_id",
        "report_evidence_links",
        ["source_id"],
        unique=False,
    )
    op.create_index(
        "ix_report_evidence_links_proposal_source",
        "report_evidence_links",
        ["proposal_id", "source_type", "source_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_report_evidence_links_proposal_source", table_name="report_evidence_links")
    op.drop_index("ix_report_evidence_links_source_id", table_name="report_evidence_links")
    op.drop_index("ix_report_evidence_links_source_type", table_name="report_evidence_links")
    op.drop_index("ix_report_evidence_links_patch_id", table_name="report_evidence_links")
    op.drop_index("ix_report_evidence_links_proposal_id", table_name="report_evidence_links")
    op.drop_table("report_evidence_links")

    op.drop_index(
        "ix_report_update_section_patches_section_key",
        table_name="report_update_section_patches",
    )
    op.drop_index(
        "ix_report_update_section_patches_proposal_id",
        table_name="report_update_section_patches",
    )
    op.drop_table("report_update_section_patches")

    op.drop_index(
        "ix_report_proposals_report_status_created",
        table_name="report_update_proposals",
    )
    op.drop_index("ix_report_update_proposals_status", table_name="report_update_proposals")
    op.drop_index("ix_report_update_proposals_report_id", table_name="report_update_proposals")
    op.drop_table("report_update_proposals")

    op.drop_index("ix_report_sections_report_id", table_name="report_sections")
    op.drop_table("report_sections")

    op.drop_index("ix_reports_project_id", table_name="reports")
    op.drop_table("reports")
