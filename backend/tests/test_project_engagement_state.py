from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.ai import AIChatMessage, AIConversation, AIMemory
from app.models.command_history import CommandHistory
from app.models.graph import GraphNodeDB
from app.models.knowledge import KnowledgeDoc, KnowledgeSource
from app.models.terminal_session import TerminalSessionDB
from app.models.timeline import Timeline
from app.models.timeline_kb_link import TimelineKBLink
from app.services.engagement_provider_factory import (
    get_engagement_event_provider,
    get_engagement_state_store,
)
from app.services.engagement_rules import RULES_BY_SECTION
from tests.factories.engagement_traces import (
    scenario_enriched_mixed_ops,
    scenario_exploitation_failure,
    scenario_exploitation_success,
    scenario_full_path,
    scenario_phase_transition_with_failure,
    scenario_pwnbox_realistic,
    scenario_recon,
)


def _auth(headers: dict[str, str]) -> dict[str, str]:
    return {"Authorization": headers["Authorization"]}


@pytest.fixture(autouse=True)
def _force_local_engagement_providers():
    prev_event_provider = settings.engagement_event_provider
    prev_state_store = settings.engagement_state_store
    prev_mcp_base_url = settings.engagement_mcp_base_url

    settings.engagement_event_provider = "local"
    settings.engagement_state_store = "project_variables"
    settings.engagement_mcp_base_url = ""
    get_engagement_event_provider.cache_clear()
    get_engagement_state_store.cache_clear()

    yield

    settings.engagement_event_provider = prev_event_provider
    settings.engagement_state_store = prev_state_store
    settings.engagement_mcp_base_url = prev_mcp_base_url
    get_engagement_event_provider.cache_clear()
    get_engagement_state_store.cache_clear()


