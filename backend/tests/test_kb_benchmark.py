import json
from pathlib import Path
import subprocess
import sys

import pytest

from app.models.project import Project
from app.models.user import User


async def _setup_user_project(db):
    user = User(
        username="benchmark-user",
        email="benchmark@example.com",
        password_hash="fakehash",
    )
    db.add(user)
    await db.flush()

    project = Project(
        name="KB Benchmark Project",
        slug="kb-benchmark-project",
        workspace_path="/tmp/kb-benchmark-project",
    )
    db.add(project)
    await db.flush()
    return user, project


def _write_markdown_doc(path: Path, title: str, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        f"---\n"
        f"title: {title}\n"
        "tags: [roadmap, benchmark]\n"
        "---\n\n"
        f"{body}\n",
        encoding="utf-8",
    )


@pytest.mark.anyio
async def test_build_benchmark_vault_creates_expected_markdown_files(tmp_path):
    from app.benchmarks.kb_large_vault import (
        BENCHMARK_SCENARIOS,
        build_benchmark_vault,
    )

    vault_root = tmp_path / "vault"
    summary = build_benchmark_vault(
        vault_root,
        BENCHMARK_SCENARIOS["smoke"],
    )

    assert summary["document_count"] == BENCHMARK_SCENARIOS["smoke"].document_count
    assert len(list(vault_root.rglob("*.md"))) == BENCHMARK_SCENARIOS["smoke"].document_count
    assert any(path.parent != vault_root for path in vault_root.rglob("*.md"))


@pytest.mark.anyio
async def test_run_kb_benchmark_returns_operation_summaries(test_db, tmp_path):
    from app.benchmarks.kb_large_vault import (
        BENCHMARK_SCENARIOS,
        run_kb_benchmark,
    )

    user, project = await _setup_user_project(test_db)

    report = await run_kb_benchmark(
        db=test_db,
        vault_root=tmp_path / "benchmark-vault",
        scenario=BENCHMARK_SCENARIOS["smoke"],
        user_id=user.id,
        project_id=project.id,
        iterations=2,
        search_term="roadmap",
    )

    assert report["scenario"] == "smoke"
    assert report["document_count"] == BENCHMARK_SCENARIOS["smoke"].document_count
    assert report["iterations"] == 2
    assert Path(report["vault_root"]).exists()

    for operation_name in [
        "index_cold",
        "index_warm",
        "search",
        "tree",
        "document_open",
    ]:
        assert operation_name in report["operations"]
        operation = report["operations"][operation_name]
        assert operation["count"] >= 1
        assert operation["min_duration_ms"] >= 0
        assert operation["max_duration_ms"] >= operation["min_duration_ms"]
        assert operation["avg_duration_ms"] >= operation["min_duration_ms"]


@pytest.mark.anyio
async def test_run_kb_benchmark_supports_existing_real_vault(test_db, tmp_path):
    from app.benchmarks.kb_large_vault import (
        BENCHMARK_SCENARIOS,
        run_kb_benchmark,
    )

    user, project = await _setup_user_project(test_db)
    vault_root = tmp_path / "real-vault"
    _write_markdown_doc(
        vault_root / "ops" / "ROADMAP.md",
        "Roadmap",
        "roadmap benchmark content",
    )
    _write_markdown_doc(
        vault_root / "notes" / "findings.md",
        "Findings",
        "roadmap finding content",
    )

    report = await run_kb_benchmark(
        db=test_db,
        vault_root=vault_root,
        scenario=BENCHMARK_SCENARIOS["smoke"],
        user_id=user.id,
        project_id=project.id,
        iterations=1,
        search_term="roadmap",
        use_existing_vault=True,
    )

    assert report["dataset_mode"] == "real"
    assert report["document_count"] == 2
    assert report["folder_count"] == 2
    assert Path(report["vault_root"]) == vault_root
    assert report["operations"]["search"]["count"] == 1


