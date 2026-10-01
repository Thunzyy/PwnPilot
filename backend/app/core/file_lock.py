from pathlib import Path

from filelock import AsyncFileLock


def vault_file_lock(vault_path: str | Path, timeout: float = 30.0) -> AsyncFileLock:
    """Return an AsyncFileLock for the vault's .git/.gsd.lock file.

    Falls back to vault_path/.gsd.lock if no .git/ directory exists.

    Args:
        vault_path: Path to the vault root directory
        timeout: Lock acquisition timeout in seconds

    Returns:
        AsyncFileLock instance (not yet acquired)
    """
    vault = Path(vault_path)
    git_dir = vault / ".git"

    if git_dir.is_dir():
        lock_path = git_dir / ".gsd.lock"
    else:
        lock_path = vault / ".gsd.lock"

    return AsyncFileLock(str(lock_path), timeout=timeout)
