# Frontend, backend, and data flow

```mermaid
sequenceDiagram
    autonumber
    participant U as Operator
    participant FE as React UI
    participant QC as Query cache and stores
    participant API as FastAPI
    participant SVC as Application services
    participant DB as SQLite
    participant FS as Filesystem
    U->>FE: Open a page or invoke an action
    FE->>QC: Read cached state or request data
    QC->>API: GET /api/v1/... or mutation
    API->>SVC: Validate and dispatch
    SVC->>DB: Read or update records
    SVC->>FS: Read or write local files when needed
    DB-->>SVC: Records
    FS-->>SVC: Markdown, attachments, or prompts
    SVC-->>API: Result
    API-->>QC: Response payload
    QC-->>FE: Updated state
    FE-->>U: Updated view
```

Client caches support fast reads; the backend remains the source of truth. Writes go through API routes and services. Project files remain on disk where filesystem storage is more appropriate than relational records.