@pytest.mark.anyio
async def test_run_kb_benchmark_can_redact_real_vault_path(test_db, tmp_path):
    from app.benchmarks.kb_large_vault import (
        BENCHMARK_SCENARIOS,
        run_kb_benchmark,
    )

    user, project = await _setup_user_project(test_db)
    vault_root = tmp_path / "safe-docs-vault"
    _write_markdown_doc(
        vault_root / "docs" / "overview.md",
        "Overview",
        "roadmap safe benchmark content",
    )

    report = await run_kb_benchmark(
        db=test_db,
        vault_root=vault_root,
        scenario=BENCHMARK_SCENARIOS["smoke"],
        user_id=user.id,
        project_id=project.id,
        iterations=1,
        search_term="roadmap",
        use_existing_vault=True,
        dataset_name="repo-docs",
        redact_vault_path=True,
    )

    assert report["dataset_mode"] == "real"
    assert report["dataset_name"] == "repo-docs"
    assert report["vault_root"] == "<redacted:repo-docs>"


def test_kb_benchmark_cli_writes_json_report(tmp_path):
    backend_root = Path(__file__).resolve().parent.parent
    output_path = tmp_path / "kb-benchmark-report.json"

    result = subprocess.run(
        [
            sys.executable,
            str(backend_root / "scripts" / "run_kb_benchmarks.py"),
            "--scenario",
            "smoke",
            "--iterations",
            "1",
            "--output",
            str(output_path),
        ],
        cwd=backend_root,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    report = json.loads(output_path.read_text(encoding="utf-8"))
    assert report["scenario"] == "smoke"
    assert "search" in report["operations"]


def test_kb_benchmark_cli_supports_real_vault_path(tmp_path):
    backend_root = Path(__file__).resolve().parent.parent
    output_path = tmp_path / "kb-benchmark-real-vault.json"
    vault_root = tmp_path / "vault"
    _write_markdown_doc(
        vault_root / "engagement" / "scope.md",
        "Scope",
        "roadmap scoped note",
    )

    result = subprocess.run(
        [
            sys.executable,
            str(backend_root / "scripts" / "run_kb_benchmarks.py"),
            "--vault-path",
            str(vault_root),
            "--iterations",
            "1",
            "--output",
            str(output_path),
        ],
        cwd=backend_root,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    report = json.loads(output_path.read_text(encoding="utf-8"))
    assert report["dataset_mode"] == "real"
    assert report["document_count"] == 1
    assert report["vault_root"] == str(vault_root)


def test_kb_benchmark_cli_can_redact_real_vault_path(tmp_path):
    backend_root = Path(__file__).resolve().parent.parent
    output_path = tmp_path / "kb-benchmark-redacted-real-vault.json"
    vault_root = tmp_path / "vault"
    _write_markdown_doc(
        vault_root / "engagement" / "scope.md",
        "Scope",
        "roadmap scoped note",
    )

    result = subprocess.run(
        [
            sys.executable,
            str(backend_root / "scripts" / "run_kb_benchmarks.py"),
            "--vault-path",
            str(vault_root),
            "--dataset-name",
            "repo-docs",
            "--redact-path",
            "--iterations",
            "1",
            "--output",
            str(output_path),
        ],
        cwd=backend_root,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    report = json.loads(output_path.read_text(encoding="utf-8"))
    assert report["dataset_mode"] == "real"
    assert report["dataset_name"] == "repo-docs"
    assert report["vault_root"] == "<redacted:repo-docs>"


def test_kb_benchmark_cli_rejects_unknown_scenario(tmp_path):
    backend_root = Path(__file__).resolve().parent.parent
    output_path = tmp_path / "kb-benchmark-report.json"

    result = subprocess.run(
        [
            sys.executable,
            str(backend_root / "scripts" / "run_kb_benchmarks.py"),
            "--scenario",
            "unknown",
            "--output",
            str(output_path),
        ],
        cwd=backend_root,
        capture_output=True,
        text=True,
    )

    assert result.returncode != 0
    assert "invalid choice" in result.stderr.lower()
