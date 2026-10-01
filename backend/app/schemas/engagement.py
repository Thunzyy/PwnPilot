"""Schemas for project engagement state (sidebar + attack graph)."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

ChecklistItemStatus = Literal["pending", "active", "done"]
GraphNodeType = Literal["initial", "action", "success", "failure"]
GraphNodeStatus = Literal["success", "failure"]
GraphEdgeKind = Literal["sequence", "phase-transition"]
GraphEdgeBranch = Literal["success", "failure"]
EngagementStateVersion = Literal["v1"]
EngagementStateSource = Literal["stored", "derived"]


class EngagementChecklistItem(BaseModel):
    id: str
    label: str = Field(..., min_length=1, max_length=240)
    status: ChecklistItemStatus
    evidence_count: int = Field(default=0, ge=0)
    last_seen_at: datetime | None = None
    success_count: int = Field(default=0, ge=0)
    failure_count: int = Field(default=0, ge=0)


class EngagementChecklistSection(BaseModel):
    id: str
    label: str = Field(..., min_length=1, max_length=120)
    icon: str | None = None
    is_open: bool = False
    items: list[EngagementChecklistItem] = Field(default_factory=list)


class EngagementGraphNodePosition(BaseModel):
    x: str
    y: str


class EngagementGraphNode(BaseModel):
    id: str
    type: GraphNodeType
    status: GraphNodeStatus | None = None
    title: str = Field(..., min_length=1, max_length=240)
    subtitle: str = Field(..., min_length=1, max_length=120)
    icon: str = Field(..., min_length=1, max_length=64)
    position: EngagementGraphNodePosition
    section_id: str | None = None
    item_id: str | None = None


class EngagementGraphEdge(BaseModel):
    id: str
    source_id: str
    target_id: str
    kind: GraphEdgeKind = "sequence"
    branch: GraphEdgeBranch | None = None


class EngagementGraph(BaseModel):
    nodes: list[EngagementGraphNode] = Field(default_factory=list)
    edges: list[EngagementGraphEdge] = Field(default_factory=list)


class EngagementStateBase(BaseModel):
    version: EngagementStateVersion = "v1"
    sections: list[EngagementChecklistSection] = Field(default_factory=list)
    graph: EngagementGraph = Field(default_factory=EngagementGraph)
    progress: int = Field(default=0, ge=0, le=100)


class EngagementStateResponse(EngagementStateBase):
    source: EngagementStateSource
