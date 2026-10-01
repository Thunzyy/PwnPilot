from app.utils.gitignore import generate_pentest_gitignore


def test_sensitive_directories_present():
    content = generate_pentest_gitignore()
    for directory in ["client-data/", "credentials/", "creds/", "loot/", "exfil/", "dumps/", "scans/"]:
        assert directory in content, f"Missing sensitive directory rule: {directory}"


def test_env_rules_present():
    content = generate_pentest_gitignore()
    assert ".env" in content
    assert ".env.*" in content


def test_credential_file_rules_present():
    content = generate_pentest_gitignore()
    for pattern in ["*.kdbx", "*.key", "*.pem", "*.pfx"]:
        assert pattern in content, f"Missing credential file rule: {pattern}"


def test_overall_structure():
    content = generate_pentest_gitignore()
    assert isinstance(content, str)
    assert len(content) > 0
    assert "PwnPilot" in content
