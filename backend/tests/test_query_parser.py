"""Tests for query parser: parse_search_query and ParsedQuery.

Tests the extraction of filter prefixes (path:, file:, tag:, line:,
section:, [property:value]) from raw search query strings.
"""

import pytest

from app.services.query_parser import ParsedQuery, parse_search_query


class TestParsedQueryDataclass:
    """Tests for the ParsedQuery dataclass and its properties."""

    def test_default_values(self):
        q = ParsedQuery()
        assert q.free_text == ""
        assert q.path_filters == []
        assert q.file_filters == []
        assert q.tag_filters == []
        assert q.line_filters == []
        assert q.section_filters == []
        assert q.frontmatter_filters == []

    def test_has_filters_false_when_empty(self):
        q = ParsedQuery()
        assert q.has_filters is False

    def test_has_filters_true_with_tag(self):
        q = ParsedQuery(tag_filters=["nmap"])
        assert q.has_filters is True

    def test_has_filters_true_with_frontmatter(self):
        q = ParsedQuery(frontmatter_filters=[("status", "draft")])
        assert q.has_filters is True

    def test_has_free_text_false_when_empty(self):
        q = ParsedQuery()
        assert q.has_free_text is False

    def test_has_free_text_false_when_whitespace(self):
        q = ParsedQuery(free_text="   ")
        assert q.has_free_text is False

    def test_has_free_text_true_when_present(self):
        q = ParsedQuery(free_text="nmap scan")
        assert q.has_free_text is True


class TestPlainTextQueries:
    """Tests for queries with no filter prefixes."""

    def test_simple_free_text(self):
        result = parse_search_query("nmap scan")
        assert result.free_text == "nmap scan"
        assert result.has_filters is False
        assert result.has_free_text is True

    def test_empty_string(self):
        result = parse_search_query("")
        assert result.free_text == ""
        assert result.has_filters is False
        assert result.has_free_text is False

    def test_whitespace_only(self):
        result = parse_search_query("   ")
        assert result.free_text == ""
        assert result.has_filters is False
        assert result.has_free_text is False

    def test_single_word(self):
        result = parse_search_query("nmap")
        assert result.free_text == "nmap"
        assert result.has_filters is False


class TestTagFilter:
    """Tests for tag: prefix extraction."""

    def test_tag_only(self):
        result = parse_search_query("tag:nmap")
        assert result.tag_filters == ["nmap"]
        assert result.free_text == ""

    def test_tag_with_free_text(self):
        result = parse_search_query("tag:nmap port scan")
        assert result.tag_filters == ["nmap"]
        assert result.free_text == "port scan"

    def test_tag_case_insensitive_prefix(self):
        result = parse_search_query("TAG:nmap")
        assert result.tag_filters == ["nmap"]

    def test_tag_mixed_case_prefix(self):
        result = parse_search_query("Tag:enumeration")
        assert result.tag_filters == ["enumeration"]


class TestPathFilter:
    """Tests for path: prefix extraction."""

    def test_path_with_free_text(self):
        result = parse_search_query("path:recon nmap")
        assert result.path_filters == ["recon"]
        assert result.free_text == "nmap"

    def test_path_quoted_value(self):
        result = parse_search_query('path:"recon/tools" nmap')
        assert result.path_filters == ["recon/tools"]
        assert result.free_text == "nmap"

    def test_path_only(self):
        result = parse_search_query("path:recon")
        assert result.path_filters == ["recon"]
        assert result.free_text == ""


class TestFileFilter:
    """Tests for file: prefix extraction."""

    def test_file_only(self):
        result = parse_search_query("file:readme")
        assert result.file_filters == ["readme"]
        assert result.free_text == ""

    def test_file_with_free_text(self):
        result = parse_search_query("file:readme nmap")
        assert result.file_filters == ["readme"]
        assert result.free_text == "nmap"


class TestLineFilter:
    """Tests for line: prefix extraction."""

    def test_line_with_free_text(self):
        result = parse_search_query("line:ssh connection")
        assert result.line_filters == ["ssh"]
        assert result.free_text == "connection"

    def test_line_only(self):
        result = parse_search_query("line:ssh")
        assert result.line_filters == ["ssh"]
        assert result.free_text == ""


