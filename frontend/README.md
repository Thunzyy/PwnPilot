# PwnPilot frontend

React 19 and TypeScript application built with Vite. For installation, configuration, and the project status, see the [root README](../README.md).

## Development

From this directory:

```bash
npm ci
npm run dev
npm run lint
npm run build
npm run test -- --run
npm run test:e2e:install
npm run test:e2e
```

Set `VITE_API_URL` to the backend address, normally `http://127.0.0.1:8001`. The root startup scripts set this automatically. Browser tests start a separate backend and Vite server; see [browser testing](../docs/testing/browser-smoke.md).

## Source layout

- `src/pages/`: route-level views.
- `src/components/`: shared and feature-specific UI.
- `src/features/attack-graph/`: graph model, client, and panels.
- `src/api/`: HTTP clients and API contracts.
- `src/stores/` and `src/hooks/`: client state and reusable behavior.
- `e2e/`: Playwright scenarios and fixtures.

Vitest configuration and production bundle splitting are defined in `vite.config.ts`. Do not remove declaration files or test setup modules merely because they are not imported by the application entrypoint.
