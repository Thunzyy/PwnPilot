# Feature: Collaboration

> Project memberships, access requests, approvals, and team rendering.

## Status

| Attribute | Value |
| --- | --- |
| Status | `implemented` |
| Priority | High |
| Last Updated | 2026-04-12 |

## Shipped Scope

- Membership persistence with role and status
- Access request and approval flows
- Project team panel rendering with collaborator identity fields
- Project-scoped authorization on protected resources

## Key Components

- Backend: `backend/app/routers/memberships.py`, `backend/app/services/membership_service.py`, `backend/app/schemas/membership.py`
- Frontend: `frontend/src/components/Projects/ProjectTeamPanel.tsx`, `frontend/e2e/smoke.spec.ts`

## Test Coverage

### Critical flows

- Access enforcement: `backend/tests/test_project_access.py`
- Request/approval lifecycle: `backend/tests/test_membership_requests.py`
- Team panel UI: `frontend/src/__tests__/ProjectTeamPanel.test.tsx`
- Outsider access states and request CTA: `frontend/src/__tests__/ProjectView.test.tsx`
- Browser smoke:
  - `project admin can invite another operator and share project access`
  - `project outsider can request access and gain visibility after approval`
  - `project outsider sees the denied state after an admin rejects the request`
  - moderation is exercised from `Project Settings -> Team`, not via direct API patching inside the browser smoke

### Failure states

- Non-member and non-admin restrictions are covered in backend tests
- Pending/denied membership rendering and direct-route outsider states are covered in frontend tests

### Remaining manual smoke

- Concurrent role changes or approval actions from multiple admin sessions remain a release-time smoke check
