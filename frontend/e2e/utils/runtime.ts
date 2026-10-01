import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);

export const frontendDir = path.resolve(currentDir, "..", "..");
export const repoRoot = path.resolve(frontendDir, "..");
export const backendDir = path.join(repoRoot, "backend");

export const smokeBackendPort = Number(
  process.env.PW_SMOKE_BACKEND_PORT ?? "8006"
);
export const smokeFrontendPort = Number(
  process.env.PW_SMOKE_FRONTEND_PORT ?? "4173"
);

export const smokeBackendUrl =
  process.env.PW_SMOKE_BACKEND_URL ??
  `http://127.0.0.1:${smokeBackendPort}`;
export const smokeFrontendUrl =
  process.env.PW_SMOKE_FRONTEND_URL ??
  `http://127.0.0.1:${smokeFrontendPort}`;

export const smokeRuntimeDir = path.join(os.tmpdir(), "pwnpilot-smoke");
export const smokeDatabasePath = path.join(smokeRuntimeDir, "smoke-e2e.db");
export const smokeProjectsRoot = path.join(smokeRuntimeDir, "projects");
export const smokeDocsVaultPath =
  process.env.PW_SMOKE_DOCS_PATH ?? path.join(repoRoot, "docs");

export const uniqueSmokeSuffix = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
