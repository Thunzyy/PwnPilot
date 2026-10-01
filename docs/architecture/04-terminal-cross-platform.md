# Cross-platform terminal

```mermaid
flowchart LR
    FE[Terminal UI] --> API[Terminal API]
    API --> F[Provider factory]
    F --> D{Host capabilities}
    D -->|Linux / Kali with tmux and ttyd| T[tmux_ttyd]
    D -->|Portable fallback| L[legacy PTY]
    T --> S[Persisted session metadata]
    L --> S
    T --> WS[WebSocket and attach flow]
    L --> WS
    API --> CAP[Capability response]
    CAP --> FULL[Available]
    CAP --> DEG[Degraded]
    CAP --> NA[Unavailable]
```

Provider selection must reflect actual host support. Windows defaults to `legacy`; Linux/Kali prefers `tmux_ttyd` when its dependencies are installed. An explicit degraded or unavailable state is preferable to a silent failure.

Cross-platform browser tests do not establish native tmux/ttyd behavior. Use the [Linux/Kali protocol](../testing/terminal-native-smoke.md) to verify detach, multiple viewers, transcripts, and AI handoffs on that platform.
