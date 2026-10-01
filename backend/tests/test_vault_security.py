from pathlib import Path

import pytest

from app.core.exceptions import AppException
from app.core.security import validate_vault_path


def test_valid_path_within_vault(tmp_path):
    subdir = tmp_path / "notes"
    subdir.mkdir()
    f = subdir / "test.md"
    f.write_text("hello")

    result = validate_vault_path(str(f), str(tmp_path))
    assert result == f.resolve()


def test_vault_root_itself(tmp_path):
    result = validate_vault_path(str(tmp_path), str(tmp_path))
    assert result == tmp_path.resolve()


def test_reject_dot_dot_traversal(tmp_path):
    malicious = str(tmp_path / ".." / "etc" / "passwd")
    with pytest.raises(AppException) as exc_info:
        validate_vault_path(malicious, str(tmp_path))
    assert "KB_VAULT_PATH_FORBIDDEN" in exc_info.value.code


def test_reject_url_encoded(tmp_path):
    malicious = str(tmp_path / "%2e%2e" / "etc")
    with pytest.raises(AppException) as exc_info:
        validate_vault_path(malicious, str(tmp_path))
    assert "KB_VAULT_PATH_FORBIDDEN" in exc_info.value.code


def test_reject_percent_in_path(tmp_path):
    malicious = str(tmp_path / "file%20name.md")
    with pytest.raises(AppException) as exc_info:
        validate_vault_path(malicious, str(tmp_path))
    assert "KB_VAULT_PATH_FORBIDDEN" in exc_info.value.code


def test_reject_symlink_to_outside(tmp_path):
    target = Path("/tmp/outside_vault")
    target.mkdir(exist_ok=True)

    symlink = tmp_path / "sneaky_link"
    symlink.symlink_to(target)

    with pytest.raises(AppException) as exc_info:
        validate_vault_path(str(symlink), str(tmp_path))
    assert "KB_VAULT_PATH_FORBIDDEN" in exc_info.value.code


def test_reject_path_outside_vault(tmp_path):
    outside = str(Path("/tmp/totally_elsewhere"))
    with pytest.raises(AppException) as exc_info:
        validate_vault_path(outside, str(tmp_path))
    assert "KB_VAULT_PATH_FORBIDDEN" in exc_info.value.code


def test_reject_absolute_traversal(tmp_path):
    with pytest.raises(AppException) as exc_info:
        validate_vault_path("/etc/shadow", str(tmp_path))
    assert "KB_VAULT_PATH_FORBIDDEN" in exc_info.value.code
