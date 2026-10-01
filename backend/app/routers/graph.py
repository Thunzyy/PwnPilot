from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_project_member
from app.database import get_db
from app.models.project import Project
from app.schemas.graph import (
    GraphBatchRequest,
    GraphBatchResponse,
    GraphExportPathRequest,
    GraphExportResponse,
    GraphNode,
    GraphNodePositionUpdate,
    GraphPathsResponse,
    GraphProposalAcceptResponse,
    GraphProposalListResponse,
    GraphResponse,
)
from app.services.graph_export_service import GraphExportService
from app.services.graph_proposal_service import GraphProposalService
from app.services.graph_service import GraphService

router = APIRouter(prefix="/projects/{project_id}/graph", tags=["graph"])


@router.get("", response_model=GraphResponse)
async def get_project_graph(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(require_project_member),
):
    del project
    service = GraphService(db)
    return await service.get_graph(project_id)


@router.post("/demo-ctf", response_model=GraphResponse)
async def seed_project_graph_demo_ctf(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(require_project_member),
    current_user=Depends(get_current_user),
):
    del project_id
    service = GraphService(db)
    return await service.seed_demo_ctf(project, user_id=current_user.id)


@router.get("/paths", response_model=GraphPathsResponse)
async def get_project_graph_paths(
    project_id: str,
    from_id: str = Query(..., alias="from"),
    to_id: str = Query(..., alias="to"),
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(require_project_member),
):
    del project
    service = GraphService(db)
    return await service.get_shortest_paths(
        project_id=project_id,
        from_id=from_id,
        to_id=to_id,
    )


@router.post("/export-path", response_model=GraphExportResponse)
async def export_project_graph_path(
    project_id: str,
    payload: GraphExportPathRequest,
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(require_project_member),
    current_user=Depends(get_current_user),
):
    del project_id
    service = GraphExportService(db)
    try:
        return await service.export_path(
            project=project,
            user_id=current_user.id,
            request=payload,
        )
    except OverflowError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/batch", response_model=GraphBatchResponse)
async def create_project_graph_batch(
    project_id: str,
    payload: GraphBatchRequest,
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(require_project_member),
):
    del project
    service = GraphService(db)
    try:
        return await service.create_batch(project_id=project_id, payload=payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/proposals", response_model=GraphProposalListResponse)
async def list_project_graph_proposals(
    project_id: str,
    status: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(require_project_member),
):
    del project
    service = GraphProposalService(db)
    items = await service.list_proposals(project_id=project_id, status=status)
    return GraphProposalListResponse(items=items, total=len(items))


@router.post("/proposals/from-history/{command_id}", response_model=GraphProposalListResponse)
async def create_project_graph_proposals_from_history(
    project_id: str,
    command_id: str,
    response: Response,
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(require_project_member),
):
    del project
    service = GraphProposalService(db)
    try:
        items, created = await service.propose_from_command_history(
            project_id=project_id,
            command_id=command_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    response.status_code = 201 if created else 200
    return GraphProposalListResponse(items=items, total=len(items))


@router.post("/proposals/{proposal_id}/accept", response_model=GraphProposalAcceptResponse)
async def accept_project_graph_proposal(
    project_id: str,
    proposal_id: str,
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(require_project_member),
):
    del project
    service = GraphProposalService(db)
    try:
        return await service.accept_proposal(project_id=project_id, proposal_id=proposal_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/nodes/{node_id}", response_model=GraphNode)
async def update_graph_node_position(
    project_id: str,
    node_id: str,
    payload: GraphNodePositionUpdate,
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(require_project_member),
):
    del project
    service = GraphService(db)
    try:
        return await service.update_node_position(
            project_id=project_id,
            node_id=node_id,
            position=payload.position,
        )
    except ValueError:
        raise HTTPException(status_code=404, detail="Graph node not found")
