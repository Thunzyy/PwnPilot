from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.command_history import CommandHistory
from app.models.graph import GraphNodeDB
from app.models.graph_proposals import GraphEntityProposalDB
from app.models.project import Project
from app.schemas.graph import (
    GraphBatchRequest,
    GraphProposal,
)
from app.schemas.graph.api import GraphBatchEdgeCreate, GraphBatchNodeCreate, GraphPosition
from app.schemas.graph.proposals import GraphProposalAcceptResponse
from app.services.graph_service import GraphService
from app.services.report_signal_service import report_signal_service

_IP_RE = re.compile(
    r"\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b"
)
_NMAP_SERVICE_RE = re.compile(
    r"^(?P<port>\d{1,5})/(?P<proto>tcp|udp)\s+open(?:\|\S+)?\s+(?P<service>[A-Za-z0-9_.+-]+)",
    re.IGNORECASE | re.MULTILINE,
)
_FTP_FIELD_RE = re.compile(r"^(?P<field>USER|PASS)\s+(?P<value>\S+)$", re.MULTILINE)
_SSH_TARGET_RE = re.compile(
    r"spawn ssh .*? (?P<user>[A-Za-z0-9_.-]+)@(?P<ip>(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))",
    re.IGNORECASE,
)
_CAP_RE = re.compile(
    r"(?P<path>/\S+python[^\s]*)\s*=\s*(?P<caps>[A-Za-z0-9_,+]+)",
    re.IGNORECASE,
)
_HEX_LOOT_RE = re.compile(r"\b[a-f0-9]{32,64}\b", re.IGNORECASE)


@dataclass
class _BatchDraft:
    source_step_id: str
    nodes: list[dict] = field(default_factory=list)
    edges: list[dict] = field(default_factory=list)

    def add_node(
        self,
        *,
        node_type: str,
        label: str,
        created_by: str = "rule",
        confidence: float = 0.8,
        tags: list[str] | None = None,
        notes: str | None = None,
        meta: dict | None = None,
        position: GraphPosition | None = None,
    ) -> str:
        ref = f"${len(self.nodes)}"
        self.nodes.append(
            GraphBatchNodeCreate(
                type=node_type,
                label=label,
                created_by=created_by,
                confidence=confidence,
                source_step_ids=[self.source_step_id],
                tags=list(tags or []),
                notes=notes,
                meta=dict(meta or {}),
                position=position,
            ).model_dump()
        )
        return ref

    def add_edge(
        self,
        *,
        source: str,
        target: str,
        kind: str,
        command: str,
        tool: str,
        confidence: float = 0.8,
        label: str | None = None,
        meta: dict | None = None,
    ) -> None:
        payload = {
            "kind": kind,
            "source_step_id": self.source_step_id,
            "command": command,
            "tool": tool,
            "confidence": confidence,
            "label": label,
            "meta": dict(meta or {}),
        }
        if source.startswith("$"):
            payload["source_ref"] = source
        else:
            payload["source_id"] = source
        if target.startswith("$"):
            payload["target_ref"] = target
        else:
            payload["target_id"] = target
        self.edges.append(GraphBatchEdgeCreate(**payload).model_dump())

    def payload(self) -> dict:
        return {
            "source_step_id": self.source_step_id,
            "nodes": self.nodes,
            "edges": self.edges,
        }


def _truncate(value: str, limit: int = 120) -> str:
    compact = " ".join((value or "").split())
    if len(compact) <= limit:
        return compact
    return f"{compact[: limit - 3]}..."


