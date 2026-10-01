from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.logging import get_logger
from app.models.command_history import CommandHistory
from app.models.credential import Credential, Flag
from app.models.graph import GraphEdgeDB, GraphNodeDB
from app.models.project_membership import ProjectMembership
from app.models.report import ReportDB
from app.models.timeline import Timeline
from app.services.report_generation_service import ReportGenerationService

log = get_logger("service.report_signal")


def utc_now() -> datetime:
    return datetime.now(UTC)


@dataclass
class PendingReportEvaluation:
    project_id: str
    due_at: datetime
    last_signal_at: datetime
    signal_types: set[str] = field(default_factory=set)
    source_ids: set[str] = field(default_factory=set)


class ReportSignalService:
    def __init__(
        self,
        *,
        debounce_seconds: int = 30,
        periodic_interval_seconds: int = 300,
    ) -> None:
        self.debounce_seconds = debounce_seconds
        self.periodic_interval_seconds = periodic_interval_seconds
        self._pending: dict[str, PendingReportEvaluation] = {}

    def record_signal(
        self,
        project_id: str,
        signal_type: str,
        source_id: str,
        metadata: dict | None = None,
        now: datetime | None = None,
    ) -> datetime:
        del metadata
        current = now or utc_now()
        due_at = current + timedelta(seconds=self.debounce_seconds)
        pending = self._pending.get(project_id)
        if pending is None:
            pending = PendingReportEvaluation(
                project_id=project_id,
                due_at=due_at,
                last_signal_at=current,
            )
            self._pending[project_id] = pending
        else:
            pending.due_at = due_at
            pending.last_signal_at = current

        pending.signal_types.add(signal_type)
        pending.source_ids.add(source_id)
        return pending.due_at

    def list_pending_project_ids(self) -> list[str]:
        return sorted(self._pending.keys())

    def drain_due_projects(self, now: datetime | None = None) -> list[str]:
        current = now or utc_now()
        due = [
            item
            for item in self._pending.values()
            if item.due_at <= current
        ]
        due.sort(key=lambda item: (item.due_at, item.project_id))
        for item in due:
            self._pending.pop(item.project_id, None)
        return [item.project_id for item in due]

    async def run_periodic_review_once(
        self,
        db: AsyncSession,
        *,
        now: datetime | None = None,
    ) -> list[str]:
        current = now or utc_now()
        reports = (
            await db.execute(select(ReportDB).order_by(ReportDB.project_id.asc()))
        ).scalars().all()
        scheduled: list[str] = []
        for report in reports:
            has_new_evidence = await self._project_has_new_evidence(
                db,
                project_id=report.project_id,
                since=report.last_evaluated_at,
            )
            if not has_new_evidence:
                continue
            self.record_signal(
                report.project_id,
                "periodic_review",
                f"periodic:{current.isoformat()}",
                now=current,
            )
            scheduled.append(report.project_id)
        return scheduled

    async def process_due_projects(
        self,
        db: AsyncSession,
        *,
        now: datetime | None = None,
    ) -> list[str]:
        processed: list[str] = []
        for project_id in self.drain_due_projects(now=now):
            user_id = await self._resolve_project_user_id(db, project_id)
            if not user_id:
                continue
            try:
                await ReportGenerationService(db).generate_update_proposal(
                    project_id=project_id,
                    user_id=user_id,
                    trigger_type="signal",
                )
                processed.append(project_id)
            except Exception:
                await db.rollback()
                log.warning("Failed to process report signal", project_id=project_id)
        return processed

    async def run_background_worker(
        self,
        session_maker: async_sessionmaker[AsyncSession],
    ) -> None:
        while True:
            await self._sleep_interval()
            async with session_maker() as db:
                await self.run_periodic_review_once(db)
                await self.process_due_projects(db)

    async def _sleep_interval(self) -> None:
        import asyncio

        await asyncio.sleep(self.periodic_interval_seconds)

    async def _project_has_new_evidence(
        self,
        db: AsyncSession,
        *,
        project_id: str,
        since: datetime | None,
    ) -> bool:
        checks = (
            (CommandHistory, CommandHistory.created_at),
            (Timeline, Timeline.created_at),
            (Credential, Credential.created_at),
            (Flag, Flag.created_at),
            (GraphNodeDB, GraphNodeDB.created_at),
            (GraphEdgeDB, GraphEdgeDB.created_at),
        )
        for model, created_at_field in checks:
            stmt = select(exists().where(model.project_id == project_id))
            if model is GraphNodeDB:
                stmt = select(
                    exists().where(
                        GraphNodeDB.project_id == project_id,
                        GraphNodeDB.is_deleted.is_(False),
                    )
                )
                if since is not None:
                    stmt = select(
                        exists().where(
                            GraphNodeDB.project_id == project_id,
                            GraphNodeDB.is_deleted.is_(False),
                            GraphNodeDB.created_at > since,
                        )
                    )
            elif since is not None:
                stmt = select(
                    exists().where(
                        model.project_id == project_id,
                        created_at_field > since,
                    )
                )
            result = await db.execute(stmt)
            if result.scalar():
                return True
        return False

    async def _resolve_project_user_id(
        self,
        db: AsyncSession,
        project_id: str,
    ) -> str | None:
        result = await db.execute(
            select(ProjectMembership.user_id)
            .where(
                ProjectMembership.project_id == project_id,
                ProjectMembership.status == "active",
            )
            .order_by(ProjectMembership.created_at.asc())
            .limit(1)
        )
        return result.scalar_one_or_none()


report_signal_service = ReportSignalService()
