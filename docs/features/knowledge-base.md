# Feature: Knowledge Base

> Markdown-native vault browser with search, editing, tags, backlinks, split panes, and sync.

## Status

| Attribute | Value |
| --- | --- |
| Status | `implemented` |
| Priority | High |
| Last Updated | 2026-04-11 |

## Shipped Scope

- Local/community/git-backed sources
- Markdown parsing and FTS5 search
- Tree browser, tabs, split panes, bookmarks, backlinks
- Edit, rename, delete, create folder/note
- Sync/index task polling
- Session-local KB performance diagnostics in KB Settings
- Repeatable backend benchmark harness for large-vault baselines
- Path and attachment security guards

## Key Components

- Backend: `backend/app/routers/kb.py`, `backend/app/services/kb_service.py`, `backend/app/services/markdown_parser.py`, `backend/app/services/query_parser.py`
- Frontend: `frontend/src/pages/KnowledgeBase.tsx`, `frontend/src/pages/KBSettings.tsx`, `frontend/src/stores/kbStore.ts`, `frontend/src/lib/perf/kbPerf.ts`, `frontend/src/components/KnowledgeBase/`
- Benchmarking: `backend/app/benchmarks/kb_large_vault.py`, `backend/scripts/run_kb_benchmarks.py`

## Test Coverage

### Critical flows

- Router/service/search/parser coverage: `backend/tests/test_kb_router.py`, `backend/tests/test_kb_service.py`, `backend/tests/test_query_parser.py`, `backend/tests/test_markdown_parser.py`
- Mutations and safety: `backend/tests/test_kb_delete.py`, `backend/tests/test_kb_rename.py`, `backend/tests/test_kb_source_update.py`, `backend/tests/test_kb_sync_router.py`, `backend/tests/test_kb_tag_filter.py`, `backend/tests/test_vault_security.py`
- Linking coverage: `backend/tests/test_linking_router.py`, `backend/tests/test_linking_service.py`
- Frontend coverage: `frontend/src/__tests__/KnowledgeBase.test.tsx`, `frontend/src/__tests__/kbStore.test.ts`, `frontend/src/__tests__/kbApi.test.ts`, `frontend/src/__tests__/KBSettings.test.tsx`, `frontend/src/lib/__tests__/kbPerf.test.ts`, `frontend/src/components/KnowledgeBase/__tests__/KBPerformancePanel.test.tsx`
- Component coverage: `SourceManagement.test.tsx`, `DeleteSourceDialog.test.tsx`, `SourceEditDialog.test.tsx`, `SyncStatusIndicator.test.tsx`, `VaultPathInput.test.tsx`, `KBTreeView.test.tsx`, `KBSearchBar.test.tsx`, `BacklinkPanel.test.tsx`, `UsedInPanel.test.tsx`, `TagFilter.test.tsx`, `wikilinkNavigation.test.tsx`, `MarkdownViewer.test.tsx`, `xss.test.tsx`

### Failure states

- Read-only sources, attachment traversal, and disallowed extensions are covered in backend tests
- Unsaved/edit/search navigation states are covered in frontend tests

### Performance-sensitive guards

- FTS5 remains the primary search path
- Relative paths are normalized in POSIX form to keep Windows/Linux tree behavior consistent
- The KB diagnostics panel records session-local timings for `kb.sources.list`, `kb.tree`, `kb.search`, `kb.document.open`, and end-to-end sync operations
- Only compact metadata is recorded for diagnostics; document bodies are not persisted in telemetry
- Repeatable large-vault baselines are generated through `backend/scripts/run_kb_benchmarks.py`

### Manual smoke

- Browser smoke coverage is documented in `docs/testing/browser-smoke.md`
- Repeatable backend baselines are documented in `docs/testing/kb-benchmarks.md`
- Validated on 2026-04-11: signup/login, create project, add local docs vault, search `architecture`, open `ARCHITECTURE.md`, link a timeline entry to `ARCHITECTURE.md`, inspect KB diagnostics, and hand off terminal context into the AI composer
- Large-vault browser rendering and long-running source refresh remain release smoke checks
