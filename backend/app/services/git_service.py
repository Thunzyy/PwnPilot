"""Async git CLI wrapper using asyncio subprocess.

Provides GitService for clone, pull, conflict detection, and merge abort.
All git operations are executed via asyncio.create_subprocess_exec with
timeout protection and structured output.

Usage:
    from app.services.git_service import GitService

    git = GitService(timeout=300.0)
    await git.check_available()
    stdout, stderr, rc = await git.clone(url, dest, depth=1)
    stdout, stderr, rc = await git.pull(repo_path)
    if git.has_conflicts(stdout):
        await git.abort_merge(repo_path)
"""

import asyncio

from app.core.errors import ErrorCode
from app.core.exceptions import AppException
from app.services.base import BaseService


class GitService(BaseService):
    """Async wrapper for git CLI operations.

    All methods use asyncio.create_subprocess_exec to run git commands
    without blocking the event loop. Timeout protection kills stalled
    processes via asyncio.wait_for.
    """

    def __init__(self, timeout: float = 300.0):
        """Initialize GitService.

        Args:
            timeout: Default timeout in seconds for git operations.
        """
        super().__init__("service.git")
        self.timeout = timeout

    async def _run(
        self,
        *args: str,
        cwd: str | None = None,
        timeout: float | None = None,
    ) -> tuple[str, str, int]:
        """Execute a git command and return (stdout, stderr, returncode).

        Args:
            *args: Git subcommand and arguments (e.g., "clone", "--depth", "1").
            cwd: Working directory for the command.
            timeout: Override default timeout (seconds).

        Returns:
            Tuple of (stdout, stderr, returncode).

        Raises:
            asyncio.TimeoutError: If the command exceeds the timeout.
                The process is killed before re-raising.
            FileNotFoundError: If git binary is not found on PATH.
        """
        effective_timeout = timeout if timeout is not None else self.timeout

        self.log.debug(
            "Running git command",
            args=args,
            cwd=cwd,
            timeout=effective_timeout,
        )

        proc = await asyncio.create_subprocess_exec(
            "git",
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=cwd,
        )

        try:
            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                proc.communicate(), timeout=effective_timeout
            )
        except TimeoutError:
            proc.kill()
            await proc.wait()
            self.log.error(
                "Git command timed out",
                args=args,
                cwd=cwd,
                timeout=effective_timeout,
            )
            raise

        stdout = stdout_bytes.decode("utf-8", errors="replace")
        stderr = stderr_bytes.decode("utf-8", errors="replace")

        self.log.debug(
            "Git command completed",
            args=args,
            returncode=proc.returncode,
            stdout_len=len(stdout),
            stderr_len=len(stderr),
        )

        return stdout, stderr, proc.returncode

    async def clone(
        self,
        url: str,
        dest: str,
        depth: int | None = 1,
    ) -> tuple[str, str, int]:
        """Clone a git repository.

        Args:
            url: Repository URL (https://, git://, file://, ssh://).
            dest: Destination directory path.
            depth: Shallow clone depth. None for full clone.

        Returns:
            Tuple of (stdout, stderr, returncode).
        """
        args: list[str] = ["clone"]
        if depth is not None:
            args += ["--depth", str(depth), "--single-branch"]
        args += [url, dest]
        return await self._run(*args)

    async def pull(self, repo_path: str) -> tuple[str, str, int]:
        """Pull latest changes from the remote.

        Args:
            repo_path: Path to the local git repository.

        Returns:
            Tuple of (stdout, stderr, returncode).
        """
        return await self._run("pull", cwd=repo_path)

    def has_conflicts(self, stdout: str) -> bool:
        """Check if git output indicates merge conflicts.

        This is a synchronous string check -- not a coroutine.

        Args:
            stdout: Output from a git pull or merge command.

        Returns:
            True if conflicts were detected.
        """
        return "CONFLICT" in stdout or "Automatic merge failed" in stdout

    async def abort_merge(self, repo_path: str) -> tuple[str, str, int]:
        """Abort an in-progress merge.

        Args:
            repo_path: Path to the local git repository.

        Returns:
            Tuple of (stdout, stderr, returncode).
        """
        return await self._run("merge", "--abort", cwd=repo_path)

    async def check_available(self) -> None:
        """Verify git is installed and accessible.

        Raises:
            AppException: With SYS_DEPENDENCY_MISSING if git is not found
                or returns a non-zero exit code.
        """
        try:
            _stdout, _stderr, returncode = await self._run("--version")
        except FileNotFoundError:
            raise AppException(
                ErrorCode.SYS_DEPENDENCY_MISSING,
                "git is not installed or not in PATH",
            )

        if returncode != 0:
            raise AppException(
                ErrorCode.SYS_DEPENDENCY_MISSING,
                "git is not installed or not in PATH",
            )
