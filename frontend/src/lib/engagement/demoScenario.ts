import type { Project } from "@/types";
import type {
  EngagementChecklistItem,
  EngagementChecklistSection,
  EngagementDemoProfile,
  EngagementDemoProfileId,
  EngagementGraphEdge,
  EngagementGraphNode,
  ProjectEngagementStateUpdate,
} from "@/types/engagement";

type ProjectType = Project["type"] | undefined;

const SECTION_META = {
  recon: { label: "Reconnaissance", icon: "radar" },
  exploitation: { label: "Exploitation", icon: "bug_report" },
  privesc: { label: "Privilege Escalation", icon: "key" },
  postexp: { label: "Post-Exploitation", icon: "inventory_2" },
} as const;

const progressByType: Record<NonNullable<ProjectType>, number> = {
  htb: 74,
  ctf: 74,
  thm: 70,
  real: 68,
  custom: 72,
};

export const ENGAGEMENT_DEMO_PROFILES: EngagementDemoProfile[] = [
  {
    id: "web",
    label: "Web foothold",
    description: "HTTP recon, app exploitation, Linux privesc, and post-exploitation loot.",
  },
  {
    id: "ad",
    label: "Active Directory",
    description: "AD enumeration, shell access, Windows privesc, and credential graphing.",
  },
  {
    id: "pivoting",
    label: "Pivoting",
    description: "Foothold, tunnel setup, relay into an internal segment, and chained follow-up.",
  },
  {
    id: "cloud",
    label: "Cloud / IAM",
    description: "Cloud identity discovery, access abuse, and storage / secret collection.",
  },
];

type DemoScenarioDefinition = {
  sections: EngagementChecklistSection[];
  nodes: EngagementGraphNode[];
  progress: number;
};

const item = (
  id: string,
  label: string,
  status: EngagementChecklistItem["status"],
  details?: Partial<EngagementChecklistItem>
): EngagementChecklistItem => ({
  id,
  label,
  status,
  evidenceCount: details?.evidenceCount ?? 0,
  lastSeenAt: details?.lastSeenAt ?? null,
  successCount: details?.successCount ?? 0,
  failureCount: details?.failureCount ?? 0,
});

const node = (
  id: string,
  type: EngagementGraphNode["type"],
  status: EngagementGraphNode["status"],
  title: string,
  subtitle: string,
  icon: string,
  position: EngagementGraphNode["position"],
  sectionId: EngagementGraphNode["sectionId"],
  itemId: EngagementGraphNode["itemId"]
): EngagementGraphNode => ({
  id,
  type,
  status,
  title,
  subtitle,
  icon,
  position,
  sectionId,
  itemId,
});

const edge = (
  id: string,
  sourceId: string,
  targetId: string,
  kind: EngagementGraphEdge["kind"],
  branch: EngagementGraphEdge["branch"]
): EngagementGraphEdge => ({
  id,
  sourceId,
  targetId,
  kind,
  branch,
});

const buildEdges = (nodes: EngagementGraphNode[]): EngagementGraphEdge[] => {
  const edges: EngagementGraphEdge[] = [];

  for (let index = 1; index < nodes.length; index += 1) {
    const previous = nodes[index - 1];
    const current = nodes[index];
    const branch = current.status ?? "success";

    edges.push(
      edge(`${previous.id}->${current.id}`, previous.id, current.id, "sequence", branch)
    );

    if (previous.sectionId !== current.sectionId) {
      edges.push(
        edge(
          `${previous.id}->${current.id}::phase-transition`,
          previous.id,
          current.id,
          "phase-transition",
          branch
        )
      );
    }
  }

  return edges;
};

