# Feature: Project Management

> Project lifecycle, dashboard listing, workspace creation, and engagement state.

## Status

| Attribute | Value |
| --- | --- |
| Status | `implemented` |
| Priority | High |
| Last Updated | 2026-04-10 |

## Shipped Scope

- Project CRUD
- Workspace directory creation
- Variables and project notes/settings
- Engagement-state derivation and persistence
- Dashboard filtering and navigation

## Key Components

- Backend: `backend/app/routers/projects.py`, `backend/app/routers/project_engagement.py`, `backend/app/services/project_service.py`
- Models: `backend/app/models/project.py`, `backend/app/models/project_membership.py`
- Frontend: `frontend/src/pages/Dashboard.tsx`, `frontend/src/pages/ProjectView.tsx`, `frontend/src/pages/ProjectSettings.tsx`

## Test Coverage

### Critical flows

- CRUD and slug/workspace behavior: `backend/tests/test_projects.py`
- Engagement-state derivation/storage: `backend/tests/test_project_engagement_state.py`
- Dashboard and new-project flows: `frontend/src/__tests__/DashboardFilters.test.tsx`, `frontend/src/__tests__/NewProjectFlow.test.tsx`
- Project settings and shell layout: `frontend/src/__tests__/ProjectSettings.test.tsx`, `frontend/src/__tests__/ProjectSetupPanel.test.tsx`, `frontend/src/__tests__/ProjectView.test.tsx`

### Failure states

- Duplicate slug handling and forbidden paths are covered in backend project tests
- Query bootstrap and route param failure states are covered in ProjectView/ProjectSettings tests

### Manual smoke

- Large project dashboards
- Real filesystem cleanup on delete in a non-test workspace
