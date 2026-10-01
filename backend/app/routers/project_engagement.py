"""Project engagement-state endpoints.

Provides a single state contract for project sidebar checklist + attack graph.
The state is persisted as a JSON blob in project variables for now so it can
be replaced later by an MCP-backed provider without frontend contract changes.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import TypedDict

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_project_member
from app.database import get_db
from app.models.project import Project
from app.schemas.engagement import (
    EngagementChecklistItem,
    EngagementChecklistSection,
    EngagementGraph,
    EngagementGraphEdge,
    EngagementGraphNode,
    EngagementGraphNodePosition,
    EngagementStateBase,
    EngagementStateResponse,
    GraphNodeType,
)
from app.services.engagement_provider import (
    EngagementHistoryEvent,
)
from app.services.engagement_provider_factory import (
    get_engagement_event_provider,
    get_engagement_state_store,
)
from app.services.engagement_rules import (
    RULES_BY_SECTION,
    EngagementObjectiveRule,
    fallback_rule_for_section,
    infer_section_id,
    match_rule,
)

router = APIRouter(prefix="/projects/{project_id}/engagement-state", tags=["projects"])

_MAX_ITEMS_PER_SECTION = 24
_MAX_GRAPH_NODES = 80
_MAX_GRAPH_EDGES = 160

_SECTION_DEFS: tuple[tuple[str, str, str], ...] = (
    ("recon", "Reconnaissance", "radar"),
    ("exploitation", "Exploitation", "bug_report"),
    ("privesc", "Privilege Escalation", "key"),
    ("postexp", "Post-Exploitation", "inventory_2"),
)

_PHASE_WEIGHTS: dict[str, int] = {
    "recon": 30,
    "exploitation": 35,
    "privesc": 20,
    "postexp": 15,
}

_PHASE_EVIDENCE_TARGETS: dict[str, int] = {
    "recon": 4,
    "exploitation": 5,
    "privesc": 3,
    "postexp": 3,
}

_PHASE_LANE_CENTER_X: dict[str, int] = {
    "recon": 18,
    "exploitation": 43,
    "privesc": 66,
    "postexp": 86,
}

_LAB_COMPLETION_PATTERNS = (
    "root.txt",
    "proof.txt",
    "root session:",
    "root@",
    "uid=0(root)",
    "nt authority\\system",
    "system shell",
)

_DERIVED_SECTION_IDS = {section_id for section_id, _, _ in _SECTION_DEFS}


class ObjectiveAccumulator(TypedDict):
    rule: EngagementObjectiveRule
    evidence_count: int
    success_count: int
    failure_count: int
    last_seen_at: datetime | None
    last_seen_index: int
    last_tool: str | None


def _normalize_command(command: str) -> str:
    compact = re.sub(r"\s+", " ", command.strip())
    if not compact:
        return "Command"
    return compact if len(compact) <= 72 else f"{compact[:69]}..."


def _normalize_subtitle(subtitle: str) -> str:
    compact = re.sub(r"\s+", " ", subtitle.strip())
    if not compact:
        return "Workspace event"
    return compact if len(compact) <= 120 else f"{compact[:117]}..."


def _extract_tool(command: str) -> str | None:
    parts = command.strip().split()
    if not parts:
        return None
    tool = parts[0].rsplit("/", 1)[-1].strip()
    if not tool:
        return None
    return tool.lower()


def _event_tool(event: EngagementHistoryEvent) -> str | None:
    if event.tool_hint is not None:
        return event.tool_hint
    if event.kind != "command":
        return None
    return _extract_tool(event.command)


def _objective_label(base_label: str, tool: str | None) -> str:
    if not tool:
        return base_label
    lowered = base_label.lower()
    if tool in lowered:
        return base_label
    return f"{base_label} ({tool})"


def _new_objective_accumulator(rule: EngagementObjectiveRule) -> ObjectiveAccumulator:
    return {
        "rule": rule,
        "evidence_count": 0,
        "success_count": 0,
        "failure_count": 0,
        "last_seen_at": None,
        "last_seen_index": -1,
        "last_tool": None,
    }


def _objective_status(
    *,
    is_latest: bool,
    success_count: int,
    failure_count: int,
) -> str:
    if is_latest:
        return "active"
    if success_count > 0:
        return "done"
    if failure_count > 0:
        return "pending"
    return "pending"


def _default_checklist_item(rule: EngagementObjectiveRule) -> EngagementChecklistItem:
    return EngagementChecklistItem(
        id=rule.id,
        label=rule.label,
        status="pending",
        evidence_count=0,
        last_seen_at=None,
        success_count=0,
        failure_count=0,
    )


def _item_from_objective(
    *,
    rule: EngagementObjectiveRule,
    objective: ObjectiveAccumulator,
    total_commands: int,
) -> EngagementChecklistItem:
    is_latest = objective["last_seen_index"] == total_commands - 1
    return EngagementChecklistItem(
        id=rule.id,
        label=_objective_label(rule.label, objective["last_tool"]),
        status=_objective_status(
            is_latest=is_latest,
            success_count=objective["success_count"],
            failure_count=objective["failure_count"],
        ),
        evidence_count=objective["evidence_count"],
        last_seen_at=objective["last_seen_at"],
        success_count=objective["success_count"],
        failure_count=objective["failure_count"],
    )


def _is_observed_item(item: EngagementChecklistItem) -> bool:
    if item.evidence_count > 0:
        return True
    if item.success_count > 0 or item.failure_count > 0:
        return True
    return item.last_seen_at is not None


def _node_type_for_command(index: int, total: int, exit_code: int) -> GraphNodeType:
    if index == 0:
        return "initial"
    if exit_code != 0:
        return "failure"
    if index == total - 1:
        return "success"
    return "action"


def _clamp_position(value: int) -> int:
    return max(6, min(94, value))


def _x_position_for_node(section_id: str, lane_index: int) -> int:
    center = _PHASE_LANE_CENTER_X.get(section_id, 18)
    lane_offset = (lane_index % 3) * 4
    direction = -1 if lane_index % 2 == 0 else 1
    return _clamp_position(center + (lane_offset * direction))


def _y_position_for_node(lane_index: int, exit_code: int, is_latest: bool) -> int:
    base = 28 + (lane_index * 12)
    if exit_code != 0:
        base += 8
    elif is_latest:
        base -= 4
    return _clamp_position(base)


def _branch_for_exit(exit_code: int) -> str:
    return "success" if exit_code == 0 else "failure"


def _graph_has_lab_completion_signal(graph: EngagementGraph | None) -> bool:
    if graph is None:
        return False

    for node in graph.nodes:
        if node.status == "failure":
            continue

        text = " ".join(
            part
            for part in (
                node.title,
                node.subtitle,
                node.section_id or "",
                node.item_id or "",
            )
            if part
        ).lower()
        if any(pattern in text for pattern in _LAB_COMPLETION_PATTERNS):
            return True

    return False


def _finalize_active_items_for_completed_lab(
    sections: list[EngagementChecklistSection],
) -> list[EngagementChecklistSection]:
    finalized_sections: list[EngagementChecklistSection] = []
    for section in sections:
        finalized_items = [
            item.model_copy(update={"status": "done"})
            if item.status == "active" and _is_observed_item(item)
            else item
            for item in section.items
        ]
        finalized_sections.append(section.model_copy(update={"items": finalized_items}))
    return finalized_sections


def _compute_progress(
    sections: list[EngagementChecklistSection],
    graph: EngagementGraph | None = None,
) -> int:
    if _graph_has_lab_completion_signal(graph):
        return 100

    if not sections:
        return 0

    total_weight = sum(_PHASE_WEIGHTS.values()) or 100
    weighted_score = 0.0

    for section in sections:
        phase_weight = _PHASE_WEIGHTS.get(section.id, 0)
        if phase_weight <= 0:
            continue

        observed_items = [item for item in section.items if _is_observed_item(item)]
        if not observed_items:
            continue

        observed_objective_count = len(observed_items)
        active_count = sum(1 for item in observed_items if item.status == "active")

        evidence_total = sum(item.evidence_count for item in observed_items)
        success_events = sum(item.success_count for item in observed_items)
        failure_events = sum(item.failure_count for item in observed_items)

        # Defensive fallback for unusual legacy states with counters missing.
        if evidence_total <= 0:
            evidence_total = success_events + failure_events
        if evidence_total <= 0:
            continue

        has_active = active_count > 0
        success_ratio = success_events / evidence_total if evidence_total else 0.0
        evidence_target = _PHASE_EVIDENCE_TARGETS.get(section.id, 3)
        coverage_ratio = min(1.0, observed_objective_count / evidence_target)

        # Phase score combines successful outcomes, observed evidence, and recency.
        active_bonus = 0.12 if has_active and success_events > 0 else 0.0
        failure_penalty = (failure_events / evidence_total) * 0.25 if evidence_total else 0.0
        phase_score_ratio = (
            (0.65 * success_ratio)
            + (0.35 * coverage_ratio)
            + active_bonus
            - failure_penalty
        )
        phase_score_ratio = max(0.0, min(1.0, phase_score_ratio))

        weighted_score += phase_weight * (phase_score_ratio * 100.0)

    progress = round(weighted_score / total_weight)
    return max(0, min(100, progress))


def _state_has_observed_activity(state: EngagementStateBase) -> bool:
    if state.graph.nodes:
        return True
    return any(
        _is_observed_item(item)
        for section in state.sections
        for item in section.items
    )


def _stored_item_is_manual_override(
    stored_item: EngagementChecklistItem,
    derived_item: EngagementChecklistItem,
) -> bool:
    if stored_item.status == derived_item.status:
        return False

    return (
        not _is_observed_item(stored_item)
        and not _is_observed_item(derived_item)
        and stored_item.evidence_count == derived_item.evidence_count
        and stored_item.success_count == derived_item.success_count
        and stored_item.failure_count == derived_item.failure_count
        and stored_item.last_seen_at == derived_item.last_seen_at
    )


def _merge_stored_overrides(
    *,
    derived: EngagementStateBase,
    stored: EngagementStateBase,
) -> EngagementStateBase:
    if not _state_has_observed_activity(derived) and not any(
        section.id in _DERIVED_SECTION_IDS for section in stored.sections
    ):
        return stored

    stored_sections_by_id = {section.id: section for section in stored.sections}
    merged_sections: list[EngagementChecklistSection] = []

    for derived_section in derived.sections:
        stored_section = stored_sections_by_id.get(derived_section.id)
        if stored_section is None:
            merged_sections.append(derived_section)
            continue

        stored_items_by_id = {item.id: item for item in stored_section.items}
        merged_items: list[EngagementChecklistItem] = []
        seen_item_ids: set[str] = set()

        for derived_item in derived_section.items:
            stored_item = stored_items_by_id.get(derived_item.id)
            seen_item_ids.add(derived_item.id)
            if stored_item is None:
                merged_items.append(derived_item)
                continue

            merged_items.append(
                derived_item.model_copy(
                    update={
                        "status": stored_item.status
                        if _stored_item_is_manual_override(stored_item, derived_item)
                        else derived_item.status
                    }
                )
            )

        for stored_item in stored_section.items:
            if stored_item.id not in seen_item_ids:
                merged_items.append(stored_item)

        merged_sections.append(
            derived_section.model_copy(
                update={
                    "is_open": stored_section.is_open,
                    "items": merged_items[:_MAX_ITEMS_PER_SECTION],
                }
            )
        )

    for stored_section in stored.sections:
        if stored_section.id not in _DERIVED_SECTION_IDS:
            merged_sections.append(stored_section)

    graph = derived.graph if _state_has_observed_activity(derived) else stored.graph
    if _graph_has_lab_completion_signal(graph):
        merged_sections = _finalize_active_items_for_completed_lab(merged_sections)

    return EngagementStateBase(
        version=derived.version,
        sections=merged_sections,
        graph=graph,
        progress=_compute_progress(merged_sections, graph),
    )


def _derive_state_from_events(events: list[EngagementHistoryEvent]) -> EngagementStateBase:
    sections_by_id = {
        section_id: EngagementChecklistSection(
            id=section_id,
            label=label,
            icon=icon,
            is_open=False,
            items=[],
        )
        for section_id, label, icon in _SECTION_DEFS
    }

    objective_stats_by_section: dict[str, dict[str, ObjectiveAccumulator]] = {
        section_id: {} for section_id, _, _ in _SECTION_DEFS
    }
    graph_nodes: list[EngagementGraphNode] = []
    graph_edges: list[EngagementGraphEdge] = []
    graph_previous_section_id: str | None = None
    graph_previous_command_id: str | None = None
    graph_section_counts: dict[str, int] = {section_id: 0 for section_id, _, _ in _SECTION_DEFS}

    total_events = len(events)
    graph_window_start = max(0, total_events - _MAX_GRAPH_NODES)
    graph_window_total = max(0, total_events - graph_window_start)

    for index, event in enumerate(events):
        matched_rule = match_rule(event.command)
        if matched_rule is None:
            fallback_section = event.section_hint or infer_section_id(event.command)
            matched_rule = fallback_rule_for_section(fallback_section)

        section_id = matched_rule.section_id
        section_stats = objective_stats_by_section[section_id]
        objective = section_stats.get(matched_rule.id)
        if objective is None:
            objective = _new_objective_accumulator(matched_rule)
            section_stats[matched_rule.id] = objective

        objective["evidence_count"] += 1
        if event.exit_code == 0:
            objective["success_count"] += 1
        else:
            objective["failure_count"] += 1
        objective["last_seen_at"] = event.created_at
        objective["last_seen_index"] = index
        objective["last_tool"] = _event_tool(event)
        branch = _branch_for_exit(event.exit_code)

        if index >= graph_window_start:
            graph_index = index - graph_window_start
            node_type = _node_type_for_command(
                graph_index, graph_window_total, event.exit_code
            )
            lane_index = graph_section_counts.get(section_id, 0)
            graph_section_counts[section_id] = lane_index + 1
            icon = (
                "block"
                if event.exit_code != 0
                else (event.icon or matched_rule.icon or "terminal")
            )
            graph_nodes.append(
                EngagementGraphNode(
                    id=event.id,
                    type=node_type,
                    status=branch,
                    title=_normalize_command(event.title or event.command),
                    subtitle=_normalize_subtitle(
                        event.subtitle or f"Exit {event.exit_code}"
                    ),
                    icon=icon,
                    position=EngagementGraphNodePosition(
                        x=f"{_x_position_for_node(section_id, lane_index)}%",
                        y=f"{_y_position_for_node(lane_index, event.exit_code, graph_index == graph_window_total - 1)}%",
                    ),
                    section_id=section_id,
                    item_id=matched_rule.id,
                )
            )

            if graph_previous_command_id is not None and len(graph_edges) < _MAX_GRAPH_EDGES:
                graph_edges.append(
                    EngagementGraphEdge(
                        id=f"{graph_previous_command_id}->{event.id}",
                        source_id=graph_previous_command_id,
                        target_id=event.id,
                        kind="sequence",
                        branch=branch,
                    )
                )
            if (
                graph_previous_command_id is not None
                and graph_previous_section_id is not None
                and graph_previous_section_id != section_id
                and len(graph_edges) < _MAX_GRAPH_EDGES
            ):
                graph_edges.append(
                    EngagementGraphEdge(
                        id=f"{graph_previous_command_id}->{event.id}::phase-transition",
                        source_id=graph_previous_command_id,
                        target_id=event.id,
                        kind="phase-transition",
                        branch=branch,
                    )
                )
            graph_previous_command_id = event.id
            graph_previous_section_id = section_id

    sections = list(sections_by_id.values())
    first_non_empty: EngagementChecklistSection | None = None

    for section in sections:
        stats_for_section = objective_stats_by_section.get(section.id, {})

        items: list[EngagementChecklistItem] = []
        additional_items: list[EngagementChecklistItem] = []
        ordered_rules = RULES_BY_SECTION.get(section.id, ())
        seen_objective_ids: set[str] = set()

        for rule in ordered_rules:
            objective = stats_for_section.get(rule.id)
            if objective is None:
                items.append(_default_checklist_item(rule))
                continue
            seen_objective_ids.add(rule.id)
            items.append(
                _item_from_objective(
                    rule=rule,
                    objective=objective,
                    total_commands=total_events,
                )
            )

        for objective_id, objective in stats_for_section.items():
            if objective_id in seen_objective_ids:
                continue
            rule = objective["rule"]
            additional_items.append(
                _item_from_objective(
                    rule=rule,
                    objective=objective,
                    total_commands=total_events,
                )
            )

        additional_items.sort(
            key=lambda item: (
                item.last_seen_at.timestamp() if item.last_seen_at else -1.0,
                item.evidence_count,
            ),
            reverse=True,
        )
        section.items = (items + additional_items)[:_MAX_ITEMS_PER_SECTION]

    for section in sections:
        if section.items and first_non_empty is None:
            first_non_empty = section
        if any(item.status == "active" for item in section.items):
            section.is_open = True

    if first_non_empty and not any(section.is_open for section in sections):
        first_non_empty.is_open = True

    graph = EngagementGraph(nodes=graph_nodes, edges=graph_edges)
    if _graph_has_lab_completion_signal(graph):
        sections = _finalize_active_items_for_completed_lab(sections)

    return EngagementStateBase(
        version="v1",
        sections=sections,
        graph=graph,
        progress=_compute_progress(sections, graph),
    )

@router.get("", response_model=EngagementStateResponse)
async def get_project_engagement_state(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(require_project_member),
):
    state_store = get_engagement_state_store()
    event_provider = get_engagement_event_provider()

    events = await event_provider.list_events(db=db, project_id=project_id)
    derived = _derive_state_from_events(events)
    stored = await state_store.read(project)
    if stored:
        merged = _merge_stored_overrides(derived=derived, stored=stored)
        return EngagementStateResponse(**merged.model_dump(), source="stored")

    return EngagementStateResponse(**derived.model_dump(), source="derived")


@router.put("", response_model=EngagementStateResponse)
async def update_project_engagement_state(
    project_id: str,
    payload: EngagementStateBase,
    db: AsyncSession = Depends(get_db),
    project: Project = Depends(require_project_member),
):
    state_store = get_engagement_state_store()
    await state_store.write(project, payload)
    await db.commit()
    await db.refresh(project)
    return EngagementStateResponse(**payload.model_dump(), source="stored")