const createSections = (
  overrides: Partial<Record<string, EngagementChecklistItem[]>>
): EngagementChecklistSection[] => [
  {
    id: "recon",
    label: SECTION_META.recon.label,
    icon: SECTION_META.recon.icon,
    isOpen: true,
    items:
      overrides.recon ??
      [
        item("recon-port-scan", "Port Scan", "pending"),
        item("recon-web-discovery", "Web Content Discovery", "pending"),
        item("recon-service-fingerprint", "Service Fingerprinting", "pending"),
        item("recon-dns-enum", "DNS Enumeration", "pending"),
      ],
  },
  {
    id: "exploitation",
    label: SECTION_META.exploitation.label,
    icon: SECTION_META.exploitation.icon,
    isOpen: false,
    items:
      overrides.exploitation ??
      [
        item("exploit-sqli", "SQL Injection Exploitation", "pending"),
        item("exploit-credential-attack", "Credential Attack", "pending"),
        item("exploit-framework", "Exploit Framework Run", "pending"),
        item("exploit-web-primitives", "Web Exploitation Primitives", "pending"),
      ],
  },
  {
    id: "privesc",
    label: SECTION_META.privesc.label,
    icon: SECTION_META.privesc.icon,
    isOpen: false,
    items:
      overrides.privesc ??
      [
        item("privesc-linux-enum", "Linux PrivEsc Enumeration", "pending"),
        item("privesc-windows-enum", "Windows PrivEsc Enumeration", "pending"),
      ],
  },
  {
    id: "postexp",
    label: SECTION_META.postexp.label,
    icon: SECTION_META.postexp.icon,
    isOpen: true,
    items:
      overrides.postexp ??
      [
        item("postexp-credential-dump", "Credential Dumping", "pending"),
        item("postexp-lateral", "Lateral Movement", "pending"),
        item("postexp-loot", "Loot / Data Collection", "pending"),
      ],
  },
];

