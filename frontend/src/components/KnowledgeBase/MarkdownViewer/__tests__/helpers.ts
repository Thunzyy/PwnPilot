/**
 * Shared test helpers for MarkdownViewer tests.
 *
 * Factory functions that produce fully-typed KBDocDetail objects
 * for rendering tests without requiring backend interaction.
 */
import type { KBDocDetail, KBSource } from "@/types/kb";

const defaultSource: KBSource = {
  id: "test-source",
  name: "Test",
  source_type: "local",
  origin: null,
  path: "/test",
  remote_url: null,
  read_only: false,
  include_paths: null,
  user_id: "user-1",
  project_id: "proj-1",
  sync_status: null,
  opsec_warning: null,
  last_synced_at: null,
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-01-01T00:00:00Z",
};

/**
 * Create a KBDocDetail for rendering tests.
 *
 * @param body - Markdown body content
 * @param frontmatter - Optional YAML frontmatter as a plain object
 * @returns Fully-typed KBDocDetail with sensible defaults
 */
export function makeDoc(
  body: string,
  frontmatter?: Record<string, unknown>,
): KBDocDetail {
  return {
    id: "test-doc",
    source_id: "test-source",
    title: "Test Doc",
    relative_path: "test.md",
    tags: null,
    content_hash: null,
    wikilinks: null,
    frontmatter: frontmatter ?? null,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    body,
    backlinks: [],
    source: defaultSource,
  };
}
