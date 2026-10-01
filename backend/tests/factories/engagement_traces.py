"""Deterministic command-history scenarios for engagement-state tests."""

from __future__ import annotations

CommandTrace = tuple[str, int]


def scenario_recon() -> list[CommandTrace]:
    return [
        ("nmap -sV 10.10.10.10", 0),
        ("gobuster dir -u http://10.10.10.10 -w /tmp/list.txt", 0),
    ]


def scenario_exploitation_success() -> list[CommandTrace]:
    return [
        ("sqlmap -u http://10.10.10.10/login --batch", 0),
        ("hydra -l admin -P /tmp/wordlist ssh://10.10.10.10", 0),
    ]


def scenario_exploitation_failure() -> list[CommandTrace]:
    return [
        ("hydra -l admin -P /tmp/wordlist ssh://10.10.10.10", 1),
        ("sqlmap -u http://10.10.10.10/login --batch", 1),
    ]


def scenario_full_path() -> list[CommandTrace]:
    return [
        *scenario_recon(),
        *scenario_exploitation_success(),
        ("linpeas.sh", 0),
        ("sudo -l", 0),
        ("secretsdump.py local", 0),
        ("bloodhound-python -c All", 0),
    ]


def scenario_phase_transition_with_failure() -> list[CommandTrace]:
    return [
        ("nmap -sV 10.10.10.10", 0),
        ("hydra -l admin -P /tmp/wordlist ssh://10.10.10.10", 1),
        ("sqlmap -u http://10.10.10.10/login --batch", 0),
        ("linpeas.sh", 0),
    ]


def scenario_pwnbox_realistic() -> list[CommandTrace]:
    """Realistic HTB-style sequence coming from a pwnbox workflow."""

    return [
        ("nmap -sC -sV -Pn 10.10.11.34", 0),
        (
            "ffuf -w /usr/share/seclists/Discovery/Web-Content/common.txt "
            "-u http://10.10.11.34/FUZZ -mc 200,204,301,302",
            0,
        ),
        ("whatweb http://10.10.11.34", 0),
        ("sqlmap -u 'http://10.10.11.34/login.php?id=1' --batch --risk=3 --level=5", 0),
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


def scenario_enriched_mixed_ops() -> list[CommandTrace]:
    """Mixed web/AD/pivot/cloud-like activity to validate broader derivation."""

    return [
        ("enum4linux-ng -A 10.10.10.20", 0),
        ("msfconsole -q -x 'use exploit/multi/handler; run'", 0),
        ("winPEASx64.exe", 0),
        ("chisel client 10.10.10.20:8001 R:socks", 0),
        ("aws s3 ls s3://corp-loot", 0),
    ]
