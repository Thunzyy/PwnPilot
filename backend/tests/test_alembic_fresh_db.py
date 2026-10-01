from pathlib import Path
import sqlite3
import subprocess
import sys


def test_alembic_upgrade_head_succeeds_on_fresh_sqlite_db(tmp_path):
    backend_root = Path(__file__).resolve().parent.parent
    database_path = (tmp_path / "fresh-alembic.db").resolve()

    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=backend_root,
        capture_output=True,
        text=True,
        env={
            **__import__("os").environ,
            "DATABASE_URL": f"sqlite+aiosqlite:///{database_path.as_posix()}",
        },
    )

    assert result.returncode == 0, result.stderr

    with sqlite3.connect(database_path) as conn:
        tables = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
        app_settings_columns = {
            row[1]
            for row in conn.execute("PRAGMA table_info('app_settings')").fetchall()
        }
        report_task_columns = {
            row[1]
            for row in conn.execute(
                "PRAGMA table_info('report_evaluation_tasks')"
            ).fetchall()
        }
        report_columns = {
            row[1]
            for row in conn.execute("PRAGMA table_info('reports')").fetchall()
        }
        ai_context_routing_columns = {
            row[1]
            for row in conn.execute(
                "PRAGMA table_info('ai_context_routings')"
            ).fetchall()
        }

    assert {
        "reports",
        "report_sections",
        "report_update_proposals",
        "report_update_section_patches",
        "report_evidence_links",
        "report_evaluation_tasks",
    }.issubset(tables)
    assert {
        "lease_expires_at",
        "heartbeat_at",
        "lease_version",
        "target_section_keys",
    }.issubset(report_task_columns)
    assert "profile" in report_columns
    if "ai_context_routings" in tables:
        assert "model" in ai_context_routing_columns
    assert {
        "report_evaluation_lease_seconds",
        "report_evaluation_heartbeat_interval_seconds",
        "report_evaluation_reclaim_poll_interval_seconds",
        "report_evaluation_max_runtime_seconds",
    }.issubset(app_settings_columns)


def test_alembic_upgrade_head_repairs_legacy_app_settings_schema(tmp_path):
    backend_root = Path(__file__).resolve().parent.parent
    database_path = (tmp_path / "legacy-settings.db").resolve()

    with sqlite3.connect(database_path) as conn:
        conn.execute("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)")
        conn.execute(
            "INSERT INTO alembic_version (version_num) VALUES (?)",
            ("a7f4d2c1b9e3",),
        )
        conn.execute(
            """
            CREATE TABLE app_settings (
                id INTEGER NOT NULL PRIMARY KEY,
                workspace_base_path VARCHAR,
                vpn_path VARCHAR,
                vpn_content VARCHAR,
                updated_at DATETIME,
                vpn_platform_defaults JSON
            )
            """
        )
        conn.commit()

    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=backend_root,
        capture_output=True,
        text=True,
        env={
            **__import__("os").environ,
            "DATABASE_URL": f"sqlite+aiosqlite:///{database_path.as_posix()}",
        },
    )

    assert result.returncode == 0, result.stderr

    with sqlite3.connect(database_path) as conn:
        columns = {
            row[1]
            for row in conn.execute("PRAGMA table_info('app_settings')").fetchall()
        }
        tables = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
        ai_context_routing_columns = {
            row[1]
            for row in conn.execute("PRAGMA table_info('ai_context_routings')").fetchall()
        }
        version = conn.execute("SELECT version_num FROM alembic_version").fetchone()[0]

    assert "vault_path" in columns
    assert {
        "report_evaluation_lease_seconds",
        "report_evaluation_heartbeat_interval_seconds",
        "report_evaluation_reclaim_poll_interval_seconds",
        "report_evaluation_max_runtime_seconds",
    }.issubset(columns)
    if "ai_context_routings" in tables:
        assert "model" in ai_context_routing_columns
    assert version == "a8b7c6d5e4f2"
