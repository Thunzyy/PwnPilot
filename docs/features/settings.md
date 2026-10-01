# Feature: Settings

> Operator profile, infrastructure defaults, AI/provider config, KB settings, and project command settings.

## Status

| Attribute | Value |
| --- | --- |
| Status | `implemented` |
| Priority | Medium |
| Last Updated | 2026-04-10 |

## Shipped Scope

- Operator profile settings
- Global infrastructure defaults
- AI/provider configuration screens
- KB settings and source management
- Project-level command settings

## Key Components

- Backend: `backend/app/routers/settings.py`, `backend/app/routers/auth.py`, `backend/app/routers/ai.py`
- Frontend: `frontend/src/pages/Settings.tsx`, `frontend/src/components/Settings/OperatorSettings.tsx`, `frontend/src/pages/KBSettings.tsx`, `frontend/src/pages/ProjectCommandSettings.tsx`

## Test Coverage

### Critical flows

- Settings API: `backend/tests/test_settings.py`
- Operator/global settings UI: `frontend/src/__tests__/OperatorSettings.test.tsx`
- Project command settings UI: `frontend/src/__tests__/CommandSettings.test.tsx`
- KB settings/source management: `frontend/src/__tests__/KBSettings.test.tsx`, `frontend/src/components/Settings/__tests__/SourceManagement.test.tsx`

### Failure states

- Super-admin-only settings updates are covered in backend tests
- Dialog validation and destructive flows are covered in source-management component tests

### Manual smoke

- Real provider credentials and OS-specific path validation
