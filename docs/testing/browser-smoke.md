# Browser Smoke Coverage

> Automated browser-level smoke checks for the critical local operator loop.

## Command

Run once per machine to install Chromium:

```bash
cd frontend
npm run test:e2e:install
```

Run the smoke suite:

```bash
cd frontend
npm run test:e2e
```

The repo verification gate also runs this suite through `scripts/check.ps1` and `scripts/check.sh`.

## Last Verified

- Date: 2026-04-13
- Host: Windows workstation
- Command: `npm run test:e2e`
- Result: `23 passed`

## Harness

- Runner: Playwright
- Frontend: ephemeral Vite server on `127.0.0.1:4173`
- Backend: ephemeral FastAPI server on `127.0.0.1:8006`
- Database: isolated SQLite file under the OS temp directory
- Terminal provider: forced to `legacy` for cross-platform smoke stability

The backend harness resets its own runtime directory and database on each run so the suite stays deterministic and does not reuse a developer's local state.

## Covered Flows

| Flow | Covered by |
| --- | --- |
| Auth screen visible on first load | `frontend/e2e/smoke.spec.ts` |
| Signup and auth persistence across reload | `frontend/e2e/smoke.spec.ts` |
| Create project and enter workspace | `frontend/e2e/smoke.spec.ts` |
| Invite another operator and verify shared project visibility | `frontend/e2e/smoke.spec.ts` |
| Outsider requests access to a direct project URL and gains visibility after admin approval | `frontend/e2e/smoke.spec.ts` |
| Outsider requests access to a direct project URL and sees the denied state after admin rejection | `frontend/e2e/smoke.spec.ts` |
| Add local docs vault from KB Settings | `frontend/e2e/smoke.spec.ts` |
| Search `architecture` in KB | `frontend/e2e/smoke.spec.ts` |
| Open `ARCHITECTURE.md` in the KB viewer | `frontend/e2e/smoke.spec.ts` |
| Expand the attack graph, switch demo profiles, and load the realistic CTF demo on a fresh project | `frontend/e2e/smoke.spec.ts` |
| Enter attack-graph edit mode and persist a node label change | `frontend/e2e/smoke.spec.ts` |
| Derive an attack-graph node from a timeline note after workspace reload | `frontend/e2e/smoke.spec.ts` |
| Derive an attack-graph node from a persisted AI memory after workspace reload | `frontend/e2e/smoke.spec.ts` |
| Command-library search handoff into the project AI composer | `frontend/e2e/smoke.spec.ts` |
| Command-library run handoff into the project terminal | `frontend/e2e/smoke.spec.ts` |
| Project command-settings create -> update -> delete for a custom command | `frontend/e2e/smoke.spec.ts` |
| Project command-library batch delete for multiple custom commands | `frontend/e2e/smoke.spec.ts` |
| Terminal transcript handoff into the project AI composer | `frontend/e2e/smoke.spec.ts` |
| Timeline entry handoff into the project AI composer | `frontend/e2e/smoke.spec.ts` |
| Timeline entry linking to a KB article | `frontend/e2e/smoke.spec.ts` |
| Timeline mixed feed search/filter across timeline + command history entries | `frontend/e2e/smoke.spec.ts` |
| Timeline dense-feed diagnostics after mixed activity search | `frontend/e2e/smoke.spec.ts` |
| AI empty state opens provider settings from a fresh project | `frontend/e2e/smoke.spec.ts` |
| AI empty state quick-adds a local provider and unlocks chat | `frontend/e2e/smoke.spec.ts` |
| AI prompt template create -> insert -> delete flow inside project chat | `frontend/e2e/smoke.spec.ts` |

## Operator Loop Anchors

The smoke suite intentionally anchors itself to user-visible controls that match the real operator loop:

- Commands handoff:
  - Project tab: `Commands`
  - Page heading: `Project Command Library`
  - Search input placeholder: `Search project + global command database...`
  - Handoff button title: `Ask AI to find a command`
  - Run CTA: `Run Command`
- Project command settings CRUD:
  - Commands CTA: `Manage Commands`
  - Page heading: `Project Command Settings`
  - Create-form labels: `New command name`, `New command category`, `New command body`
  - Row CTAs: `Save`, `Delete`
- Project command-library batch delete:
  - Commands tab CTA: `Select`
  - Card action label: `Select command <name>`
  - Bulk CTA: `Delete selected`
  - Confirmation dialog title: `Delete command(s)?`
- Terminal launch handoff:
  - Landing tab: `Terminal`
  - Ready signal: `Send to AI`
- AI composer:
  - Prompt textbox accessible name: `Query PwnPilot context or ask for help...`
- Prompt management:
  - Side-panel tab: `Prompts`
  - Search input placeholder: `Search templates...`
  - Creation CTA: `New Template`
  - Row actions: `Insert into chat`, `Delete`
- Terminal handoff:
  - Footer action: `Send to AI`
  - Expected seeded transcript markers: `Terminal session:` and `Connected to terminal session`
- Engagement map:
  - Collapsed CTA: `Expand attack graph`
  - Empty-state CTA: `Load realistic CTF demo`
  - Demo-profile selector: `Demo profile`
  - Edit-mode CTA: `Edit map`
  - Save CTA: `Save step`
  - Confirmation markers: `Stored scenario`, timeline-derived subtitles like `Timeline finding`, AI-derived subtitles like `AI memory`, MITRE markers like `MITRE T1068`, and the seeded path nodes
- Timeline handoff:
  - Project tab: `History`
  - Entry action: `Send to AI`
  - Expected seeded prompt markers: `Timeline entry (note)` and the seeded entry content/output
- Timeline KB linking:
  - Entry action: `Link Knowledge`
  - Dialog heading: `Link Knowledge Base Article`
  - Expected linked-state marker: `Related Knowledge`
- Timeline mixed search/filter:
  - Search placeholder: `Search audit logs...`
  - Filter buttons: `All Activity`, `Commands`, `Notes`
  - Empty-state marker: `No activity matches current search/filter.`
- Timeline diagnostics:
  - Diagnostics panel test id: `timeline-performance-panel`
  - Expected operation markers: `timeline.load`, `timeline.filter`
- Collaboration invite:
  - Workspace CTA: `Project Settings`
  - Settings section: `Team`
  - Invite controls: `Invite username or email`, `Invite role`, `Invite`
  - Invitee confirmation: project card becomes visible on the dashboard after reload
- Collaboration request access:
  - Direct project route: `/projects/:id`
  - Outsider state CTA: `Request Access`
  - Pending-state marker: `Access request pending`
  - Denied-state marker: `Access denied`
  - Admin moderation surface: `Project Settings -> Team`
  - Admin moderation CTAs: `Approve`, `Deny`

## Intentional Gaps

- AI response generation is not part of this smoke suite because it depends on external provider configuration.
- Kali-native `tmux_ttyd` behavior remains a platform smoke concern outside this cross-platform harness and is covered by [terminal-native-smoke.md](terminal-native-smoke.md).
- Large-vault rendering and benchmark comparisons remain covered by targeted KB perf tooling, not by the fast smoke suite.
