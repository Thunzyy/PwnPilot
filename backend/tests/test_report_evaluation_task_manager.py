from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.database import Base, init_fts_tables
from app.models.app_settings import AppSettings
from app.models.project import Project
from app.models.report import ReportDB, ReportEvaluationTaskDB, ReportUpdateProposalDB
from app.models.user import User
from app.services import report_evaluation_task_manager as report_eval_module
from app.services.report_evaluation_task_manager import ReportEvaluationTaskManager


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


@pytest.fixture
async def manager_db(tmp_path: Path):
    database_path = tmp_path / "report-eval-tasks.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{database_path.as_posix()}", echo=False)
    session_maker = async_sessionmaker(engine, expire_on_commit=False)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await init_fts_tables(conn)

    async with session_maker() as session:
        session.add_all(
            [
                User(
                    id="user-1",
                    username="user1",
                    email="user1@example.com",
                    password_hash="hash",
                ),
                Project(
                    id="project-1",
                    name="Cap",
                    slug="cap-project-1",
                    type="htb",
                    workspace_path=str(tmp_path / "workspace"),
                ),
            ]
        )
        await session.commit()

    try:
        yield session_maker
    finally:
        await engine.dispose()


@pytest.mark.anyio
async def test_submit_persists_task_and_reuses_existing_inflight_row(
    manager_db,
    monkeypatch: pytest.MonkeyPatch,
):
    manager = ReportEvaluationTaskManager(session_maker=manager_db)
    monkeypatch.setattr(manager, "_schedule_task_run", lambda task_id: None)

    first = await manager.submit(
        project_id="project-1",
        user_id="user-1",
        trigger_type="manual",
    )
    second = await manager.submit(
        project_id="project-1",
        user_id="user-1",
        trigger_type="manual",
    )

    async with manager_db() as session:
        rows = (
            await session.execute(
                select(ReportEvaluationTaskDB).order_by(ReportEvaluationTaskDB.created_at.asc())
            )
        ).scalars().all()

    assert second.task_id == first.task_id
    assert len(rows) == 1
    assert rows[0].status == "queued"


def test_manager_uses_app_setting_for_default_max_runtime(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        report_eval_module,
        "settings",
        SimpleNamespace(report_evaluation_max_runtime_seconds=123.5),
        raising=False,
    )

    manager = ReportEvaluationTaskManager(max_runtime_seconds=None)

    assert manager._max_runtime == timedelta(seconds=123.5)


@pytest.mark.anyio
async def test_manager_uses_db_runtime_overrides_when_constructor_uses_defaults(
    manager_db,
    monkeypatch: pytest.MonkeyPatch,
):
    async with manager_db() as session:
        session.add(
            AppSettings(
                id=1,
                report_evaluation_lease_seconds=0.05,
                report_evaluation_heartbeat_interval_seconds=0.01,
                report_evaluation_reclaim_poll_interval_seconds=0.02,
                report_evaluation_max_runtime_seconds=0.07,
            )
        )
        await session.commit()

    monkeypatch.setattr(
        report_eval_module,
        "settings",
        SimpleNamespace(
            report_evaluation_lease_seconds=30.0,
            report_evaluation_heartbeat_interval_seconds=10.0,
            report_evaluation_reclaim_poll_interval_seconds=15.0,
            report_evaluation_max_runtime_seconds=300.0,
        ),
        raising=False,
    )

    started = asyncio.Event()
    release = asyncio.Event()

    async def fake_generate(
        self,
        project_id: str,
        user_id: str,
        trigger_type: str,
        target_section_keys: list[str] | None = None,
    ):
        del self
        assert project_id == "project-1"
        assert user_id == "user-1"
        assert trigger_type == "manual"
        assert target_section_keys is None
        started.set()
        await release.wait()
        return None

    monkeypatch.setattr(
        "app.services.report_evaluation_task_manager.ReportGenerationService.generate_update_proposal",
        fake_generate,
    )

    manager = ReportEvaluationTaskManager(session_maker=manager_db)
    monkeypatch.setattr(manager, "_schedule_task_run", lambda task_id: None)
    task = await manager.submit(
        project_id="project-1",
        user_id="user-1",
        trigger_type="manual",
    )

    runner = asyncio.create_task(manager._run_task(task.task_id))
    await started.wait()
    await asyncio.sleep(0.13)

    async with manager_db() as session:
        stored = await session.get(ReportEvaluationTaskDB, task.task_id)

    assert stored is not None
    assert stored.status == "running"
    assert stored.lease_expires_at is not None
    assert _as_utc(stored.lease_expires_at) < datetime.now(UTC)

    release.set()
    await runner


