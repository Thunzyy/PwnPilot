from __future__ import annotations

import argparse
import asyncio
import json
import sys
import tempfile
import uuid
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

def load_backend_modules():
    import app.models  # noqa: F401
    from app.benchmarks.kb_large_vault import (
        BENCHMARK_SCENARIOS,
        run_kb_benchmark,
    )
    from app.database import Base, init_fts_tables
    from app.models.project import Project
    from app.models.user import User

    return {
        "BENCHMARK_SCENARIOS": BENCHMARK_SCENARIOS,
        "run_kb_benchmark": run_kb_benchmark,
        "Base": Base,
        "init_fts_tables": init_fts_tables,
        "Project": Project,
        "User": User,
    }


def parse_args() -> argparse.Namespace:
    modules = load_backend_modules()
    parser = argparse.ArgumentParser(
        description="Run repeatable knowledge-base large-vault benchmarks.",
    )
    parser.add_argument(
        "--scenario",
        choices=sorted(modules["BENCHMARK_SCENARIOS"]),
        default="medium",
    )
    parser.add_argument(
        "--vault-path",
        help="Benchmark an existing markdown vault instead of generating a synthetic fixture.",
    )
    parser.add_argument(
        "--dataset-name",
        help="Stable label for real-vault runs, useful when storing sanitized snapshots.",
    )
    parser.add_argument(
        "--redact-path",
        action="store_true",
        help="Replace the absolute vault path in the report with a redacted placeholder.",
    )
    parser.add_argument(
        "--iterations",
        type=int,
        default=3,
    )
    parser.add_argument(
        "--search-term",
        default="roadmap",
    )
    parser.add_argument(
        "--output",
        required=True,
    )
    return parser.parse_args()


async def run(args: argparse.Namespace) -> dict:
    modules = load_backend_modules()
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    real_vault_root = Path(args.vault_path).resolve() if args.vault_path else None

    with tempfile.TemporaryDirectory(prefix="kb-benchmark-") as temp_dir:
        temp_root = Path(temp_dir)
        db_path = temp_root / "benchmark.sqlite3"
        vault_root = real_vault_root if real_vault_root else temp_root / "vault"

        engine = create_async_engine(
            f"sqlite+aiosqlite:///{db_path.as_posix()}",
            echo=False,
        )
        session_maker = async_sessionmaker(engine, expire_on_commit=False)

        async with engine.begin() as conn:
            await conn.run_sync(modules["Base"].metadata.create_all)
            await modules["init_fts_tables"](conn)

        async with session_maker() as session:
            user = modules["User"](
                username=f"kb-benchmark-{uuid.uuid4().hex[:8]}",
                email=f"kb-benchmark-{uuid.uuid4().hex[:8]}@example.com",
                password_hash="benchmark",
            )
            project = modules["Project"](
                name="KB Benchmark",
                slug=f"kb-benchmark-{uuid.uuid4().hex[:8]}",
                workspace_path=str(temp_root / "workspace"),
            )
            session.add_all([user, project])
            await session.commit()
            await session.refresh(user)
            await session.refresh(project)

            report = await modules["run_kb_benchmark"](
                db=session,
                vault_root=vault_root,
                scenario=modules["BENCHMARK_SCENARIOS"][args.scenario],
                user_id=user.id,
                project_id=project.id,
                iterations=args.iterations,
                search_term=args.search_term,
                use_existing_vault=real_vault_root is not None,
                dataset_name=args.dataset_name,
                redact_vault_path=args.redact_path,
            )

        await engine.dispose()

    report["generated_at"] = datetime.now(UTC).isoformat()
    output_path.write_text(
        json.dumps(report, indent=2),
        encoding="utf-8",
    )
    return report


def main() -> int:
    args = parse_args()
    report = asyncio.run(run(args))
    print(
        json.dumps(
            {
                "scenario": report["scenario"],
                "document_count": report["document_count"],
                "output": args.output,
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