class TestSectionFilter:
    """Tests for section: prefix extraction."""

    def test_section_with_free_text(self):
        result = parse_search_query("section:enumeration nmap")
        assert result.section_filters == ["enumeration"]
        assert result.free_text == "nmap"

    def test_section_only(self):
        result = parse_search_query("section:enumeration")
        assert result.section_filters == ["enumeration"]
        assert result.free_text == ""


class TestFrontmatterFilter:
    """Tests for [property:value] bracket syntax."""

    def test_single_frontmatter(self):
        result = parse_search_query("[status:draft] nmap")
        assert result.frontmatter_filters == [("status", "draft")]
        assert result.free_text == "nmap"

    def test_multiple_frontmatter(self):
        result = parse_search_query("[status:draft] [priority:high]")
        assert result.frontmatter_filters == [
            ("status", "draft"),
            ("priority", "high"),
        ]
        assert result.free_text == ""

    def test_frontmatter_only(self):
        result = parse_search_query("[status:draft]")
        assert result.frontmatter_filters == [("status", "draft")]
        assert result.free_text == ""

    def test_frontmatter_quoted_value(self):
        result = parse_search_query('[status:"in progress"]')
        assert result.frontmatter_filters == [("status", "in progress")]
        assert result.free_text == ""


class TestMixedFilters:
    """Tests for queries combining multiple filter types."""

    def test_tag_and_path(self):
        result = parse_search_query("tag:nmap path:recon port scan")
        assert result.tag_filters == ["nmap"]
        assert result.path_filters == ["recon"]
        assert result.free_text == "port scan"

    def test_three_filters_and_free_text(self):
        result = parse_search_query(
            "path:recon file:readme tag:nmap port scan"
        )
        assert result.path_filters == ["recon"]
        assert result.file_filters == ["readme"]
        assert result.tag_filters == ["nmap"]
        assert result.free_text == "port scan"

    def test_frontmatter_and_prefix_filter(self):
        result = parse_search_query("[status:draft] tag:nmap recon")
        assert result.frontmatter_filters == [("status", "draft")]
        assert result.tag_filters == ["nmap"]
        assert result.free_text == "recon"

    def test_all_filter_types(self):
        result = parse_search_query(
            "path:recon file:readme tag:nmap line:ssh "
            "section:enumeration [status:draft] scan"
        )
        assert result.path_filters == ["recon"]
        assert result.file_filters == ["readme"]
        assert result.tag_filters == ["nmap"]
        assert result.line_filters == ["ssh"]
        assert result.section_filters == ["enumeration"]
        assert result.frontmatter_filters == [("status", "draft")]
        assert result.free_text == "scan"

    def test_has_filters_true_has_free_text_false(self):
        result = parse_search_query("tag:nmap")
        assert result.has_filters is True
        assert result.has_free_text is False

    def test_has_filters_false_has_free_text_true(self):
        result = parse_search_query("port scan")
        assert result.has_filters is False
        assert result.has_free_text is True


class TestEdgeCases:
    """Tests for edge cases and tricky inputs."""

    def test_colon_in_regular_word_not_treated_as_filter(self):
        """Words with colons that are NOT filter prefixes stay as free text."""
        result = parse_search_query("http://example.com")
        assert result.has_filters is False
        assert "http" in result.free_text

    def test_unknown_prefix_stays_as_free_text(self):
        """Unknown prefix like 'foo:bar' stays in free text."""
        result = parse_search_query("foo:bar nmap")
        assert result.has_filters is False
        assert "foo:bar" in result.free_text

    def test_whitespace_normalization(self):
        """Multiple spaces are normalized to single space."""
        result = parse_search_query("nmap   scan   results")
        assert result.free_text == "nmap scan results"

    def test_filter_at_end_of_query(self):
        """Filter prefix at the end of the query string."""
        result = parse_search_query("port scan tag:nmap")
        assert result.tag_filters == ["nmap"]
        assert result.free_text == "port scan"

    def test_duplicate_filter_type(self):
        """Multiple filters of the same type accumulate in the list."""
        result = parse_search_query("tag:nmap tag:recon scan")
        assert result.tag_filters == ["nmap", "recon"]
        assert result.free_text == "scan"
