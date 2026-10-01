# Feature: Timeline & History

> Project activity feed, command history visibility, and KB linking.

## Status

| Attribute | Value |
| --- | --- |
| Status | `implemented` |
| Priority | High |
| Last Updated | 2026-04-13 |

## Shipped Scope

- Timeline listing and rendering
- Command-history integration
- Command-to-AI handoff from history entries
- Related KB linking dialog and display
- Session-local diagnostics for mixed-feed load/filter timings
- Project-scoped access checks

## Key Components

- Backend: `backend/app/routers/timeline.py`, `backend/app/routers/command_history.py`, `backend/app/routers/linking.py`
- Frontend: `frontend/src/components/Timeline/TimelineView.tsx`, `frontend/src/components/Timeline/LinkKnowledgeDialog.tsx`

## Test Coverage

### Critical flows

- Access control: `backend/tests/test_timeline_access.py`
- KB linking routes/services: `backend/tests/test_linking_router.py`, `backend/tests/test_linking_service.py`
- UI coverage: `frontend/src/__tests__/TimelineView.test.tsx`, `frontend/src/__tests__/ProjectView.test.tsx`, `frontend/src/components/Timeline/__tests__/LinkKnowledgeDialog.test.tsx`
- Browser smoke coverage: `frontend/e2e/smoke.spec.ts` for timeline -> AI handoff, timeline entry -> KB linking, mixed timeline + command-history search/filter, and dense mixed-feed diagnostics visibility

### Failure states

- Unauthorized project access is covered in backend access tests
- Link dialog empty/error states are covered in frontend tests
- Project AI handoff wiring is covered in frontend integration tests
- Timeline diagnostics aggregation and clearing are covered in dedicated frontend tests

### Manual smoke

- Extremely large activity feeds with realistic markdown-heavy outputs and browser memory pressure
