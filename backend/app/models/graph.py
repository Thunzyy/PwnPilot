import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def utc_now() -> datetime:
    return datetime.now(UTC)


class GraphNodeDB(Base):
    __tablename__ = "graph_nodes"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(
        String, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)
    created_by: Mapped[str] = mapped_column(String(16), default="import")
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    sequence_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    source_step_ids: Mapped[list] = mapped_column(JSON, default=list)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    position_x: Mapped[float | None] = mapped_column(Float, nullable=True)
    position_y: Mapped[float | None] = mapped_column(Float, nullable=True)
    meta_json: Mapped[dict] = mapped_column(JSON, default=dict)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)


class GraphEdgeDB(Base):
    __tablename__ = "graph_edges"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(
        String, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source_id: Mapped[str] = mapped_column(
        String, ForeignKey("graph_nodes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    target_id: Mapped[str] = mapped_column(
        String, ForeignKey("graph_nodes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    source_step_id: Mapped[str | None] = mapped_column(String, nullable=True)
    command: Mapped[str | None] = mapped_column(Text, nullable=True)
    tool: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    sequence_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    meta_json: Mapped[dict] = mapped_column(JSON, default=dict)


class GraphScenarioDB(Base):
    __tablename__ = "graph_scenarios"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(
        String, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    color: Mapped[str] = mapped_column(String(24), default="#38bdf8")
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class GraphScenarioNodeDB(Base):
    __tablename__ = "graph_scenario_nodes"
    __table_args__ = (
        UniqueConstraint("scenario_id", "node_id", name="uq_graph_scenario_node"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    scenario_id: Mapped[str] = mapped_column(
        String, ForeignKey("graph_scenarios.id", ondelete="CASCADE"), nullable=False, index=True
    )
    node_id: Mapped[str] = mapped_column(
        String, ForeignKey("graph_nodes.id", ondelete="CASCADE"), nullable=False, index=True
    )


class GraphScenarioEdgeDB(Base):
    __tablename__ = "graph_scenario_edges"
    __table_args__ = (
        UniqueConstraint("scenario_id", "edge_id", name="uq_graph_scenario_edge"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    scenario_id: Mapped[str] = mapped_column(
        String, ForeignKey("graph_scenarios.id", ondelete="CASCADE"), nullable=False, index=True
    )
    edge_id: Mapped[str] = mapped_column(
        String, ForeignKey("graph_edges.id", ondelete="CASCADE"), nullable=False, index=True
    )