const createWebScenario = (): DemoScenarioDefinition => {
  const sections = createSections({
    recon: [
      item("recon-port-scan", "Port Scan", "done", {
        evidenceCount: 1,
        successCount: 1,
        lastSeenAt: "2026-04-13T09:00:00.000Z",
      }),
      item("recon-web-discovery", "Web Content Discovery", "done", {
        evidenceCount: 1,
        successCount: 1,
        lastSeenAt: "2026-04-13T09:04:00.000Z",
      }),
      item("recon-service-fingerprint", "Service Fingerprinting", "done", {
        evidenceCount: 1,
        successCount: 1,
        lastSeenAt: "2026-04-13T09:07:00.000Z",
      }),
      item("recon-dns-enum", "DNS Enumeration", "pending"),
    ],
    exploitation: [
      item("exploit-sqli", "SQL Injection Exploitation", "done", {
        evidenceCount: 1,
        successCount: 1,
        lastSeenAt: "2026-04-13T09:18:00.000Z",
      }),
      item("exploit-credential-attack", "Credential Attack", "pending", {
        evidenceCount: 1,
        failureCount: 1,
        lastSeenAt: "2026-04-13T09:23:00.000Z",
      }),
      item("exploit-framework", "Exploit Framework Run", "pending"),
      item("exploit-web-primitives", "Web Exploitation Primitives", "pending"),
    ],
    privesc: [
      item("privesc-linux-enum", "Linux PrivEsc Enumeration", "done", {
        evidenceCount: 2,
        successCount: 2,
        lastSeenAt: "2026-04-13T09:34:00.000Z",
      }),
      item("privesc-windows-enum", "Windows PrivEsc Enumeration", "pending"),
    ],
    postexp: [
      item("postexp-credential-dump", "Credential Dumping", "done", {
        evidenceCount: 1,
        successCount: 1,
        lastSeenAt: "2026-04-13T09:43:00.000Z",
      }),
      item("postexp-lateral", "Lateral Movement", "active", {
        evidenceCount: 1,
        successCount: 1,
        lastSeenAt: "2026-04-13T09:51:00.000Z",
      }),
      item("postexp-loot", "Loot / Data Collection", "pending"),
    ],
  });

  const nodes = [
    node(
      "demo-nmap",
      "initial",
      "success",
      "nmap -sC -sV -Pn 10.10.11.34",
      "22/80/3306 exposed",
      "radar",
      { x: "12%", y: "35%" },
      "recon",
      "recon-port-scan"
    ),
    node(
      "demo-ffuf",
      "action",
      "success",
      "ffuf -w common.txt -u http://10.10.11.34/FUZZ",
      "/backup and /admin discovered",
      "travel_explore",
      { x: "20%", y: "56%" },
      "recon",
      "recon-web-discovery"
    ),
    node(
      "demo-whatweb",
      "action",
      "success",
      "whatweb http://10.10.11.34",
      "Apache 2.4 / PHP 8.1 fingerprinted",
      "manage_search",
      { x: "28%", y: "32%" },
      "recon",
      "recon-service-fingerprint"
    ),
    node(
      "demo-sqlmap",
      "action",
      "success",
      "sqlmap -u 'http://10.10.11.34/login.php?id=1' --batch",
      "Boolean-based auth bypass landed",
      "bug_report",
      { x: "44%", y: "38%" },
      "exploitation",
      "exploit-sqli"
    ),
    node(
      "demo-hydra",
      "failure",
      "failure",
      "hydra -l admin -P rockyou ssh://10.10.11.34",
      "SSH brute-force rate-limited",
      "key",
      { x: "46%", y: "70%" },
      "exploitation",
      "exploit-credential-attack"
    ),
    node(
      "demo-linpeas",
      "action",
      "success",
      "linpeas.sh",
      "Writable backup script and sudo hints",
      "terminal",
      { x: "62%", y: "42%" },
      "privesc",
      "privesc-linux-enum"
    ),
    node(
      "demo-sudo",
      "action",
      "success",
      "sudo -l",
      "NOPASSWD on /usr/local/bin/backup.sh",
      "key",
      { x: "68%", y: "58%" },
      "privesc",
      "privesc-linux-enum"
    ),
    node(
      "demo-secretsdump",
      "action",
      "success",
      "secretsdump.py local",
      "Local hashes and service creds extracted",
      "password",
      { x: "82%", y: "40%" },
      "postexp",
      "postexp-credential-dump"
    ),
    node(
      "demo-bloodhound",
      "success",
      "success",
      "bloodhound-python -c All -u svc_pwnbox -p 'Passw0rd!'",
      "Graph path to domain escalation identified",
      "lan",
      { x: "88%", y: "62%" },
      "postexp",
      "postexp-lateral"
    ),
  ];

  return {
    sections,
    nodes,
    progress: 72,
  };
};

