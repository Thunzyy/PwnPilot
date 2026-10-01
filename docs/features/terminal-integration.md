# Feature: Terminal Integration

> Embedded terminal with platform-aware provider selection and explicit failure states.

## Status

| Attribute | Value |
| --- | --- |
| Status | `implemented` |
| Priority | High |
| Last Updated | 2026-04-13 |

## Shipped Scope

- Provider factory with `tmux_ttyd` and `legacy` implementations
- Capability-driven session creation and viewer behavior
- Windows-safe fallback instead of import-time crash
- Frontend error states for unsupported provider and websocket failure
- Terminal transcript handoff from the active session into the project AI composer

## Key Components

- Backend: `backend/app/services/provider_factory.py`, `backend/app/services/providers/legacy_pty.py`, `backend/app/services/providers/tmux_ttyd.py`, `backend/app/routers/terminal.py`
- Frontend: `frontend/src/stores/terminalStore.ts`, `frontend/src/components/Terminal/AdvancedTerminal.tsx`, `frontend/src/components/Terminal/XTerminal.tsx`

## Test Coverage

### Critical flows

- Provider selection and lazy loading: `backend/tests/test_provider_factory.py`
- Legacy provider behavior: `backend/tests/test_legacy_provider.py`
- POSIX `tmux_ttyd` path: `backend/tests/test_tmux_ttyd_provider.py`
- Router and integration coverage: `backend/tests/test_terminal_router.py`, `backend/tests/test_terminal_integration.py`, `backend/tests/test_terminal_viewers.py`
- UI/store coverage: `frontend/src/__tests__/terminalStore.test.ts`, `frontend/src/__tests__/xterminal.test.tsx`, `frontend/src/components/Terminal/__tests__/AdvancedTerminal.test.tsx`
- Project-shell AI handoff wiring: `frontend/src/__tests__/ProjectView.test.tsx`
- Browser smoke coverage: `frontend/e2e/smoke.spec.ts` for terminal transcript handoff into the project AI composer

### Failure states

- Unsupported platform and websocket-connect failures are asserted in frontend tests
- Missing provider dependencies are covered via backend provider fallback tests
- Empty terminal transcript handoff is ignored in the terminal panel tests

### Manual smoke

- Native detach on Kali/Linux
- Multi-viewer behavior against a real `tmux_ttyd` session
- Terminal command execution and transcript quality on real shells across Windows and Kali

Release-time native validation is now documented explicitly in [terminal-native-smoke.md](../testing/terminal-native-smoke.md).
