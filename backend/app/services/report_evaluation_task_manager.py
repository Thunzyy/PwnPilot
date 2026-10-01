from __future__ import annotations

import asyncio
from contextlib import suppress
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, delete, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import settings
from app.core.logging import get_logger
from app.database import async_session_maker
from app.models.app_settings import AppSettings
from app.models.report import ReportEvaluationTaskDB
from app.services.report_generation_service import ReportGenerationService

log = get_logger("service.report_evaluation_task_manager")

DEFAULT_LEASE_SECONDS = 30.0
DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 10.0
DEFAULT_RECLAIM_POLL_INTERVAL_SECONDS = 15.0
DEFAULT_MAX_RUNTIME_SECONDS = 300.0


def utc_now() -> datetime:
    return datetime.now(UTC)


def ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


@dataclass
class ReportEvaluationTask:
    task_id: str
    project_id: str
    user_id: str
    trigger_type: str
    target_section_keys: list[str] | None = None
    status: str = "queued"
    proposal_id: str | None = None
    error: str | None = None
    created_at: datetime = field(default_factory=utc_now)
    started_at: datetime | None = None
    completed_at: datetime | None = None


@dataclass(frozen=True)
class ReportEvaluationRuntimeConfig:
    lease_seconds: float
    heartbeat_interval_seconds: float
    reclaim_poll_interval_seconds: float
    max_runtime_seconds: float | None = None

    @property
    def lease_duration(self) -> timedelta:
        return timedelta(seconds=self.lease_seconds)

    @property
    def max_runtime_duration(self) -> timedelta | None:
        if self.max_runtime_seconds is None or self.max_runtime_seconds <= 0:
            return None
        return timedelta(seconds=self.max_runtime_seconds)