const createAdScenario = (): DemoScenarioDefinition => {
  const sections = createSections({
    recon: [
      item("recon-service-fingerprint", "SMB / LDAP Enumeration", "done", {
        evidenceCount: 2,
        successCount: 2,
        lastSeenAt: "2026-04-13T10:09:00.000Z",
      }),
      item("recon-dns-enum", "Domain Enumeration", "done", {
        evidenceCount: 1,
        successCount: 1,
        lastSeenAt: "2026-04-13T10:11:00.000Z",
      }),
      item("recon-port-scan", "Port Scan", "pending"),
      item("recon-web-discovery", "Web Content Discovery", "pending"),
    ],
    exploitation: [
      item("exploit-credential-attack", "Credential Attack", "done", {
        evidenceCount: 1,
        successCount: 1,
        lastSeenAt: "2026-04-13T10:18:00.000Z",
      }),
      item("exploit-framework", "Exploit Framework Run", "active", {
        evidenceCount: 1,
        successCount: 1,
        lastSeenAt: "2026-04-13T10:24:00.000Z",
      }),
      item("exploit-sqli", "SQL Injection Exploitation", "pending"),
      item("exploit-web-primitives", "Web Exploitation Primitives", "pending"),
    ],
    privesc: [
      item("privesc-windows-enum", "Windows PrivEsc Enumeration", "done", {
        evidenceCount: 1,
        successCount: 1,
        lastSeenAt: "2026-04-13T10:31:00.000Z",
      }),
      item("privesc-linux-enum", "Linux PrivEsc Enumeration", "pending"),
    ],
    postexp: [
      item("postexp-credential-dump", "Credential Dumping", "done", {
        evidenceCount: 1,
        successCount: 1,
        lastSeenAt: "2026-04-13T10:36:00.000Z",
      }),
      item("postexp-lateral", "Lateral Movement", "active", {
        evidenceCount: 2,
        successCount: 2,
        lastSeenAt: "2026-04-13T10:41:00.000Z",
      }),
      item("postexp-loot", "Loot / Data Collection", "pending"),
    ],
  });

  const nodes = [
    node(
      "demo-netexec",
      "initial",
      "success",
      "netexec smb 10.10.11.40 -u guest -p '' --shares",
      "Anonymous share map and host metadata confirmed",
      "travel_explore",
      { x: "14%", y: "36%" },
      "recon",
      "recon-service-fingerprint"
    ),
    node(
      "demo-ldapsearch",
      "action",
      "success",
      "ldapsearch -x -H ldap://10.10.11.40 -b 'DC=corp,DC=local'",
      "Directory naming contexts and key users enumerated",
      "manage_search",
      { x: "20%", y: "58%" },
      "recon",
      "recon-dns-enum"
    ),
    node(
      "demo-kerbrute",
      "action",
      "success",
      "kerbrute userenum -d corp.local users.txt",
      "Valid usernames confirmed for spray path",
      "key",
      { x: "42%", y: "40%" },
      "exploitation",
      "exploit-credential-attack"
    ),
    node(
      "demo-evilwinrm",
      "action",
      "success",
      "evil-winrm -i 10.10.11.40 -u svc_sql -p 'Passw0rd!'",
      "WinRM foothold established on application host",
      "terminal",
      { x: "48%", y: "60%" },
      "exploitation",
      "exploit-framework"
    ),
    node(
      "demo-winpeas",
      "action",
      "success",
      "winPEASx64.exe quiet",
      "Service misconfig and token privileges identified",
      "desktop_windows",
      { x: "64%", y: "43%" },
      "privesc",
      "privesc-windows-enum"
    ),
    node(
      "demo-secretsdump",
      "action",
      "success",
      "secretsdump.py corp.local/svc_sql:'Passw0rd!'@10.10.11.40",
      "NTLM material extracted for follow-on access",
      "password",
      { x: "82%", y: "40%" },
      "postexp",
      "postexp-credential-dump"
    ),
    node(
      "demo-bloodhound",
      "success",
      "success",
      "bloodhound-python -c All -u svc_sql -p 'Passw0rd!' -d corp.local -ns 10.10.11.40",
      "ACL path to delegated admin privilege mapped",
      "lan",
      { x: "88%", y: "63%" },
      "postexp",
      "postexp-lateral"
    ),
  ];

  return {
    sections,
    nodes,
    progress: 76,
  };
};

