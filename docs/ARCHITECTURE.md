# PwnPilot architecture

PwnPilot is a local-first pentest and CTF workspace. It combines projects, target variables, commands, an embedded terminal, a timeline, Markdown knowledge sources, engagement graphs, reports, and optional AI assistance. Development is paused; this document describes the implemented structure rather than a release commitment.

## System boundaries

```mermaid
flowchart TD
    Browser[React 19 + Vite SPA] -->|REST /api/v1| API[FastAPI routes]
    Browser -->|WebSocket / SSE| Streams[Terminal and AI streams]
    API --> Services[Application services]
    Services --> DB[(SQLite and FTS5)]
    Services --> Files[(Local workspaces and Markdown)]
    Services --> Terminal[Terminal providers]
    Services --> AI[AI API and CLI providers]
    Services --> MCP[MCP tools]
    Terminal --> Shell[Local shell or agent process]
    AI --> Models[Local or remote models]
```

The backend is a modular monolith. Routes handle transport and authorization; services coordinate application behavior; SQLAlchemy models and Alembic migrations manage persistence. The browser uses Zustand and TanStack Query for state and caching. A compatibility `/api` router remains alongside `/api/v1`.

## Components

| Component | Source | Responsibility |
| --- | --- | --- |
| Browser application | `frontend/src/pages/`, `components/` | Project views, terminal, knowledge, reports, and AI UI. |
| Client state | `frontend/src/stores/`, `hooks/`, `lib/queryClient.ts` | UI preferences, server caching, and view coordination. |
| API | `backend/app/main.py`, `routers/` | REST, WebSocket routing, health checks, startup, and shutdown. |
| Services | `backend/app/services/` | Project, terminal, AI, knowledge, reporting, and graph behavior. |
| Persistence | `backend/app/models/`, `backend/alembic/` | Relational models and schema migrations. |
| AI and agents | `backend/app/services/ai*`, `services/agent/` | Providers, context, chat, attachments, and CLI processes. |
| Prompt catalog | `backend/data/prompts/` | Bundled system prompts and reusable templates. |
| Knowledge base | `backend/app/models/knowledge.py`, `frontend/src/pages/KnowledgeBase.tsx` | Markdown sources, indexing, search, wikilinks, and bookmarks. |
| Reporting | `backend/app/models/report.py`, `frontend/src/pages/Reports.tsx` | Sections, update proposals, evidence, and exports. |
| Attack graph | `backend/app/models/graph.py`, `frontend/src/features/attack-graph/` | Typed nodes, edges, scenarios, proposals, and graph views. |

## Command and evidence flow

```mermaid
sequenceDiagram
    participant Operator
    participant UI as Project workspace
    participant API as API and services
    participant Terminal as Terminal provider
    participant Shell as Local shell
    participant DB as SQLite
    Operator->>UI: Select a command
    UI->>API: Request execution with project variables
    API->>Terminal: Validate project and session
    Terminal->>Shell: Send command
    Shell-->>Terminal: Output, status, and duration
    Terminal->>DB: Record command history
    Terminal-->>UI: Transcript and session state
    Operator->>UI: Promote selected evidence
    UI->>API: Link to timeline, knowledge, AI, or graph
    API->>DB: Persist links and proposals
```

## Stored data

- Identity: users, refresh tokens, project memberships, and access requests.
- Projects: type, status, variables, workspace paths, and project settings.
- Commands: global/project libraries, categories, favorites, and execution history.
- Evidence: timeline entries, knowledge links, graph proposals, and report evidence links.
- Knowledge: source records, indexed documents, frontmatter, tags, bookmarks, and full-text indexes.
- AI: provider configurations, context routing, prompts, presets, conversations, messages, CLI sessions, memories, and attachments.
- Runtime: terminal sessions, viewers, and agent process metadata used for recovery.
- Reports: one report per project, sections, revisions, proposed updates, and export artifacts.
- Graphs: nodes, edges, scenarios, positions, and derived engagement state.