class ReportEvaluationTaskManager:
    def __init__(
        self,
        *,
        session_maker: async_sessionmaker[AsyncSession] = async_session_maker,
        result_ttl_seconds: int = 900,
        lease_seconds: float | None = None,
        heartbeat_interval_seconds: float | None = None,
        reclaim_poll_interval_seconds: float | None = None,
        max_runtime_seconds: float | None = None,
    ) -> None:
        self._session_maker = session_maker
        self._result_ttl = timedelta(seconds=result_ttl_seconds)
        self._default_runtime = ReportEvaluationRuntimeConfig(
            lease_seconds=self._coalesce_setting(
                lease_seconds,
                "report_evaluation_lease_seconds",
                DEFAULT_LEASE_SECONDS,
            ),
            heartbeat_interval_seconds=self._coalesce_setting(
                heartbeat_interval_seconds,
                "report_evaluation_heartbeat_interval_seconds",
                DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
            ),
            reclaim_poll_interval_seconds=self._coalesce_setting(
                reclaim_poll_interval_seconds,
                "report_evaluation_reclaim_poll_interval_seconds",
                DEFAULT_RECLAIM_POLL_INTERVAL_SECONDS,
            ),
            max_runtime_seconds=self._coalesce_setting(
                max_runtime_seconds,
                "report_evaluation_max_runtime_seconds",
                DEFAULT_MAX_RUNTIME_SECONDS,
            ),
        )
        self._lease_duration = self._default_runtime.lease_duration
        self._heartbeat_interval_seconds = self._default_runtime.heartbeat_interval_seconds
        self._reclaim_poll_interval_seconds = (
            self._default_runtime.reclaim_poll_interval_seconds
        )
        self._max_runtime = self._default_runtime.max_runtime_duration
        self._submit_locks: dict[str, asyncio.Lock] = {}
        self._active_tasks: dict[str, set[asyncio.Task[None]]] = {}
        self._reclaimer_task: asyncio.Task[None] | None = None
        self._reclaimer_stop: asyncio.Event | None = None

    async def submit(
        self,
        *,
        project_id: str,
        user_id: str,
        trigger_type: str,
        target_section_keys: list[str] | None = None,
    ) -> ReportEvaluationTask:
        normalized_target_section_keys = self._normalize_target_section_keys(target_section_keys)
        lock = self._submit_locks.setdefault(project_id, asyncio.Lock())
        async with lock:
            await self._cleanup_stale_tasks()
            async with self._session_maker() as db:
                existing = await self._find_inflight_task(
                    db,
                    project_id=project_id,
                    target_section_keys=normalized_target_section_keys,
                )
                if existing is not None:
                    self._schedule_task_run(existing.id)
                    return self._to_task(existing)

                row = ReportEvaluationTaskDB(
                    project_id=project_id,
                    user_id=user_id,
                    trigger_type=trigger_type,
                    target_section_keys=normalized_target_section_keys,
                    status="queued",
                )
                db.add(row)
                await db.commit()
                await db.refresh(row)

            self._schedule_task_run(row.id)
            return self._to_task(row)

    async def get_task(
        self,
        task_id: str,
    ) -> ReportEvaluationTask | None:
        await self._cleanup_stale_tasks()
        async with self._session_maker() as db:
            row = await db.get(ReportEvaluationTaskDB, task_id)
            if row is None:
                return None
            return self._to_task(row)

    async def resume_inflight_tasks(self) -> int:
        async with self._session_maker() as db:
            rows = (
                await db.execute(
                    select(ReportEvaluationTaskDB).where(
                        ReportEvaluationTaskDB.status.in_(("queued", "running"))
                    )
                )
            ).scalars().all()

            if not rows:
                return 0

            for row in rows:
                row.status = "queued"
                row.started_at = None
                row.lease_expires_at = None
                row.heartbeat_at = None
                row.completed_at = None
                row.error = None
            await db.commit()
            task_ids = [row.id for row in rows]

        for task_id in task_ids:
            self._schedule_task_run(task_id)
        return len(task_ids)

    async def start_background_reclaimer(self) -> None:
        if self._reclaimer_task is not None and not self._reclaimer_task.done():
            return
        self._reclaimer_stop = asyncio.Event()
        self._reclaimer_task = asyncio.create_task(self._run_reclaimer_loop())

    async def stop_background_reclaimer(self) -> None:
        if self._reclaimer_task is None:
            return
        if self._reclaimer_stop is not None:
            self._reclaimer_stop.set()
        self._reclaimer_task.cancel()
        with suppress(asyncio.CancelledError):
            await self._reclaimer_task
        self._reclaimer_task = None
        self._reclaimer_stop = None

    async def reclaim_expired_tasks(self) -> int:
        now = utc_now()
        async with self._session_maker() as db:
            task_ids = list(
                (
                    await db.execute(
                        select(ReportEvaluationTaskDB.id).where(
                            ReportEvaluationTaskDB.status == "running",
                            ReportEvaluationTaskDB.lease_expires_at.is_not(None),
                            ReportEvaluationTaskDB.lease_expires_at < now,
                        )
                    )
                ).scalars().all()
            )

        for task_id in task_ids:
            self._schedule_task_run(task_id, allow_parallel_reclaim=True)
        return len(task_ids)

    def _schedule_task_run(self, task_id: str, *, allow_parallel_reclaim: bool = False) -> None:
        existing = {
            task
            for task in self._active_tasks.get(task_id, set())
            if not task.done()
        }
        if existing and not allow_parallel_reclaim:
            self._active_tasks[task_id] = existing
            return
        if existing:
            self._active_tasks[task_id] = existing
        else:
            self._active_tasks.pop(task_id, None)

        task = asyncio.create_task(self._run_task(task_id))
        task_set = self._active_tasks.setdefault(task_id, set())
        task_set.add(task)

        def _cleanup(_done: asyncio.Task[None], *, key: str = task_id, current: asyncio.Task[None] = task):
            tasks = self._active_tasks.get(key)
            if tasks is None:
                return
            tasks.discard(current)
            if not tasks:
                self._active_tasks.pop(key, None)

        task.add_done_callback(_cleanup)

    async def _run_task(self, task_id: str) -> None:
        async with self._session_maker() as db:
            claimed = await self._claim_task(db, task_id)
            if claimed is None:
                return
            row, runtime = claimed

            lease_version = row.lease_version
            stop_heartbeat = asyncio.Event()
            heartbeat_task = asyncio.create_task(
                self._heartbeat_loop(
                    task_id,
                    lease_version,
                    row.started_at or utc_now(),
                    runtime,
                    stop_heartbeat,
                )
            )
            try:
                proposal = await ReportGenerationService(db).generate_update_proposal(
                    project_id=row.project_id,
                    user_id=row.user_id,
                    trigger_type=row.trigger_type,
                    target_section_keys=row.target_section_keys,
                )
                await self._mark_task_terminal(
                    db,
                    task_id=task_id,
                    lease_version=lease_version,
                    status="completed",
                    proposal_id=proposal.id if proposal else None,
                    error=None,
                )
            except Exception as exc:
                await db.rollback()
                updated = await self._mark_task_terminal(
                    db,
                    task_id=task_id,
                    lease_version=lease_version,
                    status="failed",
                    proposal_id=None,
                    error=str(exc),
                )
                if updated:
                    log.warning(
                        "Report evaluation task failed",
                        task_id=task_id,
                        project_id=row.project_id,
                        error=str(exc),
                    )
            finally:
                stop_heartbeat.set()
                heartbeat_task.cancel()
                with suppress(asyncio.CancelledError):
                    await heartbeat_task

    async def _claim_task(
        self,
        db: AsyncSession,
        task_id: str,
    ) -> tuple[ReportEvaluationTaskDB, ReportEvaluationRuntimeConfig] | None:
        runtime = await self._load_runtime_config(db)
        started_at = utc_now()
        lease_expires_at = started_at + runtime.lease_duration
        result = await db.execute(
            update(ReportEvaluationTaskDB)
            .where(
                ReportEvaluationTaskDB.id == task_id,
                or_(
                    ReportEvaluationTaskDB.status == "queued",
                    and_(
                        ReportEvaluationTaskDB.status == "running",
                        ReportEvaluationTaskDB.lease_expires_at.is_not(None),
                        ReportEvaluationTaskDB.lease_expires_at < started_at,
                    ),
                ),
            )
            .values(
                status="running",
                started_at=started_at,
                lease_expires_at=lease_expires_at,
                heartbeat_at=started_at,
                lease_version=ReportEvaluationTaskDB.lease_version + 1,
                completed_at=None,
                error=None,
                proposal_id=None,
                updated_at=started_at,
            )
        )
        await db.commit()
        if result.rowcount == 0:
            return None
        row = await db.get(ReportEvaluationTaskDB, task_id)
        if row is None:
            return None
        return row, runtime

    async def _heartbeat_loop(
        self,
        task_id: str,
        lease_version: int,
        started_at: datetime,
        runtime: ReportEvaluationRuntimeConfig,
        stop_event: asyncio.Event,
    ) -> None:
        if runtime.heartbeat_interval_seconds <= 0:
            return

        normalized_started_at = ensure_utc(started_at)
        while not stop_event.is_set():
            try:
                await asyncio.wait_for(
                    stop_event.wait(),
                    timeout=runtime.heartbeat_interval_seconds,
                )
                return
            except TimeoutError:
                pass

            if (
                runtime.max_runtime_duration is not None
                and utc_now() >= normalized_started_at + runtime.max_runtime_duration
            ):
                log.info(
                    "Report evaluation task reached max runtime; lease renewal stopped",
                    task_id=task_id,
                    lease_version=lease_version,
                )
                return

            renewed = await self._renew_lease(task_id, lease_version, runtime)
            if not renewed:
                return

    async def _renew_lease(
        self,
        task_id: str,
        lease_version: int,
        runtime: ReportEvaluationRuntimeConfig,
    ) -> bool:
        now = utc_now()
        async with self._session_maker() as db:
            result = await db.execute(
                update(ReportEvaluationTaskDB)
                .where(
                    ReportEvaluationTaskDB.id == task_id,
                    ReportEvaluationTaskDB.status == "running",
                    ReportEvaluationTaskDB.lease_version == lease_version,
                )
                .values(
                    heartbeat_at=now,
                    lease_expires_at=now + runtime.lease_duration,
                    updated_at=now,
                )
            )
            await db.commit()
        return result.rowcount > 0

    async def _mark_task_terminal(
        self,
        db: AsyncSession,
        *,
        task_id: str,
        lease_version: int,
        status: str,
        proposal_id: str | None,
        error: str | None,
    ) -> bool:
        completed_at = utc_now()
        result = await db.execute(
            update(ReportEvaluationTaskDB)
            .where(
                ReportEvaluationTaskDB.id == task_id,
                ReportEvaluationTaskDB.status == "running",
                ReportEvaluationTaskDB.lease_version == lease_version,
            )
            .values(
                status=status,
                proposal_id=proposal_id,
                error=error,
                completed_at=completed_at,
                lease_expires_at=None,
                heartbeat_at=completed_at,
                updated_at=completed_at,
            )
        )
        await db.commit()
        if result.rowcount == 0:
            log.info(
                "Stale report evaluation task result ignored",
                task_id=task_id,
                lease_version=lease_version,
                status=status,
            )
            return False
        return True

    async def _run_reclaimer_loop(self) -> None:
        stop_event = self._reclaimer_stop
        if stop_event is None:
            return

        while not stop_event.is_set():
            try:
                await self.reclaim_expired_tasks()
            except Exception as exc:
                log.warning("Failed to reclaim expired report evaluation tasks", error=str(exc))

            try:
                runtime = await self._load_runtime_config()
                await asyncio.wait_for(
                    stop_event.wait(),
                    timeout=runtime.reclaim_poll_interval_seconds,
                )
            except TimeoutError:
                continue

    async def _load_runtime_config(
        self,
        db: AsyncSession | None = None,
    ) -> ReportEvaluationRuntimeConfig:
        settings_row: AppSettings | None = None
        if db is not None:
            settings_row = await db.get(AppSettings, 1)
        else:
            async with self._session_maker() as session:
                settings_row = await session.get(AppSettings, 1)

        return self._merge_runtime_config(settings_row)

    def _merge_runtime_config(
        self,
        settings_row: AppSettings | None,
    ) -> ReportEvaluationRuntimeConfig:
        return ReportEvaluationRuntimeConfig(
            lease_seconds=self._coalesce_positive_override(
                settings_row.report_evaluation_lease_seconds if settings_row else None,
                self._default_runtime.lease_seconds,
            ),
            heartbeat_interval_seconds=self._coalesce_positive_override(
                settings_row.report_evaluation_heartbeat_interval_seconds if settings_row else None,
                self._default_runtime.heartbeat_interval_seconds,
            ),
            reclaim_poll_interval_seconds=self._coalesce_positive_override(
                settings_row.report_evaluation_reclaim_poll_interval_seconds if settings_row else None,
                self._default_runtime.reclaim_poll_interval_seconds,
            ),
            max_runtime_seconds=self._coalesce_max_runtime_override(
                settings_row.report_evaluation_max_runtime_seconds if settings_row else None,
                self._default_runtime.max_runtime_seconds,
            ),
        )

    @staticmethod
    def _coalesce_setting(
        explicit_value: float | None,
        setting_name: str,
        fallback: float,
    ) -> float:
        if explicit_value is not None:
            return explicit_value
        configured = getattr(settings, setting_name, fallback)
        return configured if configured is not None else fallback

    @staticmethod
    def _coalesce_positive_override(value: float | None, fallback: float) -> float:
        if value is None or value <= 0:
            return fallback
        return value

    @staticmethod
    def _coalesce_max_runtime_override(
        value: float | None,
        fallback: float | None,
    ) -> float | None:
        if value is None:
            return fallback
        if value <= 0:
            return None
        return value

    async def _cleanup_stale_tasks(self) -> None:
        cutoff = utc_now() - self._result_ttl
        async with self._session_maker() as db:
            await db.execute(
                delete(ReportEvaluationTaskDB).where(
                    ReportEvaluationTaskDB.completed_at.is_not(None),
                    ReportEvaluationTaskDB.completed_at < cutoff,
                )
            )
            await db.commit()

    @staticmethod
    async def _find_inflight_task(
        db: AsyncSession,
        *,
        project_id: str,
        target_section_keys: list[str] | None,
    ) -> ReportEvaluationTaskDB | None:
        rows = (
            await db.execute(
                select(ReportEvaluationTaskDB)
                .where(
                    ReportEvaluationTaskDB.project_id == project_id,
                    ReportEvaluationTaskDB.status.in_(("queued", "running")),
                )
                .order_by(ReportEvaluationTaskDB.created_at.desc())
            )
        ).scalars().all()
        normalized_target_section_keys = ReportEvaluationTaskManager._normalize_target_section_keys(
            target_section_keys
        )
        for row in rows:
            if (
                ReportEvaluationTaskManager._normalize_target_section_keys(row.target_section_keys)
                == normalized_target_section_keys
            ):
                return row
        return None

    @staticmethod
    def _normalize_target_section_keys(
        section_keys: list[str] | tuple[str, ...] | None,
    ) -> list[str] | None:
        if not section_keys:
            return None
        normalized = sorted({key.strip() for key in section_keys if key and key.strip()})
        return normalized or None

    @staticmethod
    def _to_task(row: ReportEvaluationTaskDB) -> ReportEvaluationTask:
        return ReportEvaluationTask(
            task_id=row.id,
            project_id=row.project_id,
            user_id=row.user_id,
            trigger_type=row.trigger_type,
            target_section_keys=row.target_section_keys,
            status=row.status,
            proposal_id=row.proposal_id,
            error=row.error,
            created_at=row.created_at,
            started_at=row.started_at,
            completed_at=row.completed_at,
        )


report_evaluation_task_manager = ReportEvaluationTaskManager()
