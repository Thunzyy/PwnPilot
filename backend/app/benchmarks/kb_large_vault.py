from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path
from statistics import mean

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.knowledge import KnowledgeDoc, KnowledgeSource
from app.services.kb_service import KBService


@dataclass(frozen=True)
class KBBenchmarkScenario:
    name: str
    document_count: int
    folder_count: int
    sections_per_doc: int = 3
    lines_per_section: int = 6


BENCHMARK_SCENARIOS: dict[str, KBBenchmarkScenario] = {
    "smoke": KBBenchmarkScenario(
        name="smoke",
        document_count=12,
        folder_count=3,
    ),
    "medium": KBBenchmarkScenario(
        name="medium",
        document_count=250,
        folder_count=10,
    ),
    "large": KBBenchmarkScenario(
        name="large",
        document_count=1000,
        folder_count=20,
    ),
}


def summarize_duration_series(durations_ms: list[float]) -> dict:
    return {
        "count": len(durations_ms),
        "min_duration_ms": round(min(durations_ms), 2),
        "max_duration_ms": round(max(durations_ms), 2),
        "avg_duration_ms": round(mean(durations_ms), 2),
    }


def build_benchmark_vault(
    vault_root: Path,
    scenario: KBBenchmarkScenario,
) -> dict:
    vault_root.mkdir(parents=True, exist_ok=True)

    for index in range(scenario.document_count):
        folder_index = index % scenario.folder_count
        folder = vault_root / f"segment_{folder_index:02d}"
        file_path = folder / f"note_{index:04d}.md"
        folder.mkdir(parents=True, exist_ok=True)

        tags = [f"tag{folder_index}", "roadmap", "benchmark"]
        sections = []
        for section_index in range(scenario.sections_per_doc):
            lines = "\n".join(
                f"Line {line_index} for roadmap benchmark note {index}"
                for line_index in range(scenario.lines_per_section)
            )
            sections.append(
                f"## Section {section_index}\n"
                f"roadmap nmap benchmark reference {index}\n"
                f"{lines}"
            )

        file_path.write_text(
            "---\n"
            f"title: Benchmark Note {index}\n"
            f"tags: [{', '.join(tags)}]\n"
            "---\n\n"
            + "\n\n".join(sections)
            + "\n",
            encoding="utf-8",
        )

    return {
        "dataset_mode": "synthetic",
        "scenario": scenario.name,
        "document_count": scenario.document_count,
        "folder_count": scenario.folder_count,
        "vault_root": str(vault_root),
    }


def summarize_existing_vault(
    vault_root: Path,
    *,
    dataset_name: str | None = None,
    redact_vault_path: bool = False,
) -> dict:
    markdown_files = list(vault_root.rglob("*.md"))
    folder_count = len({path.parent.relative_to(vault_root) for path in markdown_files})
    resolved_dataset_name = dataset_name or "real-vault"
    return {
        "dataset_mode": "real",
        "scenario": "real-vault",
        "dataset_name": resolved_dataset_name,
        "document_count": len(markdown_files),
        "folder_count": folder_count,
        "vault_root": (
            f"<redacted:{resolved_dataset_name}>"
            if redact_vault_path
            else str(vault_root)
        ),
    }


async def _measure_async(
    durations_ms: dict[str, list[float]],
    operation: str,
    fn,
):
    started_at = time.perf_counter()
    result = await fn()
    durations_ms[operation].append((time.perf_counter() - started_at) * 1000)
    return result


async def run_kb_benchmark(
    *,
    db: AsyncSession,
    vault_root: Path,
    scenario: KBBenchmarkScenario,
    user_id: str,
    project_id: str,
    iterations: int = 3,
    search_term: str = "roadmap",
    use_existing_vault: bool = False,
    dataset_name: str | None = None,
    redact_vault_path: bool = False,
) -> dict:
    fixture = (
        summarize_existing_vault(
            vault_root,
            dataset_name=dataset_name,
            redact_vault_path=redact_vault_path,
        )
        if use_existing_vault
        else build_benchmark_vault(vault_root, scenario)
    )

    source = KnowledgeSource(
        name=(
            f"Benchmark Vault ({scenario.name})"
            if fixture["dataset_mode"] == "synthetic"
            else f"Benchmark Vault ({vault_root.name})"
        ),
        source_type="local",
        origin="filesystem",
        path=str(vault_root),
        user_id=user_id,
        project_id=project_id,
    )
    db.add(source)
    await db.commit()
    await db.refresh(source)

    service = KBService(db)
    durations_ms = {
        "index_cold": [],
        "index_warm": [],
        "search": [],
        "tree": [],
        "document_open": [],
    }

    cold_index = await service.index_vault(source.id, str(vault_root))
    durations_ms["index_cold"].append(cold_index["duration_ms"])

    warm_index = await service.index_vault(source.id, str(vault_root))
    durations_ms["index_warm"].append(warm_index["duration_ms"])

    result = await db.execute(
        select(KnowledgeDoc.id)
        .where(KnowledgeDoc.source_id == source.id)
        .limit(1)
    )
    sample_doc_id = result.scalar_one()

    for _ in range(iterations):
        await _measure_async(
            durations_ms,
            "search",
            lambda: service.search_docs(
                search_term,
                source_id=source.id,
                limit=20,
            ),
        )
        await _measure_async(
            durations_ms,
            "tree",
            lambda: service.get_tree(source_id=source.id),
        )
        await _measure_async(
            durations_ms,
            "document_open",
            lambda: service.get_doc(sample_doc_id),
        )

    return {
        "dataset_mode": fixture["dataset_mode"],
        "dataset_name": fixture.get("dataset_name"),
        "scenario": fixture["scenario"],
        "document_count": fixture["document_count"],
        "folder_count": fixture["folder_count"],
        "iterations": iterations,
        "vault_root": fixture["vault_root"],
        "source_id": source.id,
        "operations": {
            name: summarize_duration_series(values)
            for name, values in durations_ms.items()
        },
    }
