# Engagement maps and simulation

PwnPilot contains an engagement-state contract and a separate typed attack-graph API. Keep these contracts distinct when tracing data or changing a view.

```mermaid
flowchart LR
    HISTORY[Command history] --> DERIVE[Workspace signal derivation]
    TL[Timeline entries and KB links] --> DERIVE
    AI[Persisted AI messages and memories] --> DERIVE
    MITRE[MITRE catalog] --> DERIVE
    DERIVE --> STATE[Engagement state]
    STORED[Stored project state] --> STATE
    STATE --> CHECK[Sidebar checklist]
    STATE --> MAP[Engagement map]
    EDIT[Manual edits] -->|PUT engagement-state| STORED
    DEMO[Explicit simulation profiles] -->|PUT engagement-state| STORED
    HISTORY --> PROPOSALS[Graph proposals]
    PROPOSALS --> REVIEW[Accept or reject]
    REVIEW --> GRAPH[Typed graph nodes and edges]
    SEED[Explicit CTF graph seed] --> GRAPH
    GRAPH --> REPORT[Report evidence and exports]
```

When no stored engagement state exists, derivation uses command history, timeline/knowledge links, and persisted AI signals. Tool patterns and MITRE technique metadata inform phases and layout. Timeline and AI nodes retain explicit provenance labels so they are not mistaken for shell execution.

Manual engagement edits and the web, AD, pivoting, and cloud simulation profiles use the same engagement-state contract as the checklist. The typed graph has its own nodes, edges, scenarios, proposals, and position persistence. Its built-in CTF seed creates synthetic evidence; it does not execute the example attack commands. See the [engagement feature](../features/engagement-map.md) and [browser smoke tests](../testing/browser-smoke.md).
