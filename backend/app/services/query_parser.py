"""Query parser for extracting filter prefixes from search queries.

Extracts structured filters (path:, file:, tag:, line:, section:,
[property:value]) from a raw search query string, returning a ParsedQuery
with the remaining free text and all extracted filters.

Used by kb_service.search_docs to separate filter prefixes from the
FTS5 MATCH portion of the query.
"""

import re
from dataclasses import dataclass, field


@dataclass
class ParsedQuery:
    """Result of parsing a search query with filter prefixes."""

    free_text: str = ""
    path_filters: list[str] = field(default_factory=list)
    file_filters: list[str] = field(default_factory=list)
    tag_filters: list[str] = field(default_factory=list)
    line_filters: list[str] = field(default_factory=list)
    section_filters: list[str] = field(default_factory=list)
    frontmatter_filters: list[tuple[str, str]] = field(default_factory=list)

    @property
    def has_filters(self) -> bool:
        """True if any filter list is non-empty."""
        return bool(
            self.path_filters
            or self.file_filters
            or self.tag_filters
            or self.line_filters
            or self.section_filters
            or self.frontmatter_filters
        )

    @property
    def has_free_text(self) -> bool:
        """True if free_text is non-empty after stripping whitespace."""
        return bool(self.free_text.strip())


# Regex: known prefix followed by quoted or unquoted value.
# Uses (?:^|\s) to avoid matching colons inside words (e.g. http://...).
# re.IGNORECASE makes prefix names case-insensitive (TAG:, Path:, etc.).
_PREFIX_RE = re.compile(
    r"(?:^|\s)(path|file|tag|line|section):"
    r'(?:"([^"]+)"|(\S+))',
    re.IGNORECASE,
)

# Regex: [property:value] or [property:"quoted value"] with brackets.
_FRONTMATTER_RE = re.compile(
    r'\[(\w+):(?:"([^"]+)"|([^\]\s]+))\]'
)


def parse_search_query(raw: str) -> ParsedQuery:
    """Parse a raw search query string, extracting filter prefixes.

    Supported prefixes:
      path:value     - filter by relative_path contains value
      file:value     - filter by filename matches value
      tag:value      - filter by tag
      line:value     - post-filter: keyword on same line
      section:value  - post-filter: keyword under same heading
      [prop:value]   - filter by frontmatter property

    Remaining text becomes free_text for FTS5 MATCH.

    Args:
        raw: The raw search query string from the user.

    Returns:
        ParsedQuery with extracted filters and remaining free text.
    """
    result = ParsedQuery()
    remaining = raw

    # 1. Extract [property:value] patterns first (brackets are distinctive)
    for match in _FRONTMATTER_RE.finditer(remaining):
        prop = match.group(1)
        value = match.group(2) or match.group(3)
        result.frontmatter_filters.append((prop, value))
    remaining = _FRONTMATTER_RE.sub("", remaining)

    # 2. Extract prefix:value patterns
    for match in _PREFIX_RE.finditer(remaining):
        prefix = match.group(1).lower()
        value = match.group(2) or match.group(3)
        getattr(result, f"{prefix}_filters").append(value)
    remaining = _PREFIX_RE.sub("", remaining)

    # 3. Normalize remaining whitespace into free_text
    result.free_text = " ".join(remaining.split())
    return result
