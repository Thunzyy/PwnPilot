"""Versioned ruleset for mapping command history to engagement objectives."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class EngagementObjectiveRule:
    id: str
    section_id: str
    label: str
    icon: str
    patterns: tuple[str, ...]


RULESET_VERSION = "v1"

ENGAGEMENT_OBJECTIVE_RULES: tuple[EngagementObjectiveRule, ...] = (
    EngagementObjectiveRule(
        id="recon-port-scan",
        section_id="recon",
        label="Port Scan",
        icon="radar",
        patterns=("nmap", "masscan", "rustscan"),
    ),
    EngagementObjectiveRule(
        id="recon-web-discovery",
        section_id="recon",
        label="Web Content Discovery",
        icon="travel_explore",
        patterns=(
            "gobuster",
            "ffuf",
            "dirsearch",
            "feroxbuster",
            "curl -s http",
            "/data/",
            "/download/",
            "download/",
            ".pcap",
        ),
    ),
    EngagementObjectiveRule(
        id="recon-service-fingerprint",
        section_id="recon",
        label="Service Fingerprinting",
        icon="manage_search",
        patterns=(
            "whatweb",
            "nikto",
            "httpx",
            "wpscan",
            "enum4linux",
            "enum4linux-ng",
            "smbclient",
            "ldapsearch",
            "rpcclient",
            "netexec smb",
            "crackmapexec smb",
        ),
    ),
    EngagementObjectiveRule(
        id="recon-dns-enum",
        section_id="recon",
        label="DNS Enumeration",
        icon="dns",
        patterns=("amass", "subfinder", "dnsenum", "dnsrecon", "whois"),
    ),
    EngagementObjectiveRule(
        id="exploit-sqli",
        section_id="exploitation",
        label="SQL Injection Exploitation",
        icon="bug_report",
        patterns=("sqlmap", "sqli", "union select"),
    ),
    EngagementObjectiveRule(
        id="exploit-credential-attack",
        section_id="exploitation",
        label="Credential Attack",
        icon="key",
        patterns=("hydra", "medusa", "patator", "kerbrute", "password spray", "spray"),
    ),
    EngagementObjectiveRule(
        id="exploit-credential-discovery",
        section_id="exploitation",
        label="Credential Discovery",
        icon="manage_search",
        patterns=(
            "tshark",
            "ftp.request.command",
            "ftp.request.arg",
            "export cappass",
            "credential:",
        ),
    ),
    EngagementObjectiveRule(
        id="exploit-remote-login",
        section_id="exploitation",
        label="Remote Login / Foothold",
        icon="login",
        patterns=(
            "spawn ssh",
            "ssh session:",
            " ssh ",
            "ssh -o",
            "evil-winrm",
            "wmiexec",
            "smbexec",
        ),
    ),
    EngagementObjectiveRule(
        id="exploit-framework",
        section_id="exploitation",
        label="Exploit Framework Run",
        icon="rocket_launch",
        patterns=("msfconsole", "metasploit", "evil-winrm", "wmiexec", "smbexec"),
    ),
    EngagementObjectiveRule(
        id="exploit-web-primitives",
        section_id="exploitation",
        label="Web Exploitation Primitives",
        icon="web_traffic",
        patterns=("xss", "ssti", "ssrf", "lfi", "rfi", "deserialization"),
    ),
    EngagementObjectiveRule(
        id="privesc-linux-enum",
        section_id="privesc",
        label="Linux PrivEsc Enumeration",
        icon="terminal",
        patterns=(
            "linpeas",
            "sudo -l",
            "getcap",
            "capsh",
            "suid",
            "os.setuid(0)",
            "cap_setuid",
            "/usr/bin/python3.8",
            "python3.8 -c",
        ),
    ),
    EngagementObjectiveRule(
        id="privesc-windows-enum",
        section_id="privesc",
        label="Windows PrivEsc Enumeration",
        icon="desktop_windows",
        patterns=(
            "winpeas",
            "seatbelt",
            "sharpup",
            "privesccheck",
            "watson",
            "seimpersonate",
            "juicypotato",
            "printspoofer",
        ),
    ),
    EngagementObjectiveRule(
        id="postexp-credential-dump",
        section_id="postexp",
        label="Credential Dumping",
        icon="password",
        patterns=("mimikatz", "secretsdump", "hashdump", "lsass"),
    ),
    EngagementObjectiveRule(
        id="postexp-lateral",
        section_id="postexp",
        label="Lateral Movement",
        icon="lan",
        patterns=(
            "bloodhound",
            "psexec",
            "wmiexec",
            "impacket",
            "netexec",
            "crackmapexec",
            "chisel",
            "ligolo",
            "proxychains",
        ),
    ),
    EngagementObjectiveRule(
        id="postexp-loot",
        section_id="postexp",
        label="Loot / Data Collection",
        icon="inventory_2",
        patterns=(
            "loot",
            "download",
            "upload",
            "user.txt",
            "root.txt",
            "cat /home/",
            "cat /root/",
            "scp",
            "rsync",
            "aws s3",
            "s3 ls",
            "az storage",
            "gcloud storage",
            "secretsmanager",
        ),
    ),
)

FALLBACK_RULES: dict[str, EngagementObjectiveRule] = {
    "recon": EngagementObjectiveRule(
        id="recon-manual",
        section_id="recon",
        label="Manual Recon Activity",
        icon="radar",
        patterns=(),
    ),
    "exploitation": EngagementObjectiveRule(
        id="exploit-manual",
        section_id="exploitation",
        label="Manual Exploitation Activity",
        icon="bug_report",
        patterns=(),
    ),
    "privesc": EngagementObjectiveRule(
        id="privesc-manual",
        section_id="privesc",
        label="Manual PrivEsc Activity",
        icon="key",
        patterns=(),
    ),
    "postexp": EngagementObjectiveRule(
        id="postexp-manual",
        section_id="postexp",
        label="Manual Post-Exploitation Activity",
        icon="inventory_2",
        patterns=(),
    ),
}

_ORDERED_SECTION_IDS = ("recon", "exploitation", "privesc", "postexp")
RULES_BY_SECTION: dict[str, tuple[EngagementObjectiveRule, ...]] = {
    section_id: tuple(
        rule for rule in ENGAGEMENT_OBJECTIVE_RULES if rule.section_id == section_id
    )
    for section_id in _ORDERED_SECTION_IDS
}


def match_rule(command: str) -> EngagementObjectiveRule | None:
    lowered = command.lower()
    best_rule: EngagementObjectiveRule | None = None
    best_score = 0
    for rule in ENGAGEMENT_OBJECTIVE_RULES:
        score = sum(1 for pattern in rule.patterns if pattern in lowered)
        if score > best_score:
            best_rule = rule
            best_score = score
    return best_rule


def infer_section_id(command: str) -> str:
    lowered = command.lower()
    section_scores = {section_id: 0 for section_id in _ORDERED_SECTION_IDS}
    for rule in ENGAGEMENT_OBJECTIVE_RULES:
        score = sum(1 for pattern in rule.patterns if pattern in lowered)
        if score:
            section_scores[rule.section_id] += score
    best_section = max(section_scores.items(), key=lambda item: item[1])
    return best_section[0] if best_section[1] > 0 else "recon"


def fallback_rule_for_section(section_id: str) -> EngagementObjectiveRule:
    return FALLBACK_RULES.get(section_id, FALLBACK_RULES["recon"])
