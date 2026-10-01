# AI and knowledge base

```mermaid
flowchart TB
    subgraph AI[AI assistance]
        CHAT[Chat UI] --> STREAM[WebSocket / SSE]
        STREAM --> PROVIDERS[LLM API / CLI providers]
        PROMPTS[Prompt templates] --> CHAT
        MEM[Memories and presets] --> CHAT
        PROVIDERS --> CHAT
    end
    subgraph KB[Knowledge base]
        EDIT[Markdown editor] --> INDEX[Index and sync]
        FS[(Vault files)] --> INDEX
        INDEX --> SEARCH[SQLite FTS search]
        SEARCH --> EDIT
        SEARCH --> TAGS[Tags / backlinks / bookmarks]
    end
    KB -->|Selected context| AI
    AI -->|Results and notes| KB
```

Knowledge sources provide navigation and full-text search as well as editing. AI can use project context, selected documents, prompts, and memories. The configured provider determines whether processing happens locally or through a remote service. Provider credentials and runtime settings belong in local configuration, not in repository examples.