async def _create_project(client: AsyncClient, headers: dict[str, str]) -> dict:
    response = await client.post(
        "/api/v1/projects",
        json={"name": f"Engagement {uuid.uuid4().hex[:8]}", "type": "htb"},
        headers=_auth(headers),
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _get_current_user_id(client: AsyncClient, headers: dict[str, str]) -> str:
    response = await client.get("/api/v1/auth/me", headers=_auth(headers))
    assert response.status_code == 200, response.text
    return response.json()["id"]


async def _create_terminal_session(
    db: AsyncSession, project_id: str, *, session_id: str | None = None
) -> TerminalSessionDB:
    actual_session_id = session_id or f"sess-{uuid.uuid4().hex[:8]}"
    session = TerminalSessionDB(
        id=actual_session_id,
        project_id=project_id,
        name="Main",
        master_token="master-token",
        viewer_token="viewer-token",
        is_alive=True,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


async def _insert_command(
    db: AsyncSession,
    *,
    project_id: str,
    session_id: str,
    user_id: str,
    command: str,
    exit_code: int,
) -> CommandHistory:
    entry = CommandHistory(
        id=str(uuid.uuid4()),
        project_id=project_id,
        session_id=session_id,
        command=command,
        output="ok" if exit_code == 0 else "error",
        output_preview="ok" if exit_code == 0 else "error",
        exit_code=exit_code,
        cwd="/tmp",
        duration_ms=100,
        executed_by=user_id,
        source="user",
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return entry


async def _insert_timeline_entry(
    db: AsyncSession,
    *,
    project_id: str,
    entry_type: str,
    content: str,
    output: str | None = None,
) -> Timeline:
    entry = Timeline(
        project_id=project_id,
        type=entry_type,
        content=content,
        output=output,
        entry_data={},
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return entry


async def _insert_graph_nodes(
    db: AsyncSession,
    *,
    project_id: str,
    labels: list[tuple[str, str, list[str]]],
) -> None:
    nodes = [
        GraphNodeDB(
            project_id=project_id,
            type=node_type,
            label=label,
            tags=tags,
            sequence_index=index,
            created_by="rule",
        )
        for index, (node_type, label, tags) in enumerate(labels, start=1)
    ]
    db.add_all(nodes)
    await db.commit()


async def _insert_ai_conversation(
    db: AsyncSession,
    *,
    project_id: str,
    user_id: str,
    title: str = "AI engagement analysis",
) -> AIConversation:
    conversation = AIConversation(
        user_id=user_id,
        project_id=project_id,
        title=title,
    )
    db.add(conversation)
    await db.commit()
    await db.refresh(conversation)
    return conversation


async def _insert_ai_message(
    db: AsyncSession,
    *,
    conversation_id: str,
    role: str,
    content: str,
    error: str | None = None,
) -> AIChatMessage:
    message = AIChatMessage(
        conversation_id=conversation_id,
        role=role,
        content=content,
        error=error,
    )
    db.add(message)
    await db.commit()
    await db.refresh(message)
    return message


async def _insert_ai_memory(
    db: AsyncSession,
    *,
    project_id: str,
    user_id: str,
    key: str,
    value: str,
) -> AIMemory:
    memory = AIMemory(
        user_id=user_id,
        project_id=project_id,
        key=key,
        value=value,
    )
    db.add(memory)
    await db.commit()
    await db.refresh(memory)
    return memory


async def _create_knowledge_doc(
    db: AsyncSession,
    *,
    project_id: str,
    user_id: str,
    title: str,
    relative_path: str,
    tags: str | None = None,
) -> KnowledgeDoc:
    source = KnowledgeSource(
        name="Smoke KB",
        source_type="local",
        path="/tmp/smoke-kb",
        user_id=user_id,
        project_id=project_id,
    )
    db.add(source)
    await db.commit()
    await db.refresh(source)

    doc = KnowledgeDoc(
        source_id=source.id,
        title=title,
        relative_path=relative_path,
        body=f"# {title}",
        tags=tags,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return doc


async def _link_timeline_doc(
    db: AsyncSession,
    *,
    timeline_entry_id: str,
    doc_id: str,
) -> TimelineKBLink:
    link = TimelineKBLink(
        timeline_entry_id=timeline_entry_id,
        doc_id=doc_id,
    )
    db.add(link)
    await db.commit()
    await db.refresh(link)
    return link


async def _derive_state_payload(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
    commands: list[tuple[str, int]],
) -> dict:
    project = await _create_project(client, auth_headers)
    user_id = await _get_current_user_id(client, auth_headers)
    session = await _create_terminal_session(test_db, project["id"])

    for command, exit_code in commands:
        await _insert_command(
            test_db,
            project_id=project["id"],
            session_id=session.id,
            user_id=user_id,
            command=command,
            exit_code=exit_code,
        )

    response = await client.get(
        f"/api/v1/projects/{project['id']}/engagement-state",
        headers=_auth(auth_headers),
    )
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.anyio
async def test_engagement_state_get_derives_from_project_commands(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    project = await _create_project(client, auth_headers)
    user_id = await _get_current_user_id(client, auth_headers)
    session = await _create_terminal_session(test_db, project["id"])

    await _insert_command(
        test_db,
        project_id=project["id"],
        session_id=session.id,
        user_id=user_id,
        command="nmap -sV 10.10.10.10",
        exit_code=0,
    )
    await _insert_command(
        test_db,
        project_id=project["id"],
        session_id=session.id,
        user_id=user_id,
        command="hydra -l admin -P rockyou ssh://10.10.10.10",
        exit_code=1,
    )

    response = await client.get(
        f"/api/v1/projects/{project['id']}/engagement-state",
        headers=_auth(auth_headers),
    )

    assert response.status_code == 200, response.text
    payload = response.json()

    assert payload["version"] == "v1"
    assert payload["source"] == "derived"
    assert isinstance(payload["sections"], list)
    assert isinstance(payload["graph"]["nodes"], list)
    assert isinstance(payload["graph"]["edges"], list)
    assert payload["graph"]["nodes"]

    recon = next((section for section in payload["sections"] if section["id"] == "recon"), None)
    assert recon is not None
    assert any("nmap" in item["label"].lower() for item in recon["items"])

    assert any("nmap" in node["title"].lower() for node in payload["graph"]["nodes"])
    assert payload["progress"] >= 0


@pytest.mark.anyio
async def test_engagement_state_progress_caps_recon_only_by_phase_weight(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    payload = await _derive_state_payload(
        client,
        auth_headers,
        test_db,
        scenario_recon(),
    )

    assert payload["source"] == "derived"
    assert 1 <= payload["progress"] <= 35


@pytest.mark.anyio
async def test_engagement_state_progress_weights_exploitation_above_recon(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    recon_payload = await _derive_state_payload(
        client,
        auth_headers,
        test_db,
        scenario_recon(),
    )

    exploit_payload = await _derive_state_payload(
        client,
        auth_headers,
        test_db,
        scenario_exploitation_success(),
    )

    assert exploit_payload["progress"] > recon_payload["progress"]


@pytest.mark.anyio
async def test_engagement_state_progress_orders_empty_failure_recon_full(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    empty_payload = await _derive_state_payload(client, auth_headers, test_db, [])
    failure_payload = await _derive_state_payload(
        client,
        auth_headers,
        test_db,
        scenario_exploitation_failure(),
    )
    recon_payload = await _derive_state_payload(
        client,
        auth_headers,
        test_db,
        scenario_recon(),
    )
    full_payload = await _derive_state_payload(
        client,
        auth_headers,
        test_db,
        scenario_full_path(),
    )

    assert empty_payload["progress"] == 0
    assert failure_payload["progress"] <= recon_payload["progress"]
    assert full_payload["progress"] > recon_payload["progress"]
    assert full_payload["progress"] >= 60


@pytest.mark.anyio
async def test_engagement_state_includes_global_steps_when_history_is_empty(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    payload = await _derive_state_payload(client, auth_headers, test_db, [])

    assert payload["source"] == "derived"
    assert payload["progress"] == 0
    assert payload["graph"]["nodes"] == []
    assert payload["graph"]["edges"] == []

    by_id = {section["id"]: section for section in payload["sections"]}
    assert set(by_id) == {"recon", "exploitation", "privesc", "postexp"}
    assert by_id["recon"]["is_open"] is True
    assert all(
        by_id[section_id]["is_open"] is False
        for section_id in {"exploitation", "privesc", "postexp"}
    )

    for section_id, section in by_id.items():
        expected_count = len(RULES_BY_SECTION.get(section_id, ()))
        assert len(section["items"]) == expected_count
        assert all(item["status"] == "pending" for item in section["items"])
        assert all(item["evidence_count"] == 0 for item in section["items"])
        assert all(item["success_count"] == 0 for item in section["items"])
        assert all(item["failure_count"] == 0 for item in section["items"])


@pytest.mark.anyio
async def test_engagement_state_pwnbox_scenario_marks_realized_steps(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    trace = scenario_pwnbox_realistic()
    payload = await _derive_state_payload(client, auth_headers, test_db, trace)

    assert payload["source"] == "derived"
    assert payload["progress"] >= 60
    assert len(payload["graph"]["nodes"]) == len(trace)

    by_section = {section["id"]: section for section in payload["sections"]}

    def _status(section_id: str, item_id: str) -> str:
        section = by_section[section_id]
        item = next(item for item in section["items"] if item["id"] == item_id)
        return item["status"]

    assert _status("recon", "recon-port-scan") == "done"
    assert _status("recon", "recon-web-discovery") == "done"
    assert _status("exploitation", "exploit-sqli") == "done"
    assert _status("exploitation", "exploit-credential-attack") == "pending"
    assert _status("privesc", "privesc-linux-enum") == "done"
    assert _status("postexp", "postexp-credential-dump") == "done"
    assert _status("postexp", "postexp-lateral") == "active"


@pytest.mark.anyio
async def test_engagement_state_maps_cap_style_flow_to_foothold_and_privesc(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    payload = await _derive_state_payload(
        client,
        auth_headers,
        test_db,
        [
            ("export IP=10.129.34.191", 0),
            ('nmap -Pn -sC -sV "$IP"', 0),
            ("curl -s http://$IP/capture | grep -oE '(/data/[0-9]+|/download/[0-9]+|pcap|Download)'", 0),
            ('tshark -r 0.pcap -Y "ftp.request.command == \\"USER\\" || ftp.request.command == \\"PASS\\"" -T fields -e ftp.request.command -e ftp.request.arg', 0),
            ('expect -c \'spawn ssh -o StrictHostKeyChecking=no nathan@$env(IP) id; expect "password:" { send "$env(CAPPASS)\\r" }; expect eof\'', 0),
            ('expect -c \'spawn ssh nathan@$env(IP) "getcap /usr/bin/python3.8 2>/dev/null"; expect "password:" { send "$env(CAPPASS)\\r" }; expect eof\'', 0),
            ("ssh nathan@$IP \"/usr/bin/python3.8 -c 'import os; os.setuid(0); os.system(\\\"id && whoami\\\")'\"", 0),
        ],
    )

    by_section = {section["id"]: section for section in payload["sections"]}

    def _item(section_id: str, item_id: str) -> dict:
        return next(item for item in by_section[section_id]["items"] if item["id"] == item_id)

    assert _item("recon", "recon-port-scan")["status"] == "done"
    assert _item("recon", "recon-web-discovery")["status"] == "done"
    assert _item("exploitation", "exploit-credential-discovery")["status"] == "done"
    assert _item("exploitation", "exploit-remote-login")["status"] == "done"
    assert _item("privesc", "privesc-linux-enum")["status"] == "active"


@pytest.mark.anyio
async def test_engagement_state_uses_attack_graph_nodes_to_update_methodology(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    project = await _create_project(client, auth_headers)
    await _insert_graph_nodes(
        test_db,
        project_id=project["id"],
        labels=[
            ("credential", "Credential: nathan", ["history", "credential", "ftp"]),
            ("session", "SSH session: nathan@10.129.34.191", ["history", "ssh", "session"]),
            ("finding", "python3.8 cap_setuid", ["history", "privesc", "cap_setuid"]),
            ("loot", "root.txt", ["history", "loot", "flag"]),
        ],
    )

    response = await client.get(
        f"/api/v1/projects/{project['id']}/engagement-state",
        headers=_auth(auth_headers),
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    by_section = {section["id"]: section for section in payload["sections"]}

    def _item(section_id: str, item_id: str) -> dict:
        return next(item for item in by_section[section_id]["items"] if item["id"] == item_id)

    assert _item("exploitation", "exploit-credential-discovery")["status"] == "done"
    assert _item("exploitation", "exploit-remote-login")["status"] == "done"
    assert _item("privesc", "privesc-linux-enum")["status"] == "done"
    assert _item("postexp", "postexp-loot")["status"] == "done"
    assert payload["progress"] == 100


@pytest.mark.anyio
async def test_engagement_state_does_not_complete_lab_from_failed_root_attempt(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    payload = await _derive_state_payload(
        client,
        auth_headers,
        test_db,
        [
            ("nmap -sV 10.10.10.10", 0),
            ("ssh root@10.10.10.10 id", 1),
        ],
    )

    assert payload["progress"] < 100
    assert all(node["status"] != "success" for node in payload["graph"]["nodes"] if "root@" in node["title"])


@pytest.mark.anyio
async def test_engagement_state_enriches_broader_activity_and_uses_phase_layout(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    payload = await _derive_state_payload(
        client,
        auth_headers,
        test_db,
        scenario_enriched_mixed_ops(),
    )

    by_section = {section["id"]: section for section in payload["sections"]}

    def _item(section_id: str, item_id: str) -> dict:
        return next(item for item in by_section[section_id]["items"] if item["id"] == item_id)

    assert _item("recon", "recon-service-fingerprint")["status"] == "done"
    assert _item("exploitation", "exploit-framework")["status"] == "done"
    assert _item("privesc", "privesc-windows-enum")["status"] == "done"
    assert _item("postexp", "postexp-lateral")["status"] == "done"
    assert _item("postexp", "postexp-loot")["status"] == "active"

    nodes = {node["id"]: node for node in payload["graph"]["nodes"]}

    recon_x = float(nodes[next(node_id for node_id in nodes if "enum4linux" in nodes[node_id]["title"].lower())]["position"]["x"].replace("%", ""))
    exploit_x = float(nodes[next(node_id for node_id in nodes if "msfconsole" in nodes[node_id]["title"].lower())]["position"]["x"].replace("%", ""))
    privesc_x = float(nodes[next(node_id for node_id in nodes if "winpeas" in nodes[node_id]["title"].lower())]["position"]["x"].replace("%", ""))
    lateral_x = float(nodes[next(node_id for node_id in nodes if "chisel" in nodes[node_id]["title"].lower())]["position"]["x"].replace("%", ""))

    assert recon_x < exploit_x < privesc_x < lateral_x
    assert len({node["position"]["y"] for node in payload["graph"]["nodes"]}) > 1


@pytest.mark.anyio
async def test_engagement_state_sidebar_items_are_objective_based_and_deduplicated(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    payload = await _derive_state_payload(
        client,
        auth_headers,
        test_db,
        [
            ("nmap -sV 10.10.10.10", 0),
            ("nmap --top-ports 1000 10.10.10.10", 1),
            ("nmap -Pn -p- 10.10.10.10", 0),
        ],
    )

    recon = next((section for section in payload["sections"] if section["id"] == "recon"), None)
    assert recon is not None

    nmap_items = [item for item in recon["items"] if "nmap" in item["label"].lower()]
    assert len(nmap_items) == 1

    item = nmap_items[0]
    assert item["evidence_count"] == 3
    assert item["last_seen_at"] is not None


@pytest.mark.anyio
async def test_engagement_state_graph_adds_phase_transitions_and_branch_kinds(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    payload = await _derive_state_payload(
        client,
        auth_headers,
        test_db,
        scenario_phase_transition_with_failure(),
    )

    nodes = payload["graph"]["nodes"]
    edges = payload["graph"]["edges"]
    assert nodes
    assert edges

    hydra_node = next((node for node in nodes if "hydra" in node["title"].lower()), None)
    assert hydra_node is not None
    assert hydra_node["type"] == "failure"
    assert hydra_node["status"] == "failure"
    assert hydra_node["section_id"] == "exploitation"

    phase_transition_edge = next(
        (edge for edge in edges if edge.get("kind") == "phase-transition"),
        None,
    )
    assert phase_transition_edge is not None

    failure_branch_edge = next(
        (
            edge
            for edge in edges
            if edge.get("branch") == "failure" and edge.get("kind") == "sequence"
        ),
        None,
    )
    assert failure_branch_edge is not None


@pytest.mark.anyio
async def test_engagement_state_graph_caps_and_keeps_latest_history_window(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    commands: list[tuple[str, int]] = []
    for index in range(120):
        if index % 4 == 0:
            command = f"nmap -sV 10.10.10.{(index % 200) + 1} #cmd-{index}"
        elif index % 4 == 1:
            command = f"hydra -l admin -P /tmp/list ssh://10.10.10.10 #cmd-{index}"
        elif index % 4 == 2:
            command = f"linpeas.sh #cmd-{index}"
        else:
            command = f"bloodhound-python -c All #cmd-{index}"
        exit_code = 0 if index % 7 else 1
        commands.append((command, exit_code))

    payload = await _derive_state_payload(client, auth_headers, test_db, commands)
    nodes = payload["graph"]["nodes"]
    edges = payload["graph"]["edges"]

    assert len(nodes) == 80
    assert all("cmd-0" not in node["title"] for node in nodes)
    assert any("cmd-119" in node["title"] for node in nodes)
    assert nodes[-1]["status"] in {"success", "failure"}

    node_ids = {node["id"] for node in nodes}
    assert len(edges) <= 160
    assert all(edge["source_id"] in node_ids for edge in edges)
    assert all(edge["target_id"] in node_ids for edge in edges)


@pytest.mark.anyio
async def test_engagement_state_derives_from_timeline_note_without_commands(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    project = await _create_project(client, auth_headers)
    await _insert_timeline_entry(
        test_db,
        project_id=project["id"],
        entry_type="finding",
        content="SeImpersonatePrivilege identified on the target",
        output="PrintSpoofer likely lands SYSTEM on this host",
    )

    response = await client.get(
        f"/api/v1/projects/{project['id']}/engagement-state",
        headers=_auth(auth_headers),
    )
    assert response.status_code == 200, response.text

    payload = response.json()
    by_section = {section["id"]: section for section in payload["sections"]}
    privesc_item = next(
        item
        for item in by_section["privesc"]["items"]
        if item["id"] == "privesc-windows-enum"
    )

    assert payload["source"] == "derived"
    assert privesc_item["status"] == "active"
    assert any(
        "seimpersonateprivilege identified on the target" in node["title"].lower()
        for node in payload["graph"]["nodes"]
    )
    assert any(
        "timeline finding" in node["subtitle"].lower()
        for node in payload["graph"]["nodes"]
    )


@pytest.mark.anyio
async def test_engagement_state_enriches_timeline_nodes_with_linked_knowledge(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    project = await _create_project(client, auth_headers)
    user_id = await _get_current_user_id(client, auth_headers)
    timeline_entry = await _insert_timeline_entry(
        test_db,
        project_id=project["id"],
        entry_type="note",
        content="Linked PrintSpoofer research for escalation validation",
        output="Reference note for Windows privesc path",
    )
    doc = await _create_knowledge_doc(
        test_db,
        project_id=project["id"],
        user_id=user_id,
        title="PrintSpoofer escalation",
        relative_path="priv-esc/printspoofer.md",
        tags="windows privesc mitre:T1068",
    )
    await _link_timeline_doc(
        test_db,
        timeline_entry_id=timeline_entry.id,
        doc_id=doc.id,
    )

    response = await client.get(
        f"/api/v1/projects/{project['id']}/engagement-state",
        headers=_auth(auth_headers),
    )
    assert response.status_code == 200, response.text

    payload = response.json()
    linked_node = next(
        node
        for node in payload["graph"]["nodes"]
        if "linked printspoofer research" in node["title"].lower()
    )

    assert "linked kb" in linked_node["subtitle"].lower()
    assert "printspoofer escalation" in linked_node["subtitle"].lower()


@pytest.mark.anyio
async def test_engagement_state_uses_linked_mitre_tags_to_hint_the_phase(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    project = await _create_project(client, auth_headers)
    user_id = await _get_current_user_id(client, auth_headers)
    timeline_entry = await _insert_timeline_entry(
        test_db,
        project_id=project["id"],
        entry_type="note",
        content="Review escalation hypothesis from linked knowledge",
        output="Need to validate the suggested path",
    )
    doc = await _create_knowledge_doc(
        test_db,
        project_id=project["id"],
        user_id=user_id,
        title="Kernel exploit note",
        relative_path="privesc/kernel-note.md",
        tags="windows review mitre:T1068",
    )
    await _link_timeline_doc(
        test_db,
        timeline_entry_id=timeline_entry.id,
        doc_id=doc.id,
    )

    response = await client.get(
        f"/api/v1/projects/{project['id']}/engagement-state",
        headers=_auth(auth_headers),
    )
    assert response.status_code == 200, response.text

    payload = response.json()
    by_section = {section["id"]: section for section in payload["sections"]}
    privesc_item = next(
        item for item in by_section["privesc"]["items"] if item["id"] == "privesc-manual"
    )
    linked_node = next(
        node
        for node in payload["graph"]["nodes"]
        if "review escalation hypothesis" in node["title"].lower()
    )

    assert privesc_item["status"] == "active"
    assert "mitre t1068" in linked_node["subtitle"].lower()


@pytest.mark.anyio
async def test_engagement_state_derives_from_ai_conversation_messages(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    project = await _create_project(client, auth_headers)
    user_id = await _get_current_user_id(client, auth_headers)
    conversation = await _insert_ai_conversation(
        test_db,
        project_id=project["id"],
        user_id=user_id,
    )
    await _insert_ai_message(
        test_db,
        conversation_id=conversation.id,
        role="assistant",
        content="Run bloodhound-python to map domain trust paths after credential access.",
    )

    response = await client.get(
        f"/api/v1/projects/{project['id']}/engagement-state",
        headers=_auth(auth_headers),
    )
    assert response.status_code == 200, response.text

    payload = response.json()
    by_section = {section["id"]: section for section in payload["sections"]}
    lateral_item = next(
        item for item in by_section["postexp"]["items"] if item["id"] == "postexp-lateral"
    )

    assert lateral_item["status"] == "active"
    assert any(
        "ai assistant" in node["subtitle"].lower()
        and "bloodhound-python" in node["title"].lower()
        for node in payload["graph"]["nodes"]
    )


@pytest.mark.anyio
async def test_engagement_state_derives_from_ai_memory_with_mitre_context(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    project = await _create_project(client, auth_headers)
    user_id = await _get_current_user_id(client, auth_headers)
    await _insert_ai_memory(
        test_db,
        project_id=project["id"],
        user_id=user_id,
        key="windows_privesc_path",
        value="AI memory: T1068 likely applies on this host after the current foothold.",
    )

    response = await client.get(
        f"/api/v1/projects/{project['id']}/engagement-state",
        headers=_auth(auth_headers),
    )
    assert response.status_code == 200, response.text

    payload = response.json()
    by_section = {section["id"]: section for section in payload["sections"]}
    privesc_item = next(
        item for item in by_section["privesc"]["items"] if item["id"] == "privesc-manual"
    )

    assert privesc_item["status"] == "active"
    assert any(
        "ai memory" in node["subtitle"].lower() and "mitre t1068" in node["subtitle"].lower()
        for node in payload["graph"]["nodes"]
    )


@pytest.mark.anyio
async def test_engagement_state_put_persists_custom_state(
    client: AsyncClient,
    auth_headers: dict[str, str],
):
    project = await _create_project(client, auth_headers)

    custom_state = {
        "version": "v1",
        "sections": [
            {
                "id": "custom",
                "label": "Custom Phase",
                "is_open": True,
                "items": [
                    {"id": "step-1", "label": "Custom Step", "status": "active"}
                ],
            }
        ],
        "graph": {
            "nodes": [
                {
                    "id": "node-1",
                    "type": "action",
                    "title": "Custom Step",
                    "subtitle": "Active",
                    "icon": "bolt",
                    "position": {"x": "50%", "y": "50%"},
                }
            ],
            "edges": [],
        },
        "progress": 40,
    }

    put_response = await client.put(
        f"/api/v1/projects/{project['id']}/engagement-state",
        json=custom_state,
        headers=_auth(auth_headers),
    )
    assert put_response.status_code == 200, put_response.text
    assert put_response.json()["source"] == "stored"

    get_response = await client.get(
        f"/api/v1/projects/{project['id']}/engagement-state",
        headers=_auth(auth_headers),
    )
    assert get_response.status_code == 200, get_response.text

    state = get_response.json()
    assert state["source"] == "stored"
    assert state["sections"][0]["label"] == "Custom Phase"
    assert state["sections"][0]["items"][0]["label"] == "Custom Step"
    assert state["graph"]["nodes"][0]["title"] == "Custom Step"


@pytest.mark.anyio
async def test_engagement_state_stored_snapshot_does_not_block_new_derived_activity(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_db: AsyncSession,
):
    project = await _create_project(client, auth_headers)
    user_id = await _get_current_user_id(client, auth_headers)
    session = await _create_terminal_session(test_db, project["id"])

    await _insert_command(
        test_db,
        project_id=project["id"],
        session_id=session.id,
        user_id=user_id,
        command="nmap -sV 10.129.34.191",
        exit_code=0,
    )

    initial_response = await client.get(
        f"/api/v1/projects/{project['id']}/engagement-state",
        headers=_auth(auth_headers),
    )
    assert initial_response.status_code == 200, initial_response.text
    stored_state = initial_response.json()
    stored_state.pop("source", None)
    for section in stored_state["sections"]:
        if section["id"] == "recon":
            section["is_open"] = False

    put_response = await client.put(
        f"/api/v1/projects/{project['id']}/engagement-state",
        json=stored_state,
        headers=_auth(auth_headers),
    )
    assert put_response.status_code == 200, put_response.text

    await _insert_command(
        test_db,
        project_id=project["id"],
        session_id=session.id,
        user_id=user_id,
        command="getcap -r / 2>/dev/null",
        exit_code=0,
    )

    response = await client.get(
        f"/api/v1/projects/{project['id']}/engagement-state",
        headers=_auth(auth_headers),
    )
    assert response.status_code == 200, response.text
    payload = response.json()

    by_section = {section["id"]: section for section in payload["sections"]}
    linux_privesc = next(
        item for item in by_section["privesc"]["items"] if item["id"] == "privesc-linux-enum"
    )
    port_scan = next(
        item for item in by_section["recon"]["items"] if item["id"] == "recon-port-scan"
    )

    assert payload["source"] == "stored"
    assert by_section["recon"]["is_open"] is False
    assert port_scan["status"] == "done"
    assert linux_privesc["status"] == "active"
    assert linux_privesc["evidence_count"] == 1
    assert any("getcap" in node["title"].lower() for node in payload["graph"]["nodes"])
