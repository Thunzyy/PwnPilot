# Feature domains

```mermaid
flowchart TB
    AUTH[Authentication] --> DASH[Project dashboard]
    TEAM[Memberships and access] --> PROJ[Project workspace]
    DASH --> PROJ
    PROJ --> CMD[Command library]
    PROJ --> TERM[Terminal]
    PROJ --> TL[Timeline]
    PROJ --> KB[Knowledge base]
    PROJ --> MAP[Attack graph]
    PROJ --> REPORT[Reports]
    CMD --> TERM
    CMD --> AI[AI assistant]
    TERM --> AI
    TERM --> MAP
    TL --> MAP
    TL --> KB
    KB --> PROMPTS[Prompt templates]
    PROMPTS --> AI
    AI --> MEM[Project memories]
    MEM --> PROJ
    MAP --> REPORT
```

The project workspace connects operational views. The terminal, knowledge base, and timeline provide evidence and context. AI consumes project context and selected material; report workflows turn recorded evidence into reviewable write-ups.