@pytest.mark.anyio
async def test_submit_reschedules_existing_inflight_row(
    manager_db,
    monkeypatch: pytest.MonkeyPatch,
):
    async with manager_db() as session:
        session.add(
            ReportEvaluationTaskDB(
                id="task-existing",
                project_id="project-1",
                user_id="user-1",
                trigger_type="manual",
                status="queued",
            )
        )
        await session.commit()

    scheduled: list[str] = []
    manager = ReportEvaluationTaskManager(session_maker=manager_db)
    monkeypatch.setattr(manager, "_schedule_task_run", lambda task_id: scheduled.append(task_id))

    task = await manager.submit(
        project_id="project-1",
        user_id="user-1",
        trigger_type="manual",
    )

    assert task.task_id == "task-existing"
    assert scheduled == ["task-existing"]


@pytest.mark.anyio
async def test_submit_persists_target_sections_and_resume_keeps_them(
    manager_db,
    monkeypatch: pytest.MonkeyPatch,
):
    scheduled: list[str] = []
    manager = ReportEvaluationTaskManager(session_maker=manager_db)
    monkeypatch.setattr(manager, "_schedule_task_run", lambda task_id: scheduled.append(task_id))

    task = await manager.submit(
        project_id="project-1",
        user_id="user-1",
        trigger_type="manual",
        target_section_keys=["privilege_escalation"],
    )

    async with manager_db() as session:
        stored = await session.get(ReportEvaluationTaskDB, task.task_id)

    assert stored is not None
    assert stored.target_section_keys == ["privilege_escalation"]

    resumed = await manager.resume_inflight_tasks()

    async with manager_db() as session:
        stored_after_resume = await session.get(ReportEvaluationTaskDB, task.task_id)

    assert resumed == 1
    assert scheduled == [task.task_id, task.task_id]
    assert stored_after_resume is not None
    assert stored_after_resume.status == "queued"
    assert stored_after_resume.target_section_keys == ["privilege_escalation"]


@pytest.mark.anyio
async def test_run_task_persists_completed_status_and_proposal_id(
    manager_db,
    monkeypatch: pytest.MonkeyPatch,
):
    async with manager_db() as session:
        report = ReportDB(project_id="project-1", title="Cap")
        proposal = ReportUpdateProposalDB(
            report=report,
            trigger_type="manual",
            status="pending",
            summary="Existing proposal",
        )
        session.add_all([report, proposal])
        await session.commit()
        await session.refresh(proposal)

    async def fake_generate(
        self,
        project_id: str,
        user_id: str,
        trigger_type: str,
        target_section_keys: list[str] | None = None,
    ):
        del self
        assert project_id == "project-1"
        assert user_id == "user-1"
        assert trigger_type == "manual"
        assert target_section_keys is None
        return SimpleNamespace(id=proposal.id)

    monkeypatch.setattr(
        "app.services.report_evaluation_task_manager.ReportGenerationService.generate_update_proposal",
        fake_generate,
    )

    manager = ReportEvaluationTaskManager(session_maker=manager_db)
    monkeypatch.setattr(manager, "_schedule_task_run", lambda task_id: None)
    task = await manager.submit(
        project_id="project-1",
        user_id="user-1",
        trigger_type="manual",
    )

    await manager._run_task(task.task_id)
    stored = await manager.get_task(task.task_id)

    assert stored is not None
    assert stored.status == "completed"
    assert stored.proposal_id == proposal.id


