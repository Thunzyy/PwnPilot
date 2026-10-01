"""Custom exceptions for PwnPilot.

Usage:
    from app.core.errors import ErrorCode
    from app.core.exceptions import AppException

    raise AppException(
        ErrorCode.PROJECT_NOT_FOUND,
        f"Project '{project_id}' does not exist",
        {"project_id": project_id}
    )

The exception handler in main.py will catch AppException and return
a standardized JSON error response.
"""

from fastapi import Request
from fastapi.responses import JSONResponse


class AppException(Exception):
    """Application exception with error code and structured details.

    Attributes:
        code: Error code from ErrorCode class (e.g., "1001:PROJECT_NOT_FOUND")
        message: Human-readable error message
        details: Additional context for debugging
    """

    def __init__(self, code: str, message: str, details: dict | None = None):
        self.code = code
        self.message = message
        self.details = details or {}
        super().__init__(message)

    def __repr__(self) -> str:
        return f"AppException({self.code}, {self.message!r}, {self.details!r})"


# HTTP status code mapping based on error code prefix
_STATUS_CODE_MAP: dict[str, int] = {
    # 1xxx - Project errors
    "1001": 404,  # PROJECT_NOT_FOUND
    "1002": 409,  # PROJECT_SLUG_EXISTS
    "1003": 409,  # PROJECT_WORKSPACE_EXISTS
    "1004": 400,  # PROJECT_INVALID_TYPE
    "1005": 400,  # PROJECT_INVALID_STATUS
    "1006": 403,  # PROJECT_PATH_FORBIDDEN
    "1007": 500,  # PROJECT_DELETE_FAILED
    # 2xxx - Terminal errors
    "2001": 404,  # TERMINAL_SESSION_NOT_FOUND
    "2002": 503,  # TERMINAL_TTYD_UNAVAILABLE
    "2003": 500,  # TERMINAL_TMUX_ERROR
    "2004": 503,  # TERMINAL_PORT_EXHAUSTED
    "2005": 500,  # TERMINAL_CREATE_FAILED
    "2006": 500,  # TERMINAL_RESIZE_FAILED
    # 3xxx - AI errors (extended)
    "3001": 503,  # AI_PROVIDER_UNREACHABLE
    "3002": 503,  # AI_DNS_FAILED
    "3003": 503,  # AI_TLS_ERROR
    "3004": 504,  # AI_TIMEOUT
    "3010": 401,  # AI_AUTH_INVALID
    "3011": 401,  # AI_AUTH_EXPIRED
    "3020": 404,  # AI_MODEL_NOT_FOUND
    "3021": 429,  # AI_RATE_LIMITED
    "3022": 400,  # AI_CONTEXT_TOO_LONG
    "3023": 502,  # AI_PROVIDER_ERROR
    "3030": 500,  # AI_CONTEXT_BUILD_FAILED
    "3031": 500,  # AI_STREAM_INTERRUPTED
    "3040": 400,  # AI_CREDENTIALS_OPT_IN_REQUIRED
    "3050": 404,  # AI_PROVIDER_NOT_FOUND
    "3051": 400,  # AI_PROVIDER_DISABLED
    # 4xxx - Knowledge Base errors
    "4001": 404,  # KB_SOURCE_NOT_FOUND
    "4002": 500,  # KB_SYNC_FAILED
    "4003": 500,  # KB_INDEX_FAILED
    "4004": 500,  # KB_SEARCH_FAILED
    "4005": 403,  # KB_VAULT_PATH_FORBIDDEN
    "4006": 404,  # KB_DOC_NOT_FOUND
    "4007": 404,  # KB_ATTACHMENT_NOT_FOUND
    "4008": 409,  # KB_INDEX_IN_PROGRESS
    "4009": 409,  # KB_LINK_EXISTS
    "4010": 404,  # KB_LINK_NOT_FOUND
    "4011": 422,  # KB_INVALID_MITRE_ID
    "4012": 409,  # KB_MITRE_TAG_EXISTS
    "4013": 403,  # KB_DOC_READ_ONLY
    "4014": 409,  # KB_DOC_DUPLICATE_PATH
    "4015": 409,  # KB_DOC_RENAME_COLLISION
    # 5xxx - Timeline errors
    "5001": 404,  # TIMELINE_ENTRY_NOT_FOUND
    "5002": 400,  # TIMELINE_INVALID_TYPE
    # 6xxx - Commands errors
    "6001": 404,  # COMMAND_NOT_FOUND
    "6002": 400,  # COMMAND_INVALID_CATEGORY
    # 7xxx - Credentials/Flags errors
    "7001": 404,  # CREDENTIAL_NOT_FOUND
    "7002": 404,  # FLAG_NOT_FOUND
    # 8xxx - Auth errors
    "8001": 409,  # AUTH_USERNAME_TAKEN
    "8002": 409,  # AUTH_EMAIL_TAKEN
    "8003": 401,  # AUTH_INVALID_CREDENTIALS
    "8004": 401,  # AUTH_INVALID_TOKEN
    "8005": 401,  # AUTH_REFRESH_REVOKED
    "8006": 403,  # AUTH_FORBIDDEN
    # 9xxx - System errors (all 500)
    "9001": 500,  # SYS_DATABASE_ERROR
    "9002": 500,  # SYS_FILESYSTEM_ERROR
    "9003": 500,  # SYS_DEPENDENCY_MISSING
    "9004": 500,  # SYS_CONFIGURATION_ERROR
    "9999": 500,  # SYS_INTERNAL_ERROR
    # 10xxx - Agent errors
    "10001": 404,  # AGENT_NOT_FOUND
    "10002": 409,  # AGENT_ALREADY_RUNNING
    "10003": 500,  # AGENT_LAUNCH_FAILED
    "10004": 500,  # AGENT_STOP_FAILED
    "10005": 424,  # AGENT_BINARY_NOT_FOUND
    "10006": 400,  # AGENT_INVALID_TYPE
    "10010": 404,  # AGENT_CONFIG_NOT_FOUND
    "10011": 409,  # AGENT_CONFIG_DUPLICATE
    "10012": 400,  # AGENT_CONFIG_INVALID
}


def _get_status_code(error_code: str) -> int:
    """Get HTTP status code for an error code."""
    code_number = error_code.split(":")[0]
    return _STATUS_CODE_MAP.get(code_number, 400)


async def app_exception_handler(request: Request, exc: AppException) -> JSONResponse:
    """FastAPI exception handler for AppException.

    Returns a standardized JSON error response:
    {
        "error": {
            "code": "1001:PROJECT_NOT_FOUND",
            "message": "Project 'abc' does not exist",
            "details": {"project_id": "abc"}
        }
    }
    """
    # Import here to avoid circular imports
    from app.core.logging import get_logger

    log = get_logger("api")
    log.error(
        f"{exc.code} - {exc.message}",
        path=str(request.url.path),
        method=request.method,
        **exc.details,
    )

    status_code = _get_status_code(exc.code)

    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "code": exc.code,
                "message": exc.message,
                "details": exc.details,
            }
        },
    )