const createPivotingScenario = (): DemoScenarioDefinition => {
  const sections = createSections({
    recon: [
      item("recon-port-scan", "Port Scan", "done", {
        evidenceCount: 1,
        successCount: 1,
        lastSeenAt: "2026-04-13T11:02:00.000Z",
      }),
      item("recon-service-fingerprint", "Internal Service Fingerprinting", "done", {
        evidenceCount: 1,
        successCount: 1,
        lastSeenAt: "2026-04-13T11:06:00.000Z",
      }),
      item("recon-web-discovery", "Web Content Discovery", "pending"),
      item("recon-dns-enum", "DNS Enumeration", "pending"),
    ],
    exploitation: [
      item("exploit-framework", "Exploit Framework Run", "done", {
        evidenceCount: 1,
        successCount: 1,
        lastSeenAt: "2026-04-13T11:11:00.000Z",
      }),
      item("exploit-credential-attack", "Credential Attack", "pending"),
      item("exploit-sqli", "SQL Injection Exploitation", "pending"),
      item("exploit-web-primitives", "Web Exploitation Primitives", "pending"),
    ],
    privesc: [
      item("privesc-linux-enum", "Linux PrivEsc Enumeration", "done", {
        evidenceCount: 1,
        successCount: 1,
        lastSeenAt: "2026-04-13T11:16:00.000Z",
      }),
      item("privesc-windows-enum", "Windows PrivEsc Enumeration", "pending"),
    ],
    postexp: [
      item("postexp-lateral", "Tunnel / Pivoting", "done", {
        evidenceCount: 2,
        successCount: 2,
        lastSeenAt: "2026-04-13T11:28:00.000Z",
      }),
      item("postexp-loot", "Internal Target Enumeration", "active", {
        evidenceCount: 1,
        successCount: 1,
        lastSeenAt: "2026-04-13T11:34:00.000Z",
      }),
      item("postexp-credential-dump", "Credential Dumping", "pending"),
    ],
  });

  const nodes = [
    node(
      "demo-nmap",
      "initial",
      "success",
      "nmap -sT 10.10.11.50",
      "Foothold host and internal route identified",
      "radar",
      { x: "14%", y: "38%" },
      "recon",
      "recon-port-scan"
    ),
    node(
      "demo-ssrf",
      "action",
      "success",
      "curl -X POST http://10.10.11.50/api/export -d 'url=http://127.0.0.1:8080'",
      "SSRF path reached internal admin API",
      "web_traffic",
      { x: "44%", y: "42%" },
      "exploitation",
      "exploit-web-primitives"
    ),
    node(
      "demo-linpeas",
      "action",
      "success",
      "linpeas.sh",
      "SOCKS-capable foothold and config secrets found",
      "terminal",
      { x: "63%", y: "48%" },
      "privesc",
      "privesc-linux-enum"
    ),
    node(
      "demo-chisel",
      "action",
      "success",
      "chisel client 10.10.11.50:8001 R:socks",
      "Reverse SOCKS tunnel established through foothold",
      "lan",
      { x: "80%", y: "38%" },
      "postexp",
      "postexp-lateral"
    ),
    node(
      "demo-proxychains",
      "success",
      "success",
      "proxychains nmap -sT 172.16.10.20",
      "Internal host enumerated through the pivot path",
      "travel_explore",
      { x: "87%", y: "60%" },
      "postexp",
      "postexp-loot"
    ),
  ];

  return {
    sections,
    nodes,
    progress: 69,
  };
};