@pytest.mark.anyio
async def test_resume_inflight_tasks_requeues_and_schedules_rows(
    manager_db,
    monkeypatch: pytest.MonkeyPatch,
):
    stale_time = datetime.now(UTC) - timedelta(minutes=5)
    async with manager_db() as session:
        session.add_all(
            [
                ReportEvaluationTaskDB(
                    id="task-queued",
                    project_id="project-1",
                    user_id="user-1",
                    trigger_type="manual",
                    status="queued",
                    created_at=stale_time,
                ),
                ReportEvaluationTaskDB(
                    id="task-running",
                    project_id="project-1",
                    user_id="user-1",
                    trigger_type="manual",
                    status="running",
                    created_at=stale_time,
                    started_at=stale_time,
                    error="old error",
                ),
            ]
        )
        await session.commit()

    manager = ReportEvaluationTaskManager(session_maker=manager_db)
    scheduled: list[str] = []
    monkeypatch.setattr(manager, "_schedule_task_run", lambda task_id: scheduled.append(task_id))
    resumed = await manager.resume_inflight_tasks()

    async with manager_db() as session:
        queued = await session.get(ReportEvaluationTaskDB, "task-queued")
        running = await session.get(ReportEvaluationTaskDB, "task-running")

    assert resumed == 2
    assert scheduled == ["task-queued", "task-running"]
    assert queued is not None
    assert queued.status == "queued"
    assert queued.started_at is None
    assert queued.completed_at is None
    assert running is not None
    assert running.status == "queued"
    assert running.started_at is None
    assert running.error is None
    assert running.completed_at is None


@pytest.mark.anyio
async def test_only_one_worker_claims_and_executes_same_queued_task(
    manager_db,
    monkeypatch: pytest.MonkeyPatch,
):
    async with manager_db() as session:
        session.add(
            ReportEvaluationTaskDB(
                id="task-shared",
                project_id="project-1",
                user_id="user-1",
                trigger_type="manual",
                status="queued",
            )
        )
        await session.commit()

    started = asyncio.Event()
    release = asyncio.Event()
    call_count = 0

    async def fake_generate(
        self,
        project_id: str,
        user_id: str,
        trigger_type: str,
        target_section_keys: list[str] | None = None,
    ):
        nonlocal call_count
        del self
        call_count += 1
        assert project_id == "project-1"
        assert user_id == "user-1"
        assert trigger_type == "manual"
        assert target_section_keys is None
        started.set()
        await release.wait()
        return None

    monkeypatch.setattr(
        "app.services.report_evaluation_task_manager.ReportGenerationService.generate_update_proposal",
        fake_generate,
    )

    manager_a = ReportEvaluationTaskManager(session_maker=manager_db)
    manager_b = ReportEvaluationTaskManager(session_maker=manager_db)

    task_a = asyncio.create_task(manager_a._run_task("task-shared"))
    task_b = asyncio.create_task(manager_b._run_task("task-shared"))

    await started.wait()
    await asyncio.sleep(0.05)
    release.set()
    await asyncio.gather(task_a, task_b)

    async with manager_db() as session:
        stored = await session.get(ReportEvaluationTaskDB, "task-shared")

    assert call_count == 1
    assert stored is not None
    assert stored.status == "completed"


