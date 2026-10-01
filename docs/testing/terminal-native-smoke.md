# Terminal Native Smoke Protocol

> Release-time validation for the real `tmux_ttyd` terminal path on Kali/Linux.

## Why This Exists

The default browser smoke suite forces the portable `legacy` provider so it stays deterministic on Windows and CI-like local runs. That is the right default for the fast gate, but it intentionally does not prove the native Kali/Linux path.

This protocol is the missing complement:

- real `tmux_ttyd` session lifecycle
- detach / reattach behavior
- multi-viewer attach behavior
- transcript quality from a real shell
- AI handoff from a real terminal transcript

## Preconditions

- Host: Kali or Linux workstation with a real shell environment
- `tmux` installed and available on `PATH`
- `ttyd` installed and available on `PATH`
- Backend started with the native provider path enabled or auto-detected
- Frontend reachable locally
- A test project already exists or can be created quickly

Recommended preflight:

```bash
which tmux
which ttyd
tmux -V
ttyd --version
```

If any of these fail, this protocol is not valid yet. Fix the environment first.

## Session Under Test

- Project route: `/projects/:id`
- Tab: `Terminal`
- Expected provider outcome: native `tmux_ttyd`, not `legacy`

If the UI or backend clearly falls back to `legacy`, stop and record that as a failed native-terminal validation rather than continuing as if the test passed.

## Checklist

### 1. Native session creation

1. Open the target project.
2. Navigate to `Terminal`.
3. Create or attach to the default session.
4. Confirm the terminal is interactive and not stuck in a degraded or unavailable state.

Pass criteria:

- shell prompt appears
- keyboard input is accepted
- no provider error is shown

### 2. Real command execution and transcript quality

Run these commands manually:

```bash
pwd
printf 'native-terminal-smoke\nline-two\n'
echo "$SHELL"
```

Pass criteria:

- output order is correct
- multiline output is preserved
- prompt returns cleanly after each command
- transcript is readable enough to hand off to AI

### 3. Detach and reattach

1. Leave the terminal tab or refresh the project route.
2. Return to `Terminal`.
3. Reattach to the same session.

Pass criteria:

- same terminal session is reused
- previous output is still visible or recoverable through the session
- no duplicate zombie sessions are created

### 4. Multi-viewer attach

1. Open the same project in a second browser window or second profile.
2. Attach both viewers to the same terminal session.
3. Execute a visible command from one viewer.

Suggested command:

```bash
echo multi-viewer-smoke
```

Pass criteria:

- second viewer sees the same live session
- new output appears for both viewers
- neither viewer becomes permanently disconnected

### 5. AI transcript handoff

1. From the active terminal session, use `Send to AI`.
2. Confirm the AI composer opens with seeded terminal context.

Pass criteria:

- seeded prompt contains terminal markers and recent output
- handoff does not open an empty AI composer

### 6. Failure-path sanity

While still on Kali/Linux:

- stop `ttyd` or break the provider intentionally only if safe to do so
- confirm the app degrades honestly instead of hanging silently

Pass criteria:

- failure is explicit
- reconnect or fallback behavior is understandable

## Evidence To Record

For each release-time run, capture:

- date
- machine / distro
- `tmux` version
- `ttyd` version
- pass/fail per checklist item
- short notes on any transcript corruption, attach instability, or viewer desync

Template:

```text
Date:
Host:
tmux:
ttyd:
Project:

1. Native session creation: PASS/FAIL
2. Transcript quality: PASS/FAIL
3. Detach/reattach: PASS/FAIL
4. Multi-viewer attach: PASS/FAIL
5. AI transcript handoff: PASS/FAIL
6. Failure-path sanity: PASS/FAIL

Notes:
```

## Non-Goals

- This protocol does not replace `scripts/check.ps1` or `scripts/check.sh`.
- This protocol is not required on Windows.
- This protocol is not intended to fake native shell behavior inside the fast Playwright harness.
