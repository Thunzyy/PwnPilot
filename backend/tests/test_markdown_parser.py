import datetime
from pathlib import Path

from app.services.markdown_parser import MarkdownParser


def _write_md(tmp_path: Path, filename: str, content: str) -> Path:
    """Helper to write a markdown file in tmp_path."""
    f = tmp_path / filename
    f.write_text(content, encoding="utf-8")
    return f


def test_parse_full_frontmatter(tmp_path):
    content = """\
---
title: Recon Report
tags:
  - nmap
  - recon
date: 2026-01-30
author: tester
---
# Recon

Scanned the target with [[Nmap]] and found [[SSH|OpenSSH 8.9]].
"""
    f = _write_md(tmp_path, "recon.md", content)
    parser = MarkdownParser()
    result = parser.parse(f, tmp_path)

    assert result["title"] == "Recon Report"
    assert result["tags"] == ["nmap", "recon"]
    assert result["date"] == datetime.date(2026, 1, 30)
    assert result["body"].startswith("# Recon")
    assert len(result["wikilinks"]) == 2
    assert result["wikilinks"][0]["target"] == "Nmap"
    assert result["wikilinks"][0]["display"] is None
    assert result["wikilinks"][1]["target"] == "SSH"
    assert result["wikilinks"][1]["display"] == "OpenSSH 8.9"
    assert result["relative_path"] == "recon.md"
    assert result["content_hash"] is not None
    assert result["frontmatter"]["author"] == "tester"


def test_parse_no_frontmatter(tmp_path):
    content = "# Just some notes\n\nNo frontmatter here.\n"
    f = _write_md(tmp_path, "plain_notes.md", content)
    parser = MarkdownParser()
    result = parser.parse(f, tmp_path)

    assert result["title"] == "plain_notes"
    assert result["tags"] == []
    assert result["frontmatter"] == {}
    assert result["date"] is None
    assert "Just some notes" in result["body"]


def test_parse_tags_as_string(tmp_path):
    content = """\
---
tags: nmap, recon, web
---
Body text.
"""
    f = _write_md(tmp_path, "string_tags.md", content)
    parser = MarkdownParser()
    result = parser.parse(f, tmp_path)

    assert result["tags"] == ["nmap", "recon", "web"]


def test_parse_empty_file(tmp_path):
    f = _write_md(tmp_path, "empty.md", "")
    parser = MarkdownParser()
    result = parser.parse(f, tmp_path)

    assert result["title"] == "empty"
    assert result["tags"] == []
    assert result["body"] == ""
    assert result["wikilinks"] == []
    assert result["frontmatter"] == {}
    assert result["content_hash"] is not None


def test_parse_wikilinks_various(tmp_path):
    content = """\
---
title: Links Test
---
Normal: [[Target]]
Display: [[SSH|OpenSSH]]
Spaced: [[ Spaced Target ]]
Multiple on one line: [[A]] and [[B]]
No wikilinks on this line.
"""
    f = _write_md(tmp_path, "links.md", content)
    parser = MarkdownParser()
    result = parser.parse(f, tmp_path)

    wikilinks = result["wikilinks"]
    assert len(wikilinks) == 5

    assert wikilinks[0]["target"] == "Target"
    assert wikilinks[0]["display"] is None

    assert wikilinks[1]["target"] == "SSH"
    assert wikilinks[1]["display"] == "OpenSSH"

    assert wikilinks[2]["target"] == "Spaced Target"
    assert wikilinks[2]["display"] is None

    assert wikilinks[3]["target"] == "A"
    assert wikilinks[4]["target"] == "B"


def test_parse_content_hash_consistency(tmp_path):
    content = "# Test\nSome content.\n"
    f = _write_md(tmp_path, "hash_test.md", content)
    parser = MarkdownParser()

    result1 = parser.parse(f, tmp_path)
    result2 = parser.parse(f, tmp_path)
    assert result1["content_hash"] == result2["content_hash"]

    f.write_text("# Modified\nDifferent content.\n", encoding="utf-8")
    result3 = parser.parse(f, tmp_path)
    assert result1["content_hash"] != result3["content_hash"]


def test_parse_relative_path(tmp_path):
    subdir = tmp_path / "notes" / "recon"
    subdir.mkdir(parents=True)

    f = subdir / "scan.md"
    f.write_text("# Scan notes\n", encoding="utf-8")

    parser = MarkdownParser()
    result = parser.parse(f, tmp_path)

    assert result["relative_path"] == Path("notes/recon/scan.md").as_posix()
