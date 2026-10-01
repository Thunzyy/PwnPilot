import { describe, expect, it } from "vitest";

import { layoutAttackGraph } from "../layout";
import type { AttackGraphEdge, AttackGraphNode } from "../types";

function makeNode(
  id: string,
  type: AttackGraphNode["type"],
  label: string,
  meta: Record<string, unknown> = {},
): AttackGraphNode {
  return {
    id,
    projectId: "proj-1",
    type,
    label,
    createdAt: "2026-04-23T00:00:00Z",
    updatedAt: "2026-04-23T00:00:00Z",
    createdBy: "rule",
    confidence: 1,
    sourceStepIds: [],
    tags: [],
    notes: null,
    position: null,
    meta,
  };
}

function makeEdge(
  id: string,
  sourceId: string,
  targetId: string,
  kind: AttackGraphEdge["kind"],
): AttackGraphEdge {
  return {
    id,
    projectId: "proj-1",
    sourceId,
    targetId,
    kind,
    sourceStepId: null,
    command: null,
    tool: null,
    createdAt: "2026-04-23T00:00:00Z",
    confidence: 1,
    label: null,
    meta: {},
  };
}

describe("layoutAttackGraph", () => {
  it("orders Cap-style nodes by attack phase from left to right", async () => {
    const nodes: AttackGraphNode[] = [
      makeNode("action-enum", "action", "Extract FTP credentials", {
        command: "tshark -r 0.pcap -Y ftp.request.command",
      }),
      makeNode("credential", "credential", "Credential: nathan", {
        username: "nathan",
      }),
      makeNode("ftp", "service", "ftp :21", { port: 21 }),
      makeNode("ssh", "service", "ssh :22", { port: 22 }),
      makeNode("http", "service", "http :80", { port: 80 }),
      makeNode("host", "host", "10.129.34.191", { ip: "10.129.34.191" }),
      makeNode("session", "session", "SSH session: nathan@10.129.34.191", {
        user: "nathan",
        privilege: "user",
        host_id: "host",
      }),
      makeNode("finding-privesc", "finding", "python3.8 cap_setuid", {
        severity: "high",
      }),
      makeNode("artifact-python", "artifact", "/usr/bin/python3.8", {
        path: "/usr/bin/python3.8",
      }),
      makeNode("action-privesc", "action", "python3.8 cap_setuid privesc", {
        command: "getcap /usr/bin/python3.8 && python3.8 -c 'import os; os.setuid(0)'",
      }),
      makeNode("root-session", "session", "Root session: root@10.129.34.191", {
        user: "root",
        privilege: "root",
        host_id: "host",
      }),
      makeNode("user-loot", "loot", "user.txt", {
        path: "/home/nathan/user.txt",
      }),
      makeNode("root-loot", "loot", "root.txt", {
        path: "/root/root.txt",
      }),
    ];

    const edges: AttackGraphEdge[] = [
      makeEdge("e1", "action-enum", "credential", "obtained"),
      makeEdge("e2", "credential", "ftp", "authenticates_to"),
      makeEdge("e3", "credential", "ssh", "authenticates_to"),
      makeEdge("e4", "credential", "session", "opens_session_on"),
      makeEdge("e5", "ftp", "host", "runs_on"),
      makeEdge("e6", "ssh", "host", "runs_on"),
      makeEdge("e7", "http", "host", "runs_on"),
      makeEdge("e8", "session", "user-loot", "related_to"),
      makeEdge("e9", "session", "finding-privesc", "related_to"),
      makeEdge("e10", "finding-privesc", "artifact-python", "related_to"),
      makeEdge("e11", "finding-privesc", "action-privesc", "related_to"),
      makeEdge("e12", "action-privesc", "root-session", "obtained"),
      makeEdge("e13", "session", "root-session", "escalated_to"),
      makeEdge("e14", "root-session", "root-loot", "related_to"),
    ];

    const positions = await layoutAttackGraph(nodes, edges);

    expect(positions.host.x).toBeLessThan(positions.credential.x);
    expect(positions.ftp.x).toBeLessThan(positions.credential.x);
    expect(positions.ssh.x).toBeLessThan(positions.credential.x);
    expect(positions.credential.x).toBeLessThan(positions.session.x);
    expect(positions.session.x).toBeLessThan(positions["finding-privesc"].x);
    expect(positions["finding-privesc"].x).toBeLessThan(positions["root-session"].x);
    expect(positions["root-session"].x).toBeLessThan(positions["root-loot"].x);
  });

  it("keeps lateral movement hosts on later columns while separating host lanes vertically", async () => {
    const nodes: AttackGraphNode[] = [
      makeNode("host-web01", "host", "WEB01", { ip: "10.10.110.10" }),
      makeNode("service-http", "service", "http :80", { port: 80 }),
      makeNode("session-root", "session", "Root session: root@WEB01", {
        user: "root",
        privilege: "root",
        host_id: "host-web01",
      }),
      makeNode("action-svc-cred", "action", "Extract svc_backup credential", {
        command: "cat backup.key",
      }),
      makeNode("credential-svc", "credential", "Credential: svc_backup", {
        username: "svc_backup",
      }),
      makeNode("host-file01", "host", "FILE01", { ip: "10.10.120.25" }),
      makeNode("service-smb", "service", "smb :445", { port: 445 }),
      makeNode("action-netexec", "action", "Validate SMB pivot", {
        command: "netexec smb 10.10.120.25 -u svc_backup -p ...",
      }),
      makeNode("session-smb", "session", "SMB session: svc_backup@FILE01", {
        user: "svc_backup",
        privilege: "user",
        host_id: "host-file01",
      }),
      makeNode("loot-forensic", "loot", "forensic.zip", {
        path: "/shares/forensic.zip",
      }),
    ];

    const edges: AttackGraphEdge[] = [
      makeEdge("edge-http-web", "service-http", "host-web01", "runs_on"),
      makeEdge("edge-root-action", "session-root", "action-svc-cred", "related_to"),
      makeEdge("edge-action-cred", "action-svc-cred", "credential-svc", "obtained"),
      makeEdge("edge-root-pivot", "session-root", "host-file01", "pivots_to"),
      makeEdge("edge-smb-file", "service-smb", "host-file01", "runs_on"),
      makeEdge("edge-cred-auth", "credential-svc", "service-smb", "authenticates_to"),
      makeEdge("edge-action-session", "action-netexec", "session-smb", "obtained"),
      makeEdge("edge-cred-session", "credential-svc", "session-smb", "opens_session_on"),
      makeEdge("edge-session-action", "session-smb", "action-netexec", "related_to"),
      makeEdge("edge-session-loot", "session-smb", "loot-forensic", "related_to"),
    ];

    const positions = await layoutAttackGraph(nodes, edges);

    expect(positions["host-file01"].x).toBeGreaterThan(positions["host-web01"].x);
    expect(positions["service-smb"].x).toBeGreaterThanOrEqual(positions["host-file01"].x - 60);
    expect(positions["credential-svc"].x).toBeLessThan(positions["session-smb"].x);
    expect(Math.abs(positions["host-web01"].y - positions["host-file01"].y)).toBeGreaterThan(180);
    expect(Math.abs(positions["host-file01"].y - positions["service-smb"].y)).toBeLessThan(180);
  });
});
