from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_project_member
from app.database import get_db
from app.models.timeline import Timeline

router = APIRouter(prefix="/projects/{project_id}/timeline", tags=["timeline"])


class TimelineCreate(BaseModel):
    type: str = "note"
    content: str
    output: str | None = None
    entry_data: dict = {}


class TimelineResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    type: str
    content: str
    output: str | None
    entry_data: dict
    created_at: datetime

@router.get("", response_model=list[TimelineResponse])
async def get_timeline(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    _project=Depends(require_project_member),
):
    result = await db.execute(
        select(Timeline).where(Timeline.project_id == project_id).order_by(Timeline.created_at.desc())
    )
    return result.scalars().all()


@router.post("", response_model=TimelineResponse, status_code=201)
async def add_timeline_entry(
    project_id: str,
    entry: TimelineCreate,
    db: AsyncSession = Depends(get_db),
    _project=Depends(require_project_member),
):
    db_entry = Timeline(project_id=project_id, **entry.model_dump())
    db.add(db_entry)
    await db.commit()
    await db.refresh(db_entry)
    return db_entry


@router.delete("/{entry_id}", status_code=204)
async def delete_timeline_entry(
    project_id: str,
    entry_id: str,
    db: AsyncSession = Depends(get_db),
    _project=Depends(require_project_member),
):
    result = await db.execute(
        select(Timeline).where(Timeline.id == entry_id, Timeline.project_id == project_id)
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    await db.delete(entry)
    await db.commit()
