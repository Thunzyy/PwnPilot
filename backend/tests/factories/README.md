# Engagement Trace Scenarios

This folder contains deterministic history scenarios used by engagement-state tests.

Current factory module: `backend/tests/factories/engagement_traces.py`

How to add a new scenario:
1. Add a function returning `list[tuple[str, int]]` where each tuple is `(command, exit_code)`.
2. Keep command order stable because graph generation is time-ordered.
3. Reuse existing scenario helpers with unpacking (`*scenario_recon()`) when possible.
4. Use the scenario from `backend/tests/test_project_engagement_state.py` through `_derive_state_payload(...)`.

