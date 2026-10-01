"""Mock MCP endpoints for local end-to-end engagement testing."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.schemas.engagement import EngagementStateBase

router = APIRouter(prefix="/mcp/mock", tags=["mcp-mock"])


class MockEngagementEvent(BaseModel):
    id: str = Field(..., min_length=1, max_length=120)
    command: str = Field(..., min_length=1, max_length=4000)
    exit_code: int
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class MockEngagementEventsPayload(BaseModel):
    events: list[MockEngagementEvent] = Field(default_factory=list)


class MockSeedResponse(BaseModel):
    project_id: str
    scenario: str
    event_count: int


_EVENT_STORE: dict[str, list[MockEngagementEvent]] = {}
_STATE_STORE: dict[str, EngagementStateBase] = {}


def _sorted_events(events: list[MockEngagementEvent]) -> list[MockEngagementEvent]:
    return sorted(events, key=lambda event: event.created_at)


def _scenario_commands(scenario: str) -> list[tuple[str, int]]:
    if scenario == "recon":
        return [
            ("nmap -sV 10.10.10.10", 0),
            ("gobuster dir -u http://10.10.10.10 -w /tmp/list.txt", 0),
        ]
    if scenario == "exploit_fail":
        return [
            ("nmap -sV 10.10.10.10", 0),
            ("hydra -l admin -P /tmp/list ssh://10.10.10.10", 1),
            ("sqlmap -u http://10.10.10.10/login --batch", 1),
        ]
    if scenario == "full_path":
        return [
            ("nmap -sV 10.10.10.10", 0),
            ("gobuster dir -u http://10.10.10.10 -w /tmp/list.txt", 0),
            ("sqlmap -u http://10.10.10.10/login --batch", 0),
            ("linpeas.sh", 0),
            ("sudo -l", 0),
            ("secretsdump.py local", 0),
            ("bloodhound-python -c All", 0),
        ]
    if scenario == "pwnbox_real":
        return [
            ("nmap -sC -sV -Pn 10.10.11.34", 0),
            (
                "ffuf -w /usr/share/seclists/Discovery/Web-Content/common.txt "
                "-u http://10.10.11.34/FUZZ -mc 200,204,301,302",
                0,
            ),
            ("whatweb http://10.10.11.34", 0),
            (
                "sqlmap -u 'http://10.10.11.34/login.php?id=1' --batch "
                "--risk=3 --level=5",
                0,
            ),
            ("hydra -l admin -P /usr/share/wordlists/rockyou.txt ssh://10.10.11.34", 1),
            ("linpeas.sh", 0),
            ("sudo -l", 0),
            ("secretsdump.py local", 0),
            (
                "bloodhound-python -c All -u svc_pwnbox -p 'Passw0rd!' "
                "-d corp.local -ns 10.10.11.34",
                0,
            ),
        ]
    raise HTTPException(status_code=404, detail="Unknown scenario")


@router.get(
    "/projects/{project_id}/engagement-events",
    response_model=MockEngagementEventsPayload,
)
def get_mock_engagement_events(project_id: str):
    return MockEngagementEventsPayload(events=_EVENT_STORE.get(project_id, []))


@router.put(
    "/projects/{project_id}/engagement-events",
    response_model=MockEngagementEventsPayload,
)
def put_mock_engagement_events(project_id: str, payload: MockEngagementEventsPayload):
    events = _sorted_events(list(payload.events))
    _EVENT_STORE[project_id] = events
    return MockEngagementEventsPayload(events=events)


@router.get(
    "/projects/{project_id}/engagement-state",
    response_model=EngagementStateBase,
)
def get_mock_engagement_state(project_id: str):
    state = _STATE_STORE.get(project_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Mock engagement state not found")
    return state


@router.put(
    "/projects/{project_id}/engagement-state",
    response_model=EngagementStateBase,
)
def put_mock_engagement_state(project_id: str, payload: EngagementStateBase):
    _STATE_STORE[project_id] = payload
    return payload


@router.post(
    "/projects/{project_id}/seed/{scenario}",
    response_model=MockSeedResponse,
)
def seed_mock_project(
    project_id: str,
    scenario: Literal["recon", "exploit_fail", "full_path", "pwnbox_real"],
):
    commands = _scenario_commands(scenario)
    base_time = datetime.now(UTC)
    events = [
        MockEngagementEvent(
            id=f"{project_id}-evt-{index + 1}",
            command=command,
            exit_code=exit_code,
            created_at=base_time + timedelta(seconds=index),
        )
        for index, (command, exit_code) in enumerate(commands)
    ]
    _EVENT_STORE[project_id] = _sorted_events(events)
    _STATE_STORE.pop(project_id, None)

    return MockSeedResponse(
        project_id=project_id,
        scenario=scenario,
        event_count=len(events),
    )
