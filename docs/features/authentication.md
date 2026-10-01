# Feature: Authentication

> Local operator accounts with JWT access tokens, refresh bootstrap, and profile editing.

## Status

| Attribute | Value |
| --- | --- |
| Status | `implemented` |
| Priority | High |
| Last Updated | 2026-04-10 |

## Shipped Scope

- Signup and login
- Access token + refresh flow
- Logout and profile update
- Durable app bootstrap on route reloads
- First-user super-admin bootstrap

## Key Components

- Backend: `backend/app/routers/auth.py`, `backend/app/services/auth_service.py`
- Models: `backend/app/models/user.py`, `backend/app/models/refresh_token.py`
- Frontend: `frontend/src/stores/authStore.ts`, `frontend/src/components/Auth/AuthScreen.tsx`, `frontend/src/App.tsx`

## Test Coverage

### Critical flows

- Signup validation: `backend/tests/test_auth_signup.py`
- Login / refresh / logout contract: `backend/tests/test_auth_login.py`
- Current-user profile and protected access: `backend/tests/test_auth_me.py`
- Crypto helpers: `backend/tests/test_auth_crypto.py`
- UI and bootstrap flow: `frontend/src/__tests__/AuthScreen.test.tsx`, `frontend/src/__tests__/authStore.test.ts`, `frontend/src/__tests__/App.test.tsx`

### Failure states

- Invalid credentials and unauthorized requests are covered in backend auth tests
- Reload bootstrap failures are covered in `authStore.test.ts`

### Manual smoke

- Validate cookie behavior on both `localhost` and `127.0.0.1`
- Reload `/settings` and `/projects/:id/*` after login
