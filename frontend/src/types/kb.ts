// KB TypeScript types -- mirrors backend/app/schemas/knowledge.py exactly.

// =============================================================================
// Source types
// =============================================================================

export type SourceType = 'local' | 'community';
export type SyncStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface KBSource {
  id: string;
  name: string;
  source_type: SourceType;
  origin: string | null;
  path: string | null;
  remote_url: string | null;
  read_only: boolean;
  include_paths: string[] | null;
  user_id: string;
  project_id: string;
  sync_status: string | null;
  opsec_warning: string | null;
  opsec_acknowledged: boolean;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface KBSourceCreate {
  name: string;
  source_type?: SourceType;
  origin?: string | null;
  path?: string | null;
  remote_url?: string | null;
  read_only?: boolean;
  include_paths?: string[] | null;
  project_id: string;
}

export interface KBSourceUpdate {
  name?: string;
  path?: string | null;
  remote_url?: string | null;
  read_only?: boolean;
  include_paths?: string[] | null;
  opsec_acknowledged?: boolean;
}

// =============================================================================
// Document types
// =============================================================================

export interface KBDoc {
  id: string;
  source_id: string;
  title: string;
  relative_path: string;
  tags: string | null;
  content_hash: string | null;
  wikilinks: Array<Record<string, unknown>> | null;
  frontmatter: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface KBBacklink {
  id: string;
  title: string;
  relative_path: string;
  context_line: string | null;
}

export interface KBDocDetail extends KBDoc {
  body: string | null;
  backlinks: KBBacklink[];
  source: KBSource | null;
}

export interface KBDocUpdate {
  body: string; // Full raw markdown content (frontmatter + body)
}

export interface KBDocCreate {
  source_id: string;
  folder: string;    // Subdirectory path (optional, "" for root)
  filename: string;  // Bare filename (e.g., "my-note.md")
}

export interface KBDocRenameResponse extends KBDocDetail {
  refs_updated: number;
}

export interface KBBookmark {
  id: string;
  doc_id: string;
  title: string;
  relative_path: string;
  source_id: string;
  created_at: string;
}

// =============================================================================
// Search types
// =============================================================================

export type SearchSortBy = 'relevance' | 'filename' | 'modified' | 'created';
export type SearchSortDir = 'asc' | 'desc';

export interface KBSearchResult {
  id: string;
  title: string;
  relative_path: string;
  source_id: string;
  tags: string | null;
  snippet: string;
  rank: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface KBSearchResponse {
  items: KBSearchResult[];
  query: string;
  total: number;
}

// =============================================================================
// Tree types
// =============================================================================

export type TreeSortOrder = "name-asc" | "name-desc" | "modified-desc";

export interface KBTreeDocItem {
  id: string;
  title: string;
  relative_path: string;
  tags?: string | null;
  updated_at?: string | null;
}

export interface KBTreeNode {
  name: string;
  type: 'folder' | 'file';
  children: KBTreeNode[];
  docs: KBTreeDocItem[];
}

// =============================================================================
// Tag types
// =============================================================================

export interface KBTagInfo {
  tag: string;
  count: number;
}

export interface KBTagOperationResponse {
  docs_updated: number;
  read_only_skipped: number;
}

export interface KBBulkTagEditResponse {
  docs_updated: number;
  read_only_skipped: number;
}

// =============================================================================
// Document list (cursor-paginated)
// =============================================================================

export interface KBDocListResponse {
  items: KBDoc[];
  next_cursor: string | null;
  has_more: boolean;
}

// =============================================================================
// Task types (index + sync)
// =============================================================================

export interface KBIndexStats {
  added: number;
  updated: number;
  deleted: number;
  errors: Array<{ path: string; reason: string }>;
  duration_ms: number;
}

export interface KBTaskStatus {
  task_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  source_id: string;
  started_at: number | null;
  stats: KBIndexStats | null;
  error: string | null;
}

// =============================================================================
// Community catalog
// =============================================================================

export interface KBCatalogEntry {
  slug: string;
  name: string;
  url: string;
  description: string;
  recommended_filters: string[];
  read_only: boolean;
  clone_depth: number;
}

export interface KBAddCommunityRequest {
  project_id: string;
  slug: string;
  include_paths?: string[] | null;
}

export interface KBAddCustomGitRequest {
  project_id: string;
  name: string;
  url: string;
  include_paths?: string[] | null;
}

// =============================================================================
// Tab types
// =============================================================================

export interface KBTab {
  id: string;       // Use docId as tab ID (one tab per unique doc)
  type: 'doc' | 'new'; // Discriminate document vs blank "new tab" landing
  docId: string;    // The KB document ID this tab shows ("" for blank tabs)
  title: string;    // Display title in tab bar
  sourceId: string; // Source for context ("" for blank tabs)
}

// =============================================================================
// Pane types (split views)
// =============================================================================

export interface PaneState {
  id: string;
  type: 'editor' | 'linked';
  linkedToPaneId: string | null;
  openTabs: KBTab[];
  activeTabId: string | null;
  activeDocId: string | null;
  pinnedTabIds: string[];
  navStack: Array<{ docId: string; title: string }>;
  navCursor: number;
  scrollPositions: Record<string, number>;
}

// =============================================================================
// Path validation
// =============================================================================

export interface PathValidationResult {
  path: string;
  exists: boolean;
  is_directory: boolean;
  is_obsidian_vault: boolean;
}
