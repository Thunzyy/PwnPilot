# Feature: AI Integration

> Multi-provider AI chat, streaming responses, context building, and operator-side prompt tooling.

## Status

| Attribute | Value |
| --- | --- |
| Status | `implemented` |
| Priority | High |
| Last Updated | 2026-04-12 |

## Shipped Scope

- Provider CRUD and health/model listing
- First-use onboarding with direct provider-settings CTA and local quick-add presets
- Provider runtime hints and actionable attention states for unhealthy local runtimes
- Provider runtime hints that also call out slow healthy runtimes and healthy-but-empty model responses
- Model selector empty/error states with provider-specific guidance instead of generic loading fallbacks
- Conversation, memory, preset, and attachment flows
- SSE/WebSocket streaming
- Context builder using project/timeline/command history/engagement state
- Prompt insertion and prompt-template management
- Shared AI composer handoff from project timeline, command library, and terminal

## Key Components

- Backend: `backend/app/routers/ai.py`, `backend/app/routers/ws_chat.py`, `backend/app/services/llm_service.py`, `backend/app/services/context_builder.py`, `backend/app/services/chat_task_manager.py`
- Frontend: `frontend/src/components/AI/`, `frontend/src/stores/aiStore.ts`, `frontend/src/stores/chatStore.ts`

## Test Coverage

### Critical flows

- AI router and streaming: `backend/tests/test_ai_router.py`, `backend/tests/test_ws_chat.py`
- Provider/model coverage: `backend/tests/test_ai_models.py`, `backend/tests/test_llm_service.py`, `backend/tests/test_ollama_provider.py`, `backend/tests/test_anthropic_provider.py`, `backend/tests/test_openai_compat_provider.py`, `backend/tests/test_openai_official_provider.py`
- Context construction: `backend/tests/test_context_builder.py`
- Frontend chat shell and onboarding: `frontend/src/__tests__/AIChat.test.tsx`
- Provider runtime hints and model-selector guidance: `frontend/src/components/Settings/__tests__/AISettings.test.tsx`, `frontend/src/components/AI/__tests__/ModelSelector.test.tsx`
- Project handoff integration: `frontend/src/__tests__/ProjectView.test.tsx`
- Browser smoke coverage: `frontend/e2e/smoke.spec.ts` for AI empty-state onboarding, local quick-add provider enablement, command-library -> AI, terminal -> AI, timeline -> AI handoffs, and prompt-template create -> insert -> delete inside the project chat shell

### Failure states

- Missing provider and provider errors are covered in backend AI tests
- Missing provider state is surfaced in the frontend onboarding state
- Unhealthy local providers and empty model lists surface provider-specific guidance in frontend tests
- Slow provider tests and healthy-but-empty model responses surface actionable runtime guidance in frontend tests
- Prompt insertion, filtered-category prompt visibility, and variable prompt branching are covered in prompt-management tests

### Manual smoke

- Real provider latency and streaming behavior with external models
- Provider-specific model listing and response quality across real endpoints
