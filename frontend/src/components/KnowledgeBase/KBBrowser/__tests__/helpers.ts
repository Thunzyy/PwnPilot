/**
 * Shared test helpers for KBBrowser component tests.
 *
 * Factory functions producing typed KBTreeNode, KBTreeDocItem, KBBacklink,
 * KBSearchResult, and KBSource objects for rendering/interaction tests
 * without backend dependency.
 */
import type {
  KBTreeNode,
  KBTreeDocItem,
  KBBacklink,
  KBSearchResult,
  KBSource,
} from "@/types/kb";

/** Create a KBTreeDocItem with sensible defaults. */
export function makeTreeDocItem(
  overrides?: Partial<KBTreeDocItem>,
): KBTreeDocItem {
  return {
    id: overrides?.id ?? "doc-1",
    title: overrides?.title ?? "Test Doc",
    relative_path: overrides?.relative_path ?? "test.md",
    ...overrides,
  };
}

/** Create a KBTreeNode with sensible defaults. */
export function makeTreeNode(
  overrides?: Partial<KBTreeNode>,
): KBTreeNode {
  return {
    name: overrides?.name ?? "root",
    type: overrides?.type ?? "folder",
    children: overrides?.children ?? [],
    docs: overrides?.docs ?? [],
    ...overrides,
  };
}

/** Create a KBBacklink with sensible defaults. */
export function makeBacklink(
  overrides?: Partial<KBBacklink>,
): KBBacklink {
  return {
    id: overrides?.id ?? "bl-1",
    title: overrides?.title ?? "Linking Doc",
    relative_path: overrides?.relative_path ?? "linking.md",
    ...overrides,
  };
}

/**
 * Build a realistic sample tree:
 * ```
 * / (root)
 * ├── recon/
 * │   ├── nmap.md
 * │   └── masscan.md
 * ├── tools/
 * │   ├── nmap.md       (duplicate name)
 * │   └── burp.md
 * └── notes.md          (root-level)
 * ```
 */
/** Create a KBSearchResult with sensible defaults. */
export function makeSearchResult(
  overrides?: Partial<KBSearchResult>,
): KBSearchResult {
  return {
    id: overrides?.id ?? "sr-1",
    title: overrides?.title ?? "Test Search Result",
    relative_path: overrides?.relative_path ?? "test/result.md",
    source_id: overrides?.source_id ?? "source-1",
    tags: overrides?.tags ?? "test",
    snippet: overrides?.snippet ?? "This is a <mark>test</mark> snippet",
    rank: overrides?.rank ?? 1.0,
    ...overrides,
  };
}

/** Create a KBSource with sensible defaults. */
export function makeSource(overrides?: Partial<KBSource>): KBSource {
  return {
    id: overrides?.id ?? "source-1",
    name: overrides?.name ?? "Test Source",
    source_type: overrides?.source_type ?? "local",
    origin: overrides?.origin ?? null,
    path: overrides?.path ?? "/test/vault",
    remote_url: overrides?.remote_url ?? null,
    read_only: overrides?.read_only ?? false,
    include_paths: overrides?.include_paths ?? null,
    user_id: overrides?.user_id ?? "user-1",
    project_id: overrides?.project_id ?? "project-1",
    sync_status: overrides?.sync_status ?? "completed",
    opsec_warning: overrides?.opsec_warning ?? null,
    last_synced_at: overrides?.last_synced_at ?? null,
    created_at: overrides?.created_at ?? "2026-01-01T00:00:00Z",
    updated_at: overrides?.updated_at ?? "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/**
 * Build a realistic sample tree:
 * ```
 * / (root)
 * +-- recon/
 * |   +-- nmap.md
 * |   +-- masscan.md
 * +-- tools/
 * |   +-- nmap.md       (duplicate name)
 * |   +-- burp.md
 * +-- notes.md          (root-level)
 * ```
 */
export function makeSampleTree(): KBTreeNode {
  return makeTreeNode({
    name: "",
    children: [
      makeTreeNode({
        name: "recon",
        docs: [
          makeTreeDocItem({
            id: "recon-nmap",
            title: "nmap",
            relative_path: "recon/nmap.md",
            tags: "recon scanning",
          }),
          makeTreeDocItem({
            id: "recon-masscan",
            title: "masscan",
            relative_path: "recon/masscan.md",
            tags: "recon scanning privesc lateral",
          }),
        ],
      }),
      makeTreeNode({
        name: "tools",
        docs: [
          makeTreeDocItem({
            id: "tools-nmap",
            title: "nmap",
            relative_path: "tools/nmap.md",
          }),
          makeTreeDocItem({
            id: "tools-burp",
            title: "burp",
            relative_path: "tools/burp.md",
          }),
        ],
      }),
    ],
    docs: [
      makeTreeDocItem({
        id: "root-notes",
        title: "notes",
        relative_path: "notes.md",
      }),
    ],
  });
}