@pytest.mark.anyio
async def test_expired_running_task_is_reclaimed_and_stale_worker_cannot_overwrite_result(
    manager_db,
    monkeypatch: pytest.MonkeyPatch,
):
    expired_time = datetime.now(UTC) - timedelta(minutes=5)
    async with manager_db() as session:
        report = ReportDB(project_id="project-1", title="Cap")
        proposal_a = ReportUpdateProposalDB(
            report=report,
            trigger_type="manual",
            status="pending",
            summary="Proposal A",
        )
        proposal_b = ReportUpdateProposalDB(
            report=report,
            trigger_type="manual",
            status="pending",
            summary="Proposal B",
        )
        task = ReportEvaluationTaskDB(
            id="task-expired",
            project_id="project-1",
            user_id="user-1",
            trigger_type="manual",
            status="running",
            started_at=expired_time,
            lease_expires_at=expired_time,
            lease_version=1,
        )
        session.add_all([report, proposal_a, proposal_b, task])
        await session.commit()
        await session.refresh(proposal_a)
        await session.refresh(proposal_b)

    first_started = asyncio.Event()
    first_release = asyncio.Event()
    call_count = 0

    async def fake_generate(
        self,
        project_id: str,
        user_id: str,
        trigger_type: str,
        target_section_keys: list[str] | None = None,
    ):
        nonlocal call_count
        del self
        call_count += 1
        assert project_id == "project-1"
        assert user_id == "user-1"
        assert trigger_type == "manual"
        assert target_section_keys is None
        if call_count == 1:
            first_started.set()
            await first_release.wait()
            return SimpleNamespace(id=proposal_a.id)
        return SimpleNamespace(id=proposal_b.id)

    monkeypatch.setattr(
        "app.services.report_evaluation_task_manager.ReportGenerationService.generate_update_proposal",
        fake_generate,
    )

    manager_a = ReportEvaluationTaskManager(
        session_maker=manager_db,
        lease_seconds=0.05,
        heartbeat_interval_seconds=1.0,
    )
    manager_b = ReportEvaluationTaskManager(
        session_maker=manager_db,
        lease_seconds=0.05,
        heartbeat_interval_seconds=1.0,
    )

    stale_worker = asyncio.create_task(manager_a._run_task("task-expired"))
    await first_started.wait()
    await asyncio.sleep(0.08)

    await manager_b._run_task("task-expired")
    first_release.set()
    await stale_worker

    async with manager_db() as session:
        stored = await session.get(ReportEvaluationTaskDB, "task-expired")

    assert stored is not None
    assert call_count == 2
    assert stored.status == "completed"
    assert stored.proposal_id == proposal_b.id
    assert stored.lease_version == 3
    assert stored.lease_expires_at is None


@pytest.mark.anyio
async def test_run_task_heartbeat_extends_lease_while_generation_is_in_progress(
    manager_db,
    monkeypatch: pytest.MonkeyPatch,
):
    started = asyncio.Event()
    release = asyncio.Event()

    async def fake_generate(
        self,
        project_id: str,
        user_id: str,
        trigger_type: str,
        target_section_keys: list[str] | None = None,
    ):
        del self
        assert project_id == "project-1"
        assert user_id == "user-1"
        assert trigger_type == "manual"
        assert target_section_keys is None
        started.set()
        await release.wait()
        return None

    monkeypatch.setattr(
        "app.services.report_evaluation_task_manager.ReportGenerationService.generate_update_proposal",
        fake_generate,
    )

    manager = ReportEvaluationTaskManager(
        session_maker=manager_db,
        lease_seconds=0.08,
        heartbeat_interval_seconds=0.02,
    )
    monkeypatch.setattr(manager, "_schedule_task_run", lambda task_id: None)
    task = await manager.submit(
        project_id="project-1",
        user_id="user-1",
        trigger_type="manual",
    )

    runner = asyncio.create_task(manager._run_task(task.task_id))
    await started.wait()

    async with manager_db() as session:
        initial = await session.get(ReportEvaluationTaskDB, task.task_id)
        assert initial is not None
        initial_lease = initial.lease_expires_at

    assert initial_lease is not None
    await asyncio.sleep(0.06)

    async with manager_db() as session:
        refreshed = await session.get(ReportEvaluationTaskDB, task.task_id)
        assert refreshed is not None
        assert refreshed.status == "running"
        assert refreshed.lease_expires_at is not None
        extended_lease = refreshed.lease_expires_at

    assert extended_lease > initial_lease
    release.set()
    await runner