SQLite stores structured data. Markdown, attachments, and project files stay on disk. Some settings and derived state use JSON columns. Do not remove migrations or compatibility endpoints solely because they are absent from the current UI: existing databases and clients may depend on them.

The following is a logical model inferred from the SQLAlchemy models and Alembic migrations; it is not a replacement for an exported production schema.

```mermaid
erDiagram
    USER ||--o{ PROJECT_MEMBERSHIP : joins
    PROJECT ||--o{ PROJECT_MEMBERSHIP : grants
    PROJECT ||--o{ COMMAND : owns
    PROJECT ||--o{ TERMINAL_SESSION : scopes
    PROJECT ||--o{ TIMELINE_ENTRY : records
    PROJECT ||--o{ REPORT : contains
    PROJECT ||--o{ GRAPH_NODE : contains
    GRAPH_NODE ||--o{ GRAPH_EDGE : source
    GRAPH_NODE ||--o{ GRAPH_EDGE : target
    PROJECT ||--o{ AI_CONVERSATION : scopes
    AI_CONVERSATION ||--o{ AI_MESSAGE : contains
    KNOWLEDGE_SOURCE ||--o{ TIMELINE_KB_LINK : links
    TIMELINE_ENTRY ||--o{ TIMELINE_KB_LINK : references
    USER {
        uuid id PK
        string email
    }
    PROJECT {
        uuid id PK
        string name
        string status
        string workspace_path
    }
    PROJECT_MEMBERSHIP {
        uuid user_id FK
        uuid project_id FK
        string role
    }
    COMMAND {
        uuid id PK
        uuid project_id FK
        string name
        string command_template
    }
    TERMINAL_SESSION {
        uuid id PK
        uuid project_id FK
        string provider
        string status
    }
    TIMELINE_ENTRY {
        uuid id PK
        uuid project_id FK
        string kind
        datetime created_at
    }
    KNOWLEDGE_SOURCE {
        uuid id PK
        string path
        string source_type
    }
    REPORT {
        uuid id PK
        uuid project_id FK
        string status
    }
    GRAPH_NODE {
        uuid id PK
        uuid project_id FK
        string node_type
    }
    GRAPH_EDGE {
        uuid id PK
        uuid source_node_id FK
        uuid target_node_id FK
    }
    AI_CONVERSATION {
        uuid id PK
        uuid project_id FK
        string provider
    }
    AI_MESSAGE {
        uuid id PK
        uuid conversation_id FK
        string role
    }
    TIMELINE_KB_LINK {
        uuid timeline_id FK
        uuid knowledge_id FK
    }
```

## Configuration and execution

Copy the root `.env.example` to `.env`, then run `start.ps1` on Windows or `bash start.sh` on Linux/Kali. The default application and API ports are 5173 and 8001. The launchers set `VITE_API_URL` and apply migrations before starting services. Configuration details are in the [README](../README.md#configuration).

Windows defaults to the `legacy` terminal provider. Linux/Kali uses `tmux_ttyd` when available. Provider capability responses let the UI distinguish available, degraded, and unavailable sessions.

## Trust boundaries

PwnPilot can start local processes and read configured workspaces. It is intended for a trusted local environment. Local-first storage does not imply offline AI: remote providers receive selected context. Keep credentials, databases, account files, and local configuration outside Git. Community knowledge imports retain their upstream licenses.

## Validation and follow-up

Use [verification scripts](../README.md#development), the [feature coverage matrix](testing/feature-test-matrix.md), and [browser smoke scenarios](testing/browser-smoke.md). Native Linux/Kali terminal behavior and live AI provider behavior require their own environment-specific checks.

The [diagram index](architecture/README.md) provides focused views. Development is paused. PostgreSQL, Redis, and a microservice split are not requirements of the current local-first architecture.
