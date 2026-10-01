from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

GraphSource = Literal["stored", "derived"]
GraphNodeType = Literal[
    "host",
    "service",
    "credential",
    "session",
    "finding",
    "loot",
    "user",
    "action",
    "artifact",
]
GraphEdgeKind = Literal[
    "runs_on",
    "discovered_by",
    "exploited_via",
    "obtained",
    "authenticates_to",
    "opens_session_on",
    "escalated_to",
    "pivots_to",
    "in_network",
    "related_to",
    "member_of",
]
GraphExportFormat = Literal["markdown"]


class GraphPosition(BaseModel):
    x: float
    y: float


class GraphNodePositionUpdate(BaseModel):
    position: GraphPosition


class GraphNode(BaseModel):
    id: str
    project_id: str
    type: GraphNodeType
    label: str = Field(..., min_length=1, max_length=255)
    created_at: datetime
    updated_at: datetime
    created_by: Literal["user", "ai", "rule", "import"] = "import"
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    sequence_index: int = Field(default=0, ge=0)
    source_step_ids: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    notes: str | None = None
    position: GraphPosition | None = None
    meta: dict = Field(default_factory=dict)


class GraphEdge(BaseModel):
    id: str
    project_id: str
    source_id: str
    target_id: str
    kind: GraphEdgeKind
    source_step_id: str | None = None
    command: str | None = None
    tool: str | None = None
    created_at: datetime
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    sequence_index: int = Field(default=0, ge=0)
    label: str | None = None
    meta: dict = Field(default_factory=dict)


class GraphScenario(BaseModel):
    id: str
    project_id: str
    name: str
    description: str | None = None
    color: str
    is_active: bool = False
    node_ids: list[str] = Field(default_factory=list)
    edge_ids: list[str] = Field(default_factory=list)


class GraphResponse(BaseModel):
    project_id: str
    source: GraphSource = "stored"
    nodes: list[GraphNode] = Field(default_factory=list)
    edges: list[GraphEdge] = Field(default_factory=list)
    scenarios: list[GraphScenario] = Field(default_factory=list)
    active_scenario_id: str | None = None


class GraphPath(BaseModel):
    node_ids: list[str] = Field(default_factory=list)
    edge_ids: list[str] = Field(default_factory=list)
    nodes: list[GraphNode] = Field(default_factory=list)
    edges: list[GraphEdge] = Field(default_factory=list)


class GraphPathsResponse(BaseModel):
    project_id: str
    paths: list[GraphPath] = Field(default_factory=list)


class GraphExportPathRequest(BaseModel):
    node_ids: list[str] = Field(default_factory=list)
    edge_ids: list[str] | None = None
    format: GraphExportFormat = "markdown"
    include_terminal_output: bool = True
    include_notes: bool = True
    include_ai_summary: bool = False


class GraphExportResponse(BaseModel):
    format: GraphExportFormat = "markdown"
    content: str


class GraphBatchNodeCreate(BaseModel):
    type: GraphNodeType
    label: str = Field(..., min_length=1, max_length=255)
    created_by: Literal["user", "ai", "rule", "import"] = "import"
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    source_step_ids: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    notes: str | None = None
    position: GraphPosition | None = None
    meta: dict = Field(default_factory=dict)


class GraphBatchEdgeCreate(BaseModel):
    source_id: str | None = None
    target_id: str | None = None
    source_ref: str | None = None
    target_ref: str | None = None
    kind: GraphEdgeKind
    source_step_id: str | None = None
    command: str | None = None
    tool: str | None = None
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    label: str | None = None
    meta: dict = Field(default_factory=dict)


class GraphBatchRequest(BaseModel):
    nodes: list[GraphBatchNodeCreate] = Field(default_factory=list)
    edges: list[GraphBatchEdgeCreate] = Field(default_factory=list)
    source_step_id: str | None = None


class GraphBatchResponse(BaseModel):
    created_node_ids: list[str] = Field(default_factory=list)
    created_edge_ids: list[str] = Field(default_factory=list)
