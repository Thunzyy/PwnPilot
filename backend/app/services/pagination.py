"""Cursor-based pagination utilities for KB endpoints.

Cursor format: base64-encoded 'ISO-timestamp|uuid' composite key.
This ensures stable pagination even with concurrent inserts.
"""

import base64
from datetime import datetime


def encode_cursor(dt: datetime, doc_id: str) -> str:
    """Encode a pagination cursor from timestamp + document ID."""
    raw = f"{dt.isoformat()}|{doc_id}"
    return base64.urlsafe_b64encode(raw.encode()).decode()


def decode_cursor(cursor: str) -> tuple[datetime, str]:
    """Decode a pagination cursor into (timestamp, document_id).

    Raises ValueError if cursor format is invalid.
    """
    try:
        decoded = base64.urlsafe_b64decode(cursor).decode()
        ts_str, doc_id = decoded.rsplit("|", 1)
        return datetime.fromisoformat(ts_str), doc_id
    except Exception as e:
        raise ValueError(f"Invalid cursor format: {e}") from e
