"""Tests for AI context builder."""
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.credential import Credential, Flag
from app.models.project import Project
from app.models.timeline import Timeline
from app.services.context_builder import ContextBuilder


@pytest.fixture
def mock_db():
    return AsyncMock(spec=AsyncSession)


@pytest.fixture
def sample_project():
    p = MagicMock(spec=Project)
    p.name = "HTB - Devvortex"
    p.type = "htb"
    p.status = "in_progress"
    p.variables = {"target": "10.10.11.242", "attacker": "10.10.14.5"}
    return p


@pytest.fixture
def sample_timeline():
    e1 = MagicMock(spec=Timeline)
    e1.type = "command"
    e1.content = "nmap -sCV 10.10.11.242"
    e1.output = "22/tcp ssh\n80/tcp http"
    e1.entry_data = {}
    e1.created_at = datetime(2026, 1, 27, 10, 15)

    e2 = MagicMock(spec=Timeline)
    e2.type = "finding"
    e2.content = "Joomla 4.2.6 detected"
    e2.output = None
    e2.entry_data = {"severity": "high"}
    e2.created_at = datetime(2026, 1, 27, 10, 20)

    return [e1, e2]


@pytest.fixture
def sample_credentials():
    c = MagicMock(spec=Credential)
    c.username = "admin"
    c.password = "SuperS3cret"
    c.hash = None
    c.service = "joomla"
    c.notes = None
    return [c]


@pytest.fixture
def sample_flags():
    f = MagicMock(spec=Flag)
    f.type = "user"
    f.value = "abc123flag"
    return [f]


@pytest.fixture
def builder(mock_db):
    return ContextBuilder(mock_db)


class TestFormatProject:
    def test_format_project_info(self, builder, sample_project):
        result = builder._format_project(sample_project)

        assert "HTB - Devvortex" in result
        assert "htb" in result
        assert "in_progress" in result

    def test_format_project_variables(self, builder, sample_project):
        result = builder._format_variables(sample_project.variables)

        assert "$target = 10.10.11.242" in result
        assert "$attacker = 10.10.14.5" in result

    def test_format_empty_variables(self, builder):
        result = builder._format_variables({})
        assert result == ""

    def test_format_structured_context_variables(self, builder):
        result = builder._format_variables(
            {
                "engagement_kind": "platform_lab",
                "platform_name": "TryHackMe",
                "platform_content_type": "room",
                "platform_target_name": "Advent of Cyber 3",
                "target_ip": "10.10.144.12",
                "ai_briefing": "Prioritise short, reproducible attack paths.",
                "attacker_ip": "10.9.0.5",
            }
        )

        assert "## Engagement Context" in result
        assert "- Engagement Type: platform_lab" in result
        assert "- Platform: TryHackMe" in result
        assert "- Content Type: room" in result
        assert "- Target Name: Advent of Cyber 3" in result
        assert "- Target IP: 10.10.144.12" in result
        assert "## AI Briefing" in result
        assert "Prioritise short, reproducible attack paths." in result
        assert "$attacker_ip = 10.9.0.5" in result


class TestFormatTimeline:
    def test_format_timeline_entries(self, builder, sample_timeline):
        result = builder._format_timeline(sample_timeline)

        assert "COMMAND" in result
        assert "nmap -sCV" in result
        assert "FINDING" in result
        assert "Joomla 4.2.6" in result

    def test_format_timeline_with_output(self, builder, sample_timeline):
        result = builder._format_timeline(sample_timeline)
        assert "22/tcp ssh" in result

    def test_format_empty_timeline(self, builder):
        result = builder._format_timeline([])
        assert result == ""


class TestFormatCredentials:
    def test_format_credentials(self, builder, sample_credentials):
        result = builder._format_credentials(sample_credentials)

        assert "admin" in result
        assert "SuperS3cret" in result
        assert "joomla" in result

    def test_format_empty_credentials(self, builder):
        result = builder._format_credentials([])
        assert result == ""


class TestFormatFlags:
    def test_format_flags(self, builder, sample_flags):
        result = builder._format_flags(sample_flags)

        assert "user" in result
        assert "abc123flag" in result


class TestPresets:
    def test_minimal_preset_config(self, builder):
        cfg = builder._get_preset_config("minimal")
        assert cfg["include_project"] is True
        assert cfg["include_variables"] is True
        assert cfg["include_timeline"] is False
        assert cfg["include_credentials"] is False

    def test_standard_preset_config(self, builder):
        cfg = builder._get_preset_config("standard")
        assert cfg["include_timeline"] is True
        assert cfg["include_credentials"] is False
        assert cfg["timeline_limit"] == 20

    def test_full_preset_config(self, builder):
        cfg = builder._get_preset_config("full")
        assert cfg["include_timeline"] is True
        assert cfg["include_credentials"] is True
        assert cfg["timeline_limit"] == 100


class TestBuildContext:
    @pytest.mark.anyio
    async def test_build_minimal_context(self, builder, mock_db, sample_project):
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = sample_project
        mock_db.execute.return_value = mock_result

        result = await builder.build(
            project_id="proj-1",
            preset="minimal",
        )

        assert "HTB - Devvortex" in result
        assert "$target" in result

    @pytest.mark.anyio
    async def test_build_returns_empty_for_missing_project(self, builder, mock_db):
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute.return_value = mock_result

        result = await builder.build(project_id="missing", preset="minimal")
        assert result == ""

    @pytest.mark.anyio
    async def test_build_includes_structured_context_sections(
        self, builder, mock_db, sample_project
    ):
        sample_project.variables = {
            "engagement_kind": "ctf",
            "platform_name": "Hack The Box",
            "platform_target_name": "Analytics",
            "objective": "Reach user flag and document escalation path.",
            "ai_briefing": "Keep hypotheses explicit and avoid unnecessary brute force.",
            "custom_hint": "Check exposed services first.",
        }
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = sample_project
        mock_db.execute.return_value = mock_result

        result = await builder.build(project_id="proj-1", preset="minimal")

        assert "## Engagement Context" in result
        assert "- Engagement Type: ctf" in result
        assert "- Platform: Hack The Box" in result
        assert "- Target Name: Analytics" in result
        assert "- Objective: Reach user flag and document escalation path." in result
        assert "## AI Briefing" in result
        assert "Keep hypotheses explicit and avoid unnecessary brute force." in result
        assert "$custom_hint = Check exposed services first." in result
