# System overview

```mermaid
flowchart LR
    U[Operator] --> B[Browser]
    B --> FE[React and Vite]
    FE -->|HTTP /api/v1| BE[FastAPI]
    FE -->|WebSocket| WS[Chat and terminal routes]
    BE --> DB[(SQLite)]
    BE --> FS[(Local files and Markdown)]
    BE --> AI[AI services]
    BE --> KB[Knowledge services]
    BE --> TM[Terminal services]
    BE --> MCP[MCP tools]
    AI --> P[API and CLI providers]
    KB --> DB
    KB --> FS
    TM --> PT[tmux / ttyd / PTY]
    MCP --> DB
    MCP --> FS
```

The browser runs a single-page application. The local backend owns API contracts, WebSocket connections, SQLite persistence, and filesystem access. Platform-specific capabilities are isolated behind services and terminal providers. Remote AI providers are optional and receive the context sent to them.