const createCloudScenario = (): DemoScenarioDefinition => {
  const sections = createSections({
    recon: [
      item("recon-service-fingerprint", "Cloud Identity Discovery", "done", {
        evidenceCount: 1,
        successCount: 1,
        lastSeenAt: "2026-04-13T12:05:00.000Z",
      }),
      item("recon-dns-enum", "Public Asset Enumeration", "done", {
        evidenceCount: 1,
        successCount: 1,
        lastSeenAt: "2026-04-13T12:09:00.000Z",
      }),
      item("recon-port-scan", "Port Scan", "pending"),
      item("recon-web-discovery", "Web Content Discovery", "pending"),
    ],
    exploitation: [
      item("exploit-framework", "IAM Abuse Chain", "done", {
        evidenceCount: 1,
        successCount: 1,
        lastSeenAt: "2026-04-13T12:14:00.000Z",
      }),
      item("exploit-credential-attack", "Credential Attack", "pending"),
      item("exploit-sqli", "SQL Injection Exploitation", "pending"),
      item("exploit-web-primitives", "Web Exploitation Primitives", "pending"),
    ],
    privesc: [
      item("privesc-linux-enum", "Privilege Chain Enumeration", "done", {
        evidenceCount: 1,
        successCount: 1,
        lastSeenAt: "2026-04-13T12:21:00.000Z",
      }),
      item("privesc-windows-enum", "Windows PrivEsc Enumeration", "pending"),
    ],
    postexp: [
      item("postexp-loot", "Bucket / Secret Collection", "active", {
        evidenceCount: 2,
        successCount: 2,
        lastSeenAt: "2026-04-13T12:30:00.000Z",
      }),
      item("postexp-lateral", "Cross-account Movement", "done", {
        evidenceCount: 1,
        successCount: 1,
        lastSeenAt: "2026-04-13T12:26:00.000Z",
      }),
      item("postexp-credential-dump", "Credential Material Collection", "pending"),
    ],
  });

  const nodes = [
    node(
      "demo-aws-sts",
      "initial",
      "success",
      "aws sts get-caller-identity",
      "Compromised role and account scope confirmed",
      "cloud",
      { x: "14%", y: "38%" },
      "recon",
      "recon-service-fingerprint"
    ),
    node(
      "demo-aws-enum",
      "action",
      "success",
      "aws ec2 describe-instances --region us-east-1",
      "Public assets and reachable workload inventory mapped",
      "travel_explore",
      { x: "22%", y: "60%" },
      "recon",
      "recon-dns-enum"
    ),
    node(
      "demo-iam-simulate",
      "action",
      "success",
      "aws iam simulate-principal-policy --policy-source-arn ...",
      "PassRole path into privileged automation discovered",
      "bug_report",
      { x: "45%", y: "42%" },
      "exploitation",
      "exploit-framework"
    ),
    node(
      "demo-assume-role",
      "action",
      "success",
      "aws sts assume-role --role-arn arn:aws:iam::123456789012:role/AdminOps",
      "Higher-privilege session material issued",
      "key",
      { x: "62%", y: "46%" },
      "privesc",
      "privesc-linux-enum"
    ),
    node(
      "demo-aws-s3",
      "success",
      "success",
      "aws s3 ls s3://corp-loot",
      "Sensitive storage contents exposed to the new role",
      "inventory_2",
      { x: "86%", y: "44%" },
      "postexp",
      "postexp-loot"
    ),
    node(
      "demo-secretsmanager",
      "action",
      "success",
      "aws secretsmanager list-secrets",
      "Cross-service secret inventory available for follow-on abuse",
      "password",
      { x: "89%", y: "64%" },
      "postexp",
      "postexp-lateral"
    ),
  ];

  return {
    sections,
    nodes,
    progress: 71,
  };
};

const SCENARIO_BUILDERS: Record<EngagementDemoProfileId, () => DemoScenarioDefinition> = {
  web: createWebScenario,
  ad: createAdScenario,
  pivoting: createPivotingScenario,
  cloud: createCloudScenario,
};

export function getDefaultEngagementDemoProfile(
  projectType?: ProjectType
): EngagementDemoProfileId {
  if (projectType === "real") return "ad";
  return "web";
}

export function getVisualMapDemoLabel(projectType?: ProjectType): string {
  switch (projectType) {
    case "thm":
      return "Load TryHackMe-style demo";
    case "real":
      return "Load red-team style demo";
    case "ctf":
      return "Load CTF demo";
    case "htb":
    case "custom":
    default:
      return "Load realistic CTF demo";
  }
}

export function buildVisualMapDemoState(
  projectType?: ProjectType,
  profileId: EngagementDemoProfileId = getDefaultEngagementDemoProfile(projectType)
): ProjectEngagementStateUpdate {
  const scenario = (SCENARIO_BUILDERS[profileId] ?? SCENARIO_BUILDERS.web)();

  return {
    version: "v1",
    sections: scenario.sections,
    graph: {
      nodes: scenario.nodes,
      edges: buildEdges(scenario.nodes),
    },
    progress: Math.max(
      scenario.progress,
      progressByType[projectType ?? "custom"] ?? progressByType.custom
    ),
  };
}
