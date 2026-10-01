# Feature: Engagement Map

> Project attack graph / visual map, derived from operator activity or seeded with an explicit demo scenario.

## Status

| Attribute | Value |
| --- | --- |
| Status | `implemented` |
| Priority | High |
| Last Updated | 2026-04-13 |

## Shipped Scope

- Visual attack graph embedded in the project workspace
- Graph nodes and edges derived from project engagement state
- Phase-aware lanes for recon, exploitation, priv-esc, and post-exploitation
- Branch-aware styling for success, failure, and phase transitions
- Derived-state ingestion from terminal command history, timeline entries, and linked KB context
- Derived-state ingestion from persisted AI signals, including project chat messages and AI memories
- Selected-node details panel with current command, outcome, phase, and objective
- Manual edit mode for node title, subtitle, phase, outcome, and coordinates
- Add, move, and delete graph nodes from the map inspector
- Explicit realistic CTF demo loader with multiple profiles for fresh/empty projects (`web`, `ad`, `pivoting`, `cloud`)
- Demo state persisted through the same `engagement-state` contract as real project data
- Richer auto-derivation from operator activity, including broader tool-family recognition and phase-aware placement
- MITRE-aware enrichment for linked KB and AI-derived events, including coarse phase hints when only technique context is available

## Key Components

- Backend: `backend/app/routers/project_engagement.py`, `backend/app/schemas/engagement.py`
- Backend providers/enrichment: `backend/app/services/engagement_provider.py`, `backend/app/services/mitre_catalog.py`
- Frontend: `frontend/src/components/Graph/AttackGraph.tsx`, `frontend/src/hooks/useProjectEngagement.ts`, `frontend/src/lib/engagement/demoScenario.ts`, `frontend/src/lib/engagement/stateEditing.ts`, `frontend/src/pages/ProjectView.tsx`

## Test Coverage

### Critical flows

- Engagement derivation and stored-state behavior, including timeline, AI, and MITRE hints: `backend/tests/test_project_engagement_state.py`
- Demo scenario payload contract: `frontend/src/lib/__tests__/engagementDemoScenario.test.ts`
- Manual graph editing helpers: `frontend/src/lib/__tests__/engagementStateEditing.test.ts`
- Graph empty state, details, realistic rendering, and edit controls: `frontend/src/components/Graph/__tests__/AttackGraph.test.tsx`
- Workspace integration: `frontend/src/__tests__/ProjectView.test.tsx`
- Browser smoke: `frontend/e2e/smoke.spec.ts` for expanding the graph, loading non-default demo profiles, persisting an edited node on a fresh project, deriving a graph node from a timeline note, and deriving a graph node from a persisted AI memory

### Failure states

- Engagement-state load/save failures still surface through the project engagement hook and graph error state
- Empty graph state remains explicit and no longer silently looks like a broken/incomplete render
- Invalid edit-mode inputs are rejected by the same engagement-state contract that stores real project data
- Timeline-only projects can now derive a non-empty engagement path without needing seeded terminal history first
- MITRE-only evidence can now push the graph into the right coarse phase even when no tool-family string is present yet

### Manual smoke

- Real operator history on long engagements with dense branching
- Cross-check that the visual lane layout stays readable with very large command histories
- Cross-check mixed command + timeline + linked-knowledge histories on dense engagements
- Cross-check mixed command + timeline + linked-knowledge + AI histories on dense engagements
- Confirm that profile switching still produces distinct demo shapes for `web`, `ad`, `pivoting`, and `cloud`
