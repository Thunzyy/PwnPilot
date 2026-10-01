from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.graph.api import GraphBatchResponse

ProposalSourceType = Literal["command_history"]
ProposalStatus = Literal["pending", "accepted", "rejected"]
ProposalAuthor = Literal["rule", "ai", "user"]


class GraphProposal(BaseModel):
    id: str
    project_id: str
    source_type: ProposalSourceType
    source_id: str | None = None
    proposed_by: ProposalAuthor
    status: ProposalStatus
    title: str | None = None
    summary: str | None = None
    payload: dict = Field(default_factory=dict)
    created_at: datetime
    resolved_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class GraphProposalListResponse(BaseModel):
    items: list[GraphProposal] = Field(default_factory=list)
    total: int = 0


class GraphProposalAcceptResponse(BaseModel):
    proposal: GraphProposal
    graph_batch: GraphBatchResponse
