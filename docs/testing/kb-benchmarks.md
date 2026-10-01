# KB Benchmark Baselines

> Repeatable knowledge-base benchmark workflow for larger vaults.

## Purpose

The KB diagnostics panel in the app shows session-local timings from real usage. That is useful for spotting regressions during a session, but it is not a reproducible baseline. This benchmark harness complements the UI diagnostics by generating a synthetic markdown vault and exercising the real backend KB paths against an isolated SQLite/FTS5 database.

Measured operations:
- `index_cold`
- `index_warm`
- `search`
- `tree`
- `document_open`

## Scenarios

| Scenario | Documents | Folders | Intended use |
| --- | ---: | ---: | --- |
| `smoke` | 12 | 3 | Sanity check the harness and JSON output |
| `medium` | 250 | 10 | Local regression comparison during active development |
| `large` | 1000 | 20 | Large-vault baseline capture before release or major KB changes |

## Command

From the repo root on Windows:

```powershell
cd backend
.\.venv\Scripts\python.exe .\scripts\run_kb_benchmarks.py --scenario large --iterations 3 --output .\data\kb-benchmark-large.json
```

From the repo root on Linux / Kali:

```bash
cd backend
./.venv/bin/python ./scripts/run_kb_benchmarks.py --scenario large --iterations 3 --output ./data/kb-benchmark-large.json
```

Benchmark an existing real vault instead of generating a synthetic fixture:

```powershell
cd backend
.\.venv\Scripts\python.exe .\scripts\run_kb_benchmarks.py --vault-path C:\path\to\vault --iterations 3 --output .\data\kb-benchmark-real-vault.json
```

Benchmark a sanitized real vault and redact the local path so the snapshot can be shared safely:

```powershell
cd backend
.\.venv\Scripts\python.exe .\scripts\run_kb_benchmarks.py --vault-path ..\docs --dataset-name repo-docs --redact-path --iterations 3 --output ..\docs\testing\data\kb-benchmarks\2026-04-13-windows-repo-docs.json
```

## Report Format

The script writes a JSON report with:
- dataset metadata (`synthetic` vs `real`)
- scenario metadata
- generated document count
- iteration count
- vault path used for the run
- per-operation summary: `count`, `min_duration_ms`, `max_duration_ms`, `avg_duration_ms`

Stored snapshots live under [docs/testing/data/kb-benchmarks](data/kb-benchmarks).

## Current Baseline Snapshots

Windows workstation baseline refreshed on 2026-04-13:

| Scenario | Snapshot | Cold index | Warm index | Search avg | Tree avg | Document open avg |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `medium` | [2026-04-13-windows-medium.json](data/kb-benchmarks/2026-04-13-windows-medium.json) | 1362 ms | 35 ms | 3.59 ms | 1.73 ms | 1.96 ms |
| `large` | [2026-04-13-windows-large.json](data/kb-benchmarks/2026-04-13-windows-large.json) | 5517 ms | 135 ms | 13.63 ms | 8.17 ms | 1.96 ms |

Previous Windows baseline from 2026-04-12 remains in the snapshot folder for historical comparison.

Sanitized real-vault example captured on 2026-04-13:

| Dataset | Snapshot | Cold index | Warm index | Search avg | Tree avg | Document open avg |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `repo-docs` | [2026-04-13-windows-repo-docs.json](data/kb-benchmarks/2026-04-13-windows-repo-docs.json) | 40 ms | 18 ms | 2.18 ms | 0.89 ms | 1.70 ms |

Interpretation for this refreshed baseline:

- `large` cold indexing dropped from 8452 ms to 5517 ms on this machine, so the current backend KB path still has comfortable headroom for one-shot vault ingestion.
- Warm indexing also improved materially in both scenarios, which is the signal that incremental re-indexing remains healthy rather than rewriting the full vault.
- `search`, `tree`, and `document_open` remain in low single-digit or low double-digit milliseconds even on `large`, so UI rendering and markdown complexity are still the more likely next pressure points than raw backend lookup cost.

## How To Use It

1. Run `smoke` after changing the harness itself.
2. Run `medium` while iterating on KB service changes.
3. Run `large` before merging perf-sensitive KB changes or before release.
4. Run `--vault-path` when a real project vault feels slower than the synthetic baseline suggests.
5. Compare the new JSON report with the previous baseline from the same machine class.

## Interpretation

- `index_cold` captures first-pass indexing cost for a freshly generated vault.
- `index_warm` should stay materially lower than `index_cold`; large regressions here usually indicate wasted reprocessing.
- `search`, `tree`, and `document_open` complement the frontend diagnostics panel: the panel shows user-perceived latency, while this report isolates backend service cost.
- Real-vault runs are intended for local investigation; avoid committing sensitive vault paths or snapshots unless they are sanitized first.
- Use `--dataset-name` plus `--redact-path` when you want a committed real-vault snapshot without leaking a workstation-specific path.

## Non-Goals

- This harness does not replace browser smoke coverage.
- This harness does not measure browser rendering cost.
- This harness is not part of the default `check.ps1` / `check.sh` gate.