@pytest.mark.anyio
async def test_heartbeat_stops_renewing_after_max_runtime(
    manager_db,
    monkeypatch: pytest.MonkeyPatch,
):
    started = asyncio.Event()
    release = asyncio.Event()

    async def fake_generate(
        self,
        project_id: str,
        user_id: str,
        trigger_type: str,
        target_section_keys: list[str] | None = None,
    ):
        del self
        assert project_id == "project-1"
        assert user_id == "user-1"
        assert trigger_type == "manual"
        assert target_section_keys is None
        started.set()
        await release.wait()
        return None

    monkeypatch.setattr(
        "app.services.report_evaluation_task_manager.ReportGenerationService.generate_update_proposal",
        fake_generate,
    )

    manager = ReportEvaluationTaskManager(
        session_maker=manager_db,
        lease_seconds=0.05,
        heartbeat_interval_seconds=0.01,
        max_runtime_seconds=0.07,
    )
    monkeypatch.setattr(manager, "_schedule_task_run", lambda task_id: None)
    task = await manager.submit(
        project_id="project-1",
        user_id="user-1",
        trigger_type="manual",
    )

    runner = asyncio.create_task(manager._run_task(task.task_id))
    await started.wait()
    await asyncio.sleep(0.13)

    async with manager_db() as session:
        stored = await session.get(ReportEvaluationTaskDB, task.task_id)

    assert stored is not None
    assert stored.status == "running"
    assert stored.lease_expires_at is not None
    assert _as_utc(stored.lease_expires_at) < datetime.now(UTC)

    release.set()
    await runner


@pytest.mark.anyio
async def test_task_exceeding_max_runtime_is_reclaimed_and_stale_worker_cannot_overwrite(
    manager_db,
    monkeypatch: pytest.MonkeyPatch,
):
    async with manager_db() as session:
        report = ReportDB(project_id="project-1", title="Cap")
        proposal_a = ReportUpdateProposalDB(
            report=report,
            trigger_type="manual",
            status="pending",
            summary="Proposal A",
        )
        proposal_b = ReportUpdateProposalDB(
            report=report,
            trigger_type="manual",
            status="pending",
            summary="Proposal B",
        )
        session.add_all([report, proposal_a, proposal_b])
        await session.commit()
        await session.refresh(proposal_a)
        await session.refresh(proposal_b)

    first_started = asyncio.Event()
    first_release = asyncio.Event()
    call_count = 0

    async def fake_generate(
        self,
        project_id: str,
        user_id: str,
        trigger_type: str,
        target_section_keys: list[str] | None = None,
    ):
        nonlocal call_count
        del self
        assert project_id == "project-1"
        assert user_id == "user-1"
        assert trigger_type == "manual"
        assert target_section_keys is None
        call_count += 1
        if call_count == 1:
            first_started.set()
            await first_release.wait()
            return SimpleNamespace(id=proposal_a.id)
        return SimpleNamespace(id=proposal_b.id)

    monkeypatch.setattr(
        "app.services.report_evaluation_task_manager.ReportGenerationService.generate_update_proposal",
        fake_generate,
    )

    manager_a = ReportEvaluationTaskManager(
        session_maker=manager_db,
        lease_seconds=0.05,
        heartbeat_interval_seconds=0.01,
        max_runtime_seconds=0.07,
    )
    manager_b = ReportEvaluationTaskManager(
        session_maker=manager_db,
        lease_seconds=0.05,
        heartbeat_interval_seconds=0.01,
        max_runtime_seconds=0.07,
    )
    monkeypatch.setattr(manager_a, "_schedule_task_run", lambda task_id, allow_parallel_reclaim=False: None)

    task = await manager_a.submit(
        project_id="project-1",
        user_id="user-1",
        trigger_type="manual",
    )

    stale_worker = asyncio.create_task(manager_a._run_task(task.task_id))
    await first_started.wait()
    await asyncio.sleep(0.13)

    reclaimed = await manager_b.reclaim_expired_tasks()
    assert reclaimed == 1

    await manager_b._run_task(task.task_id)
    first_release.set()
    await stale_worker

    async with manager_db() as session:
        stored = await session.get(ReportEvaluationTaskDB, task.task_id)

    assert stored is not None
    assert call_count == 2
    assert stored.status == "completed"
    assert stored.proposal_id == proposal_b.id
