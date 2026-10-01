# Feature: Prompt Management

> Built-in and user-defined prompt templates used by the AI workflow.

## Status

| Attribute | Value |
| --- | --- |
| Status | `implemented` |
| Priority | Medium |
| Last Updated | 2026-04-10 |

## Shipped Scope

- Prompt-template listing by category
- User prompt creation and deletion
- Variable-aware prompt insertion into chat
- Startup sync from disk to database

## Key Components

- Backend: `backend/app/routers/prompts.py`, `backend/app/services/prompt_sync.py`, `backend/data/prompts/`
- Frontend: `frontend/src/components/AI/panels/PromptsPanel.tsx`

## Test Coverage

### Critical flows

- Router coverage: `backend/tests/test_prompts_router.py`
- Frontend prompt panel CRUD and insert flows: `frontend/src/components/AI/panels/__tests__/PromptsPanel.test.tsx`

### Failure states

- Ownership and not-found cases are covered in backend router tests
- Variable template routing is covered in frontend prompt-panel tests

### Manual smoke

- Disk-to-database sync diffs at app startup
