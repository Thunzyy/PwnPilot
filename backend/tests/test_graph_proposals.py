import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.graph_proposals import GraphEntityProposalDB


@pytest.mark.anyio
async def test_graph_proposal_round_trip(test_db: AsyncSession):
    proposal = GraphEntityProposalDB(
        id=str(uuid.uuid4()),
        project_id=str(uuid.uuid4()),
        proposed_by="rule",
        status="pending",
        payload={"type": "host", "ip": "10.10.10.5"},
    )
    test_db.add(proposal)
    await test_db.commit()

    fetched = await test_db.get(GraphEntityProposalDB, proposal.id)

    assert fetched is not None
    assert fetched.payload["ip"] == "10.10.10.5"
