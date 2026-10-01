"""Helpers for MITRE ATT&CK lookups used across engagement features."""

from __future__ import annotations

import json
import re
from collections.abc import Iterable
from functools import lru_cache
from pathlib import Path

from app.schemas.linking import MitreTechnique

_MITRE_JSON_PATH = (
    Path(__file__).resolve().parent.parent.parent / "data" / "mitre_techniques.json"
)
_MITRE_ID_RE = re.compile(r"(?<![A-Z0-9])T\d{4}(?:\.\d{3})?(?![A-Z0-9])", re.IGNORECASE)

_TACTIC_TO_SECTION: dict[str, str] = {
    "reconnaissance": "recon",
    "resource development": "recon",
    "initial access": "exploitation",
    "execution": "exploitation",
    "persistence": "exploitation",
    "defense evasion": "exploitation",
    "privilege escalation": "privesc",
    "discovery": "postexp",
    "lateral movement": "postexp",
    "collection": "postexp",
    "command and control": "postexp",
    "exfiltration": "postexp",
    "impact": "postexp",
}


@lru_cache
def _catalog_by_id() -> dict[str, MitreTechnique]:
    if not _MITRE_JSON_PATH.exists():
        return {}

    with _MITRE_JSON_PATH.open(encoding="utf-8") as handle:
        payload = json.load(handle)

    catalog: dict[str, MitreTechnique] = {}
    for raw in payload:
        if not isinstance(raw, dict) or "id" not in raw:
            continue
        technique = MitreTechnique(**raw)
        catalog[technique.id.upper()] = technique
    return catalog


def extract_mitre_technique_ids(*texts: str | None) -> tuple[str, ...]:
    seen: set[str] = set()
    ordered: list[str] = []

    for text in texts:
        if not isinstance(text, str) or not text:
            continue
        for match in _MITRE_ID_RE.findall(text):
            technique_id = match.upper()
            if technique_id in seen:
                continue
            seen.add(technique_id)
            ordered.append(technique_id)

    return tuple(ordered)


def lookup_mitre_techniques(
    technique_ids: Iterable[str],
) -> tuple[MitreTechnique, ...]:
    catalog = _catalog_by_id()
    return tuple(
        catalog[technique_id.upper()]
        for technique_id in technique_ids
        if technique_id.upper() in catalog
    )


def infer_section_id_from_mitre(
    technique_ids: Iterable[str],
) -> str | None:
    section_votes: dict[str, int] = {}
    for technique in lookup_mitre_techniques(technique_ids):
        section_id = _TACTIC_TO_SECTION.get(technique.tactic.strip().lower())
        if section_id is None:
            continue
        section_votes[section_id] = section_votes.get(section_id, 0) + 1

    if not section_votes:
        return None

    return max(
        section_votes.items(),
        key=lambda item: (item[1], item[0]),
    )[0]


def build_mitre_search_context(technique_ids: Iterable[str]) -> str:
    techniques = lookup_mitre_techniques(technique_ids)
    if not techniques:
        return ""

    parts: list[str] = []
    for technique in techniques:
        parts.extend([technique.id, technique.name, technique.tactic])
    return " ".join(parts).strip()


def format_mitre_summary(technique_ids: Iterable[str]) -> str | None:
    ordered_ids = [technique_id.upper() for technique_id in technique_ids]
    if not ordered_ids:
        return None
    if len(ordered_ids) == 1:
        return f"MITRE {ordered_ids[0]}"
    return f"MITRE {', '.join(ordered_ids[:2])}" + (
        f" +{len(ordered_ids) - 2}" if len(ordered_ids) > 2 else ""
    )
