"""Centralized error codes for PwnPilot.

Error code format: NNNN:DOMAIN_ERROR_NAME

Code ranges:
    1xxx - Project errors
    2xxx - Terminal errors
    3xxx - AI/LLM errors
    4xxx - Knowledge Base errors
    5xxx - Timeline errors
    6xxx - Commands errors
    7xxx - Credentials/Flags errors
    8xxx - Auth errors
    9xxx - System errors
    10xxx - Agent errors

Usage:
    from app.core.errors import ErrorCode
    from app.core.exceptions import AppException

    raise AppException(
        ErrorCode.PROJECT_NOT_FOUND,
        f"Project '{project_id}' does not exist",
        {"project_id": project_id}
    )
"""


class ErrorCode:
    """Centralized error codes: NNNN:DOMAIN_ERROR_NAME"""

    # =========================================================================
    # 1xxx - Project errors
    # =========================================================================
    PROJECT_NOT_FOUND = "1001:PROJECT_NOT_FOUND"
    PROJECT_SLUG_EXISTS = "1002:PROJECT_SLUG_EXISTS"
    PROJECT_WORKSPACE_EXISTS = "1003:PROJECT_WORKSPACE_EXISTS"
    PROJECT_INVALID_TYPE = "1004:PROJECT_INVALID_TYPE"
    PROJECT_INVALID_STATUS = "1005:PROJECT_INVALID_STATUS"
    PROJECT_PATH_FORBIDDEN = "1006:PROJECT_PATH_FORBIDDEN"
    PROJECT_DELETE_FAILED = "1007:PROJECT_DELETE_FAILED"

    # =========================================================================
    # 2xxx - Terminal errors
    # =========================================================================
    TERMINAL_SESSION_NOT_FOUND = "2001:TERMINAL_SESSION_NOT_FOUND"
    TERMINAL_TTYD_UNAVAILABLE = "2002:TERMINAL_TTYD_UNAVAILABLE"
    TERMINAL_TMUX_ERROR = "2003:TERMINAL_TMUX_ERROR"
    TERMINAL_PORT_EXHAUSTED = "2004:TERMINAL_PORT_EXHAUSTED"
    TERMINAL_CREATE_FAILED = "2005:TERMINAL_CREATE_FAILED"
    TERMINAL_RESIZE_FAILED = "2006:TERMINAL_RESIZE_FAILED"

    # =========================================================================
    # 3xxx - AI/LLM errors
    # =========================================================================
    AI_PROVIDER_UNREACHABLE = "3001:AI_PROVIDER_UNREACHABLE"
    AI_DNS_FAILED = "3002:AI_DNS_FAILED"
    AI_TLS_ERROR = "3003:AI_TLS_ERROR"
    AI_TIMEOUT = "3004:AI_TIMEOUT"
    AI_AUTH_INVALID = "3010:AI_AUTH_INVALID"
    AI_AUTH_EXPIRED = "3011:AI_AUTH_EXPIRED"
    AI_MODEL_NOT_FOUND = "3020:AI_MODEL_NOT_FOUND"
    AI_RATE_LIMITED = "3021:AI_RATE_LIMITED"
    AI_CONTEXT_TOO_LONG = "3022:AI_CONTEXT_TOO_LONG"
    AI_PROVIDER_ERROR = "3023:AI_PROVIDER_ERROR"
    AI_CONTEXT_BUILD_FAILED = "3030:AI_CONTEXT_BUILD_FAILED"
    AI_STREAM_INTERRUPTED = "3031:AI_STREAM_INTERRUPTED"
    AI_CREDENTIALS_OPT_IN_REQUIRED = "3040:AI_CREDENTIALS_OPT_IN_REQUIRED"
    AI_PROVIDER_NOT_FOUND = "3050:AI_PROVIDER_NOT_FOUND"
    AI_PROVIDER_DISABLED = "3051:AI_PROVIDER_DISABLED"
    AI_CONVERSATION_NOT_FOUND = "3060:AI_CONVERSATION_NOT_FOUND"
    AI_ATTACHMENT_NOT_FOUND = "3070:AI_ATTACHMENT_NOT_FOUND"
    AI_ATTACHMENT_TOO_LARGE = "3071:AI_ATTACHMENT_TOO_LARGE"
    AI_ATTACHMENT_LIMIT_EXCEEDED = "3072:AI_ATTACHMENT_LIMIT_EXCEEDED"

    # =========================================================================
    # 4xxx - Knowledge Base errors
    # =========================================================================
    KB_SOURCE_NOT_FOUND = "4001:KB_SOURCE_NOT_FOUND"
    KB_SYNC_FAILED = "4002:KB_SYNC_FAILED"
    KB_INDEX_FAILED = "4003:KB_INDEX_FAILED"
    KB_SEARCH_FAILED = "4004:KB_SEARCH_FAILED"
    KB_VAULT_PATH_FORBIDDEN = "4005:KB_VAULT_PATH_FORBIDDEN"
    KB_DOC_NOT_FOUND = "4006:KB_DOC_NOT_FOUND"
    KB_ATTACHMENT_NOT_FOUND = "4007:KB_ATTACHMENT_NOT_FOUND"
    KB_INDEX_IN_PROGRESS = "4008:KB_INDEX_IN_PROGRESS"
    KB_LINK_EXISTS = "4009:KB_LINK_EXISTS"
    KB_LINK_NOT_FOUND = "4010:KB_LINK_NOT_FOUND"
    KB_INVALID_MITRE_ID = "4011:KB_INVALID_MITRE_ID"
    KB_MITRE_TAG_EXISTS = "4012:KB_MITRE_TAG_EXISTS"
    KB_DOC_READ_ONLY = "4013:KB_DOC_READ_ONLY"
    KB_DOC_DUPLICATE_PATH = "4014:KB_DOC_DUPLICATE_PATH"
    KB_DOC_RENAME_COLLISION = "4015:KB_DOC_RENAME_COLLISION"
    KB_TAG_INVALID = "4016:KB_TAG_INVALID"

    # =========================================================================
    # 5xxx - Timeline errors
    # =========================================================================
    TIMELINE_ENTRY_NOT_FOUND = "5001:TIMELINE_ENTRY_NOT_FOUND"
    TIMELINE_INVALID_TYPE = "5002:TIMELINE_INVALID_TYPE"

    # =========================================================================
    # 6xxx - Commands errors
    # =========================================================================
    COMMAND_NOT_FOUND = "6001:COMMAND_NOT_FOUND"
    COMMAND_INVALID_CATEGORY = "6002:COMMAND_INVALID_CATEGORY"

    # =========================================================================
    # 7xxx - Credentials/Flags errors
    # =========================================================================
    CREDENTIAL_NOT_FOUND = "7001:CREDENTIAL_NOT_FOUND"
    FLAG_NOT_FOUND = "7002:FLAG_NOT_FOUND"

    # =========================================================================
    # 8xxx - Auth errors
    # =========================================================================
    AUTH_USERNAME_TAKEN = "8001:AUTH_USERNAME_TAKEN"
    AUTH_EMAIL_TAKEN = "8002:AUTH_EMAIL_TAKEN"
    AUTH_INVALID_CREDENTIALS = "8003:AUTH_INVALID_CREDENTIALS"
    AUTH_INVALID_TOKEN = "8004:AUTH_INVALID_TOKEN"
    AUTH_REFRESH_REVOKED = "8005:AUTH_REFRESH_REVOKED"
    AUTH_FORBIDDEN = "8006:AUTH_FORBIDDEN"

    # =========================================================================
    # 9xxx - System errors
    # =========================================================================
    SYS_DATABASE_ERROR = "9001:SYS_DATABASE_ERROR"
    SYS_FILESYSTEM_ERROR = "9002:SYS_FILESYSTEM_ERROR"
    SYS_DEPENDENCY_MISSING = "9003:SYS_DEPENDENCY_MISSING"
    SYS_CONFIGURATION_ERROR = "9004:SYS_CONFIGURATION_ERROR"
    SYS_INTERNAL_ERROR = "9999:SYS_INTERNAL_ERROR"

    # =========================================================================
    # 10xxx - Agent errors
    # =========================================================================
    AGENT_NOT_FOUND = "10001:AGENT_NOT_FOUND"
    AGENT_ALREADY_RUNNING = "10002:AGENT_ALREADY_RUNNING"
    AGENT_LAUNCH_FAILED = "10003:AGENT_LAUNCH_FAILED"
    AGENT_STOP_FAILED = "10004:AGENT_STOP_FAILED"
    AGENT_BINARY_NOT_FOUND = "10005:AGENT_BINARY_NOT_FOUND"
    AGENT_INVALID_TYPE = "10006:AGENT_INVALID_TYPE"
    AGENT_CONFIG_NOT_FOUND = "10010:AGENT_CONFIG_NOT_FOUND"
    AGENT_CONFIG_DUPLICATE = "10011:AGENT_CONFIG_DUPLICATE"
    AGENT_CONFIG_INVALID = "10012:AGENT_CONFIG_INVALID"