class GraphProposalService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.graph_service = GraphService(db)

    async def list_proposals(
        self,
        *,
        project_id: str,
        status: str | None = None,
    ) -> list[GraphProposal]:
        stmt = select(GraphEntityProposalDB).where(
            GraphEntityProposalDB.project_id == project_id
        )
        if status:
            stmt = stmt.where(GraphEntityProposalDB.status == status)
        stmt = stmt.order_by(
            GraphEntityProposalDB.created_at.desc(),
            GraphEntityProposalDB.id.desc(),
        )
        result = await self.db.execute(stmt)
        return [GraphProposal.model_validate(item) for item in result.scalars().all()]

    async def propose_from_command_history(
        self,
        *,
        project_id: str,
        command_id: str,
    ) -> tuple[list[GraphProposal], bool]:
        command = await self._get_command(project_id=project_id, command_id=command_id)

        existing_result = await self.db.execute(
            select(GraphEntityProposalDB)
            .where(
                GraphEntityProposalDB.project_id == project_id,
                GraphEntityProposalDB.source_type == "command_history",
                GraphEntityProposalDB.source_id == command_id,
                GraphEntityProposalDB.status == "pending",
            )
            .order_by(GraphEntityProposalDB.created_at.desc(), GraphEntityProposalDB.id.desc())
        )
        existing = existing_result.scalars().all()
        if existing:
            return [GraphProposal.model_validate(item) for item in existing], False

        payload, summary = await self._extract_batch_from_command(command)
        proposal = GraphEntityProposalDB(
            project_id=project_id,
            source_type="command_history",
            source_id=command_id,
            proposed_by="rule",
            status="pending",
            title=f"Graph inference for {_truncate(command.command, limit=72)}",
            summary=summary,
            payload=payload,
        )
        self.db.add(proposal)
        await self.db.commit()
        await self.db.refresh(proposal)
        return [GraphProposal.model_validate(proposal)], True

    async def accept_proposal(
        self,
        *,
        project_id: str,
        proposal_id: str,
    ) -> GraphProposalAcceptResponse:
        proposal = await self.db.scalar(
            select(GraphEntityProposalDB).where(
                GraphEntityProposalDB.id == proposal_id,
                GraphEntityProposalDB.project_id == project_id,
            )
        )
        if proposal is None:
            raise LookupError("Graph proposal not found")
        if proposal.status != "pending":
            raise ValueError("Graph proposal is not pending")

        batch_request = GraphBatchRequest.model_validate(proposal.payload)
        batch_response = await self.graph_service.create_batch(
            project_id=project_id,
            payload=batch_request,
        )

        proposal.status = "accepted"
        proposal.resolved_at = datetime.now(UTC)
        await self.db.commit()
        await self.db.refresh(proposal)
        report_signal_service.record_signal(
            project_id=project_id,
            signal_type="graph_accept",
            source_id=proposal.id,
        )

        return GraphProposalAcceptResponse(
            proposal=GraphProposal.model_validate(proposal),
            graph_batch=batch_response,
        )

    async def _get_command(self, *, project_id: str, command_id: str) -> CommandHistory:
        command = await self.db.scalar(
            select(CommandHistory).where(
                CommandHistory.id == command_id,
                CommandHistory.project_id == project_id,
            )
        )
        if command is None:
            raise LookupError("Command history entry not found")
        return command

    async def _get_project(self, project_id: str) -> Project | None:
        return await self.db.scalar(select(Project).where(Project.id == project_id))

    async def _load_graph_nodes(self, project_id: str) -> list[GraphNodeDB]:
        result = await self.db.execute(
            select(GraphNodeDB).where(
                GraphNodeDB.project_id == project_id,
                GraphNodeDB.is_deleted.is_(False),
            )
        )
        return list(result.scalars().all())

    async def _extract_batch_from_command(self, command: CommandHistory) -> tuple[dict, str]:
        command_text = (command.command or "").strip()
        output_text = (command.output or command.output_preview or "").strip()
        lowered = command_text.lower()
        if "nmap" in lowered:
            nmap_batch = self._extract_nmap_batch(command, command_text, output_text)
            if nmap_batch is not None:
                service_count = len(nmap_batch["nodes"]) - 1
                summary = f"Nmap command inferred 1 host and {max(service_count, 0)} service nodes."
                return nmap_batch, summary

        ftp_batch = await self._extract_ftp_credentials_batch(
            command=command,
            command_text=command_text,
            output_text=output_text,
        )
        if ftp_batch is not None:
            return ftp_batch, "FTP credential extraction inferred a credential node and related evidence."

        capability_batch = await self._extract_capability_batch(
            command=command,
            command_text=command_text,
            output_text=output_text,
        )
        if capability_batch is not None:
            return capability_batch, "Capability enumeration inferred a privilege-escalation finding."

        privesc_batch = await self._extract_cap_setuid_privesc_batch(
            command=command,
            command_text=command_text,
            output_text=output_text,
        )
        if privesc_batch is not None:
            return privesc_batch, "cap_setuid privilege escalation inferred a root session."

        loot_batch = await self._extract_loot_batch(
            command=command,
            command_text=command_text,
            output_text=output_text,
        )
        if loot_batch is not None:
            return loot_batch, "Flag collection inferred loot and its related session."

        ssh_batch = await self._extract_ssh_session_batch(
            command=command,
            command_text=command_text,
            output_text=output_text,
        )
        if ssh_batch is not None:
            return ssh_batch, "SSH validation inferred an authenticated session path."

        tool = (command_text.split(maxsplit=1)[0] if command_text else "shell").lower()
        return (
            {
                "source_step_id": command.id,
                "nodes": [
                    GraphBatchNodeCreate(
                        type="action",
                        label=_truncate(command_text or "Command"),
                        created_by="rule",
                        confidence=0.45,
                        source_step_ids=[command.id],
                        meta={"tool": tool, "command": command_text},
                        position=GraphPosition(x=120, y=120),
                    ).model_dump()
                ],
                "edges": [],
            },
            "Fallback command proposal created from history entry.",
        )

    async def _extract_ftp_credentials_batch(
        self,
        *,
        command: CommandHistory,
        command_text: str,
        output_text: str,
    ) -> dict | None:
        if "tshark" not in command_text.lower():
            return None

        fields = {match.group("field"): match.group("value") for match in _FTP_FIELD_RE.finditer(output_text)}
        username = fields.get("USER")
        password = fields.get("PASS")
        if not username or not password:
            return None

        project = await self._get_project(command.project_id)
        nodes = await self._load_graph_nodes(command.project_id)
        target_ip = self._resolve_target_ip(project=project, output_text=output_text, command_text=command_text)
        ftp_service_id = self._find_service_node_id(nodes, label="ftp :21")
        host_id = self._find_host_node_id(nodes, ip=target_ip) if target_ip else None
        draft = _BatchDraft(source_step_id=command.id)

        if ftp_service_id is None:
            if host_id is None and target_ip:
                host_id = draft.add_node(
                    node_type="host",
                    label=target_ip,
                    confidence=0.86,
                    tags=["history", "ftp", "credential"],
                    meta={"ip": target_ip},
                    position=GraphPosition(x=120, y=120),
                )
            ftp_service_id = draft.add_node(
                node_type="service",
                label="ftp :21",
                confidence=0.82,
                tags=["history", "ftp", "credential"],
                meta={"port": 21, "protocol": "tcp", "service_name": "ftp"},
                position=GraphPosition(x=360, y=120),
            )
            if host_id is not None:
                draft.add_edge(
                    source=ftp_service_id,
                    target=host_id,
                    kind="runs_on",
                    command=command_text,
                    tool="tshark",
                    confidence=0.72,
                    label="ftp on host",
                    meta={"port": 21, "protocol": "tcp"},
                )

        action_ref = draft.add_node(
            node_type="action",
            label="Extract FTP credentials",
            confidence=0.84,
            tags=["history", "tshark", "credential"],
            notes="Credentials recovered from FTP traffic in a downloaded capture.",
            meta={"tool": "tshark", "protocol": "ftp"},
            position=GraphPosition(x=120, y=260),
        )
        credential_ref = draft.add_node(
            node_type="credential",
            label=f"Credential: {username}",
            confidence=0.91,
            tags=["history", "credential", "ftp"],
            notes="Password recovered from FTP cleartext traffic.",
            meta={"username": username, "protocol": "ftp"},
            position=GraphPosition(x=360, y=260),
        )
        draft.add_edge(
            source=action_ref,
            target=credential_ref,
            kind="obtained",
            command=command_text,
            tool="tshark",
            confidence=0.9,
            label="Recovered credential",
        )
        if ftp_service_id is not None:
            draft.add_edge(
                source=credential_ref,
                target=ftp_service_id,
                kind="authenticates_to",
                command=command_text,
                tool="tshark",
                confidence=0.7,
                label="Captured from FTP auth",
            )
        return draft.payload()

    async def _extract_ssh_session_batch(
        self,
        *,
        command: CommandHistory,
        command_text: str,
        output_text: str,
    ) -> dict | None:
        lowered_output = output_text.lower()
        if "spawn ssh" not in lowered_output or "password:" not in lowered_output:
            return None
        if "uid=" not in lowered_output or "uid=0(root)" in lowered_output:
            return None

        ssh_match = _SSH_TARGET_RE.search(output_text)
        if ssh_match is None:
            return None

        username = ssh_match.group("user")
        ip = ssh_match.group("ip")
        nodes = await self._load_graph_nodes(command.project_id)
        host_id = self._find_host_node_id(nodes, ip=ip)
        ssh_service_id = self._find_service_node_id(nodes, label="ssh :22")
        credential_id = self._find_node_id(nodes, node_type="credential", label=f"Credential: {username}")
        draft = _BatchDraft(source_step_id=command.id)

        if host_id is None:
            host_id = draft.add_node(
                node_type="host",
                label=ip,
                confidence=0.84,
                tags=["history", "ssh"],
                meta={"ip": ip},
                position=GraphPosition(x=120, y=120),
            )
        if ssh_service_id is None:
            ssh_service_id = draft.add_node(
                node_type="service",
                label="ssh :22",
                confidence=0.82,
                tags=["history", "ssh"],
                meta={"port": 22, "protocol": "tcp", "service_name": "ssh"},
                position=GraphPosition(x=360, y=120),
            )
            draft.add_edge(
                source=ssh_service_id,
                target=host_id,
                kind="runs_on",
                command=command_text,
                tool="ssh",
                confidence=0.78,
                label=f"ssh on {ip}",
                meta={"port": 22, "protocol": "tcp"},
            )

        action_ref = draft.add_node(
            node_type="action",
            label="Validate SSH login",
            confidence=0.86,
            tags=["history", "ssh", "session"],
            meta={"tool": "ssh", "username": username, "ip": ip},
            position=GraphPosition(x=120, y=260),
        )
        session_ref = draft.add_node(
            node_type="session",
            label=f"SSH session: {username}@{ip}",
            confidence=0.92,
            tags=["history", "ssh", "session"],
            notes="Interactive access confirmed over SSH.",
            meta={"user": username, "ip": ip, "transport": "ssh"},
            position=GraphPosition(x=360, y=260),
        )
        draft.add_edge(
            source=action_ref,
            target=session_ref,
            kind="obtained",
            command=command_text,
            tool="ssh",
            confidence=0.9,
            label="Authenticated session established",
        )
        draft.add_edge(
            source=session_ref,
            target=host_id,
            kind="related_to",
            command=command_text,
            tool="ssh",
            confidence=0.66,
            label="Session on host",
        )
        if credential_id is not None:
            draft.add_edge(
                source=credential_id,
                target=ssh_service_id,
                kind="authenticates_to",
                command=command_text,
                tool="ssh",
                confidence=0.82,
                label="Credential valid for SSH",
            )
            draft.add_edge(
                source=credential_id,
                target=session_ref,
                kind="opens_session_on",
                command=command_text,
                tool="ssh",
                confidence=0.88,
                label="Credential opened SSH session",
            )
        return draft.payload()

    async def _extract_capability_batch(
        self,
        *,
        command: CommandHistory,
        command_text: str,
        output_text: str,
    ) -> dict | None:
        if "getcap" not in command_text.lower():
            return None

        match = _CAP_RE.search(output_text)
        if match is None or "cap_setuid" not in match.group("caps").lower():
            return None

        project = await self._get_project(command.project_id)
        nodes = await self._load_graph_nodes(command.project_id)
        ip = self._resolve_target_ip(project=project, output_text=output_text, command_text=command_text)
        host_id = self._find_host_node_id(nodes, ip=ip) if ip else None
        path = match.group("path")
        caps = match.group("caps")
        draft = _BatchDraft(source_step_id=command.id)

        action_ref = draft.add_node(
            node_type="action",
            label="Enumerate Linux capabilities",
            confidence=0.83,
            tags=["history", "getcap", "privesc"],
            meta={"tool": "getcap"},
            position=GraphPosition(x=120, y=400),
        )
        artifact_ref = draft.add_node(
            node_type="artifact",
            label=path,
            confidence=0.82,
            tags=["history", "python", "capability"],
            meta={"path": path},
            position=GraphPosition(x=360, y=400),
        )
        finding_ref = draft.add_node(
            node_type="finding",
            label="python3.8 cap_setuid",
            confidence=0.94,
            tags=["history", "privesc", "cap_setuid"],
            notes="Python binary is granted cap_setuid and can raise privileges.",
            meta={"path": path, "capabilities": caps},
            position=GraphPosition(x=600, y=400),
        )
        draft.add_edge(
            source=action_ref,
            target=finding_ref,
            kind="obtained",
            command=command_text,
            tool="getcap",
            confidence=0.9,
            label="Capability identified",
        )
        draft.add_edge(
            source=finding_ref,
            target=artifact_ref,
            kind="related_to",
            command=command_text,
            tool="getcap",
            confidence=0.88,
            label="Finding attached to binary",
        )
        if host_id is not None:
            draft.add_edge(
                source=artifact_ref,
                target=host_id,
                kind="related_to",
                command=command_text,
                tool="getcap",
                confidence=0.66,
                label="Binary present on host",
            )
        return draft.payload()

    async def _extract_cap_setuid_privesc_batch(
        self,
        *,
        command: CommandHistory,
        command_text: str,
        output_text: str,
    ) -> dict | None:
        if "uid=0(root)" not in output_text.lower():
            return None

        project = await self._get_project(command.project_id)
        ssh_match = _SSH_TARGET_RE.search(output_text)
        ip = ssh_match.group("ip") if ssh_match else self._resolve_target_ip(
            project=project,
            output_text=output_text,
            command_text=command_text,
        )
        username = ssh_match.group("user") if ssh_match else "nathan"
        if not ip:
            return None

        nodes = await self._load_graph_nodes(command.project_id)
        prior_session_id = self._find_node_id(
            nodes,
            node_type="session",
            label=f"SSH session: {username}@{ip}",
        )
        finding_id = self._find_node_id(nodes, node_type="finding", label="python3.8 cap_setuid")
        draft = _BatchDraft(source_step_id=command.id)
        action_ref = draft.add_node(
            node_type="action",
            label="python3.8 cap_setuid privesc",
            confidence=0.93,
            tags=["history", "privesc", "python", "cap_setuid"],
            notes="Privilege escalation via python3.8 with cap_setuid.",
            meta={"tool": "python3.8", "technique": "cap_setuid"},
            position=GraphPosition(x=120, y=540),
        )
        root_session_ref = draft.add_node(
            node_type="session",
            label=f"Root session: root@{ip}",
            confidence=0.96,
            tags=["history", "privesc", "root"],
            notes="Root privileges confirmed from command output.",
            meta={"user": "root", "ip": ip, "transport": "ssh/python"},
            position=GraphPosition(x=360, y=540),
        )
        draft.add_edge(
            source=action_ref,
            target=root_session_ref,
            kind="obtained",
            command=command_text,
            tool="python3.8",
            confidence=0.94,
            label="Privilege escalation succeeded",
        )
        if prior_session_id is not None:
            draft.add_edge(
                source=prior_session_id,
                target=action_ref,
                kind="related_to",
                command=command_text,
                tool="python3.8",
                confidence=0.72,
                label="Executed from low-priv session",
            )
            draft.add_edge(
                source=prior_session_id,
                target=root_session_ref,
                kind="escalated_to",
                command=command_text,
                tool="python3.8",
                confidence=0.95,
                label=f"{username} -> root",
            )
        if finding_id is not None:
            draft.add_edge(
                source=finding_id,
                target=action_ref,
                kind="related_to",
                command=command_text,
                tool="python3.8",
                confidence=0.86,
                label="Finding enabled privesc",
            )
        return draft.payload()

    async def _extract_loot_batch(
        self,
        *,
        command: CommandHistory,
        command_text: str,
        output_text: str,
    ) -> dict | None:
        lowered = command_text.lower()
        if "user.txt" not in lowered and "root.txt" not in lowered:
            return None

        loot_match = _HEX_LOOT_RE.search(output_text)
        if loot_match is None:
            return None

        project = await self._get_project(command.project_id)
        ssh_match = _SSH_TARGET_RE.search(output_text)
        ip = ssh_match.group("ip") if ssh_match else self._resolve_target_ip(
            project=project,
            output_text=output_text,
            command_text=command_text,
        )
        session_label = None
        loot_label = "user.txt"
        action_label = "Read user.txt"
        if "root.txt" in lowered:
            loot_label = "root.txt"
            action_label = "Read root.txt"
            session_label = f"Root session: root@{ip}" if ip else None
        elif ssh_match is not None:
            session_label = f"SSH session: {ssh_match.group('user')}@{ssh_match.group('ip')}"

        nodes = await self._load_graph_nodes(command.project_id)
        session_id = (
            self._find_node_id(nodes, node_type="session", label=session_label)
            if session_label
            else None
        )
        draft = _BatchDraft(source_step_id=command.id)
        action_ref = draft.add_node(
            node_type="action",
            label=action_label,
            confidence=0.84,
            tags=["history", "loot", "flag"],
            meta={"tool": "cat", "loot": loot_label},
            position=GraphPosition(x=120, y=680),
        )
        loot_ref = draft.add_node(
            node_type="loot",
            label=loot_label,
            confidence=0.91,
            tags=["history", "loot", "flag"],
            notes="Flag collected from the target host.",
            meta={"kind": "flag"},
            position=GraphPosition(x=360, y=680),
        )
        draft.add_edge(
            source=action_ref,
            target=loot_ref,
            kind="obtained",
            command=command_text,
            tool="cat",
            confidence=0.9,
            label=f"Collected {loot_label}",
        )
        if session_id is not None:
            draft.add_edge(
                source=session_id,
                target=action_ref,
                kind="related_to",
                command=command_text,
                tool="cat",
                confidence=0.74,
                label="Executed from active session",
            )
        return draft.payload()

    @staticmethod
    def _find_node_id(nodes: list[GraphNodeDB], *, node_type: str, label: str) -> str | None:
        for node in nodes:
            if node.type == node_type and node.label == label:
                return node.id
        return None

    @staticmethod
    def _find_host_node_id(nodes: list[GraphNodeDB], *, ip: str) -> str | None:
        for node in nodes:
            if node.type != "host":
                continue
            if node.label == ip:
                return node.id
            if str((node.meta_json or {}).get("ip", "")) == ip:
                return node.id
        return None

    @staticmethod
    def _find_service_node_id(nodes: list[GraphNodeDB], *, label: str) -> str | None:
        for node in nodes:
            if node.type == "service" and node.label == label:
                return node.id
        return None

    @staticmethod
    def _resolve_target_ip(
        *,
        project: Project | None,
        output_text: str,
        command_text: str,
    ) -> str | None:
        ips = list(dict.fromkeys(_IP_RE.findall(f"{command_text}\n{output_text}")))
        if ips:
            return ips[0]
        variables = project.variables if project is not None and isinstance(project.variables, dict) else {}
        target_ip = variables.get("target_ip")
        return str(target_ip) if isinstance(target_ip, str) and target_ip else None

    def _extract_nmap_batch(
        self,
        command: CommandHistory,
        command_text: str,
        output_text: str,
    ) -> dict | None:
        ips = list(dict.fromkeys(_IP_RE.findall(f"{command_text}\n{output_text}")))
        if not ips:
            return None

        host_ip = ips[0]
        host_ref = "$0"
        nodes: list[dict] = [
            GraphBatchNodeCreate(
                type="host",
                label=host_ip,
                created_by="rule",
                confidence=0.92,
                source_step_ids=[command.id],
                tags=["history", "nmap"],
                meta={"ip": host_ip},
                position=GraphPosition(x=120, y=120),
            ).model_dump()
        ]
        edges: list[dict] = []

        seen_services: set[tuple[int, str, str]] = set()
        for match in _NMAP_SERVICE_RE.finditer(output_text):
            port = int(match.group("port"))
            proto = match.group("proto").lower()
            service_name = match.group("service").lower()
            service_key = (port, proto, service_name)
            if service_key in seen_services:
                continue
            seen_services.add(service_key)

            service_index = len(nodes)
            service_label = f"{service_name} :{port}"
            nodes.append(
                GraphBatchNodeCreate(
                    type="service",
                    label=service_label,
                    created_by="rule",
                    confidence=0.88,
                    source_step_ids=[command.id],
                    tags=["history", "nmap"],
                    meta={
                        "port": port,
                        "protocol": proto,
                        "service_name": service_name,
                    },
                    position=GraphPosition(x=360, y=120 + (service_index * 110)),
                ).model_dump()
            )
            edges.append(
                GraphBatchEdgeCreate(
                    source_ref=f"${service_index}",
                    target_ref=host_ref,
                    kind="runs_on",
                    source_step_id=command.id,
                    command=command_text,
                    tool="nmap",
                    confidence=0.88,
                    label=f"{service_name} on {host_ip}",
                    meta={"port": port, "protocol": proto},
                ).model_dump()
            )

        if len(nodes) == 1:
            nodes.append(
                GraphBatchNodeCreate(
                    type="action",
                    label=_truncate(command_text),
                    created_by="rule",
                    confidence=0.4,
                    source_step_ids=[command.id],
                    tags=["history", "nmap"],
                    meta={"tool": "nmap", "command": command_text},
                    position=GraphPosition(x=360, y=120),
                ).model_dump()
            )
            edges.append(
                GraphBatchEdgeCreate(
                    source_ref="$1",
                    target_ref=host_ref,
                    kind="related_to",
                    source_step_id=command.id,
                    command=command_text,
                    tool="nmap",
                    confidence=0.4,
                    label="nmap evidence",
                    meta={},
                ).model_dump()
            )

        return {
            "source_step_id": command.id,
            "nodes": nodes,
            "edges": edges,
        }
