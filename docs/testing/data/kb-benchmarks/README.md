# KB Benchmark Snapshots

> Stored JSON baselines for repeatable KB benchmark runs.

## Naming

- Synthetic baseline format: `YYYY-MM-DD-<platform>-<scenario>.json`
- Sanitized real-vault format: `YYYY-MM-DD-<platform>-<dataset-name>.json`
- Examples: `2026-04-12-windows-large.json`, `2026-04-13-windows-repo-docs.json`

## Current snapshots

- `2026-04-12-windows-medium.json`
- `2026-04-12-windows-large.json`
- `2026-04-13-windows-medium.json`
- `2026-04-13-windows-large.json`
- `2026-04-13-windows-repo-docs.json`

## Use

- Compare only runs taken on comparable hardware and the same platform family.
- Keep this folder append-only for benchmark history.
- Update [kb-benchmarks.md](../../kb-benchmarks.md) when a new baseline becomes the reference.
- Do not commit real-vault snapshots or paths unless they are sanitized and safe to keep in the repo.
