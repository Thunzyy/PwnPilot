# Feature: Commands Library

> Searchable pentest command catalog with favorites, variables, and project-level settings.

## Status

| Attribute | Value |
| --- | --- |
| Status | `implemented` |
| Priority | Medium |
| Last Updated | 2026-04-13 |

## Shipped Scope

- Seeded and user/project command catalogs
- Categories and filters
- Favorites
- Batch selection and delete in the project command library
- Variable-aware command rendering
- Command settings per project
- AI handoff from search context or selected command shortlist
- Run-to-terminal handoff inside the project workspace

## Key Components

- Backend: `backend/app/routers/commands.py`, `backend/app/routers/command_categories.py`, `backend/app/routers/command_favorites.py`, `backend/app/routers/command_variables.py`
- Frontend: `frontend/src/components/Commands/CommandsLibrary.tsx`, `frontend/src/components/Commands/CommandCard.tsx`, `frontend/src/components/Commands/VariablesPanel.tsx`

## Test Coverage

### Critical flows

- API/model coverage: `backend/tests/test_commands_api.py`, `backend/tests/test_command_models.py`
- Categories, filters, favorites, variables: `backend/tests/test_command_categories_filters.py`, `backend/tests/test_command_favorites.py`, `backend/tests/test_command_variables.py`
- UI/store coverage: `frontend/src/__tests__/CommandCard.test.tsx`, `frontend/src/__tests__/CommandLibraryPage.test.tsx`, `frontend/src/__tests__/CommandsLibrary.test.tsx`, `frontend/src/__tests__/CommandsLibraryFavorites.test.tsx`, `frontend/src/__tests__/VariablesPanel.test.tsx`, `frontend/src/__tests__/CommandSettings.test.tsx`, `frontend/src/__tests__/commandSettingsStore.test.ts`, `frontend/src/__tests__/commandGlobalsStore.test.ts`, `frontend/src/__tests__/ProjectView.test.tsx`
- Browser smoke coverage: `frontend/e2e/smoke.spec.ts` for command-search handoff into the project AI composer, command-run handoff into the project terminal, project command-settings create -> update -> delete for a custom command, and project command-library batch delete for custom commands

### Failure states

- Empty result/filter states and favorite toggles are covered in frontend tests
- Variable-resolution rules are covered in backend tests
- AI handoff prompt generation is covered in frontend tests

### Manual smoke

- Very large command libraries with heavy mixed global/project filtering
