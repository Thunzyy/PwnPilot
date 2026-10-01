import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const frontendDir = path.resolve(currentDir, "..");
const repoRoot = path.resolve(frontendDir, "..");
const backendDir = path.join(repoRoot, "backend");

const smokeRuntimeDir = path.join(os.tmpdir(), "pwnpilot-smoke");
const smokeDatabasePath = path.join(smokeRuntimeDir, "smoke-e2e.db");
const smokeProjectsRoot = path.join(smokeRuntimeDir, "projects");
const smokeBackendPort = Number(process.env.PW_SMOKE_BACKEND_PORT ?? "8006");
const smokeBackendUrl =
  process.env.PW_SMOKE_BACKEND_URL ??
  `http://127.0.0.1:${smokeBackendPort}`;

function resolveBootstrapPython() {
  const candidates = process.platform === "win32"
    ? [
        { command: "py", args: ["-3"] },
        { command: "python", args: [] },
      ]
    : [{ command: "python3", args: [] }, { command: "python", args: [] }];

  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, [...candidate.args, "--version"], {
      stdio: "ignore",
    });
    if (result.status === 0) {
      return candidate;
    }
  }

  throw new Error("No bootstrap Python interpreter available to create backend virtual environment");
}

function ensureBackendVenv() {
  const dotVenvDir = path.join(backendDir, ".venv");
  const dotVenvPython = process.platform === "win32"
    ? path.join(dotVenvDir, "Scripts", "python.exe")
    : path.join(dotVenvDir, "bin", "python");

  if (fs.existsSync(dotVenvPython)) {
    return dotVenvPython;
  }

  fs.mkdirSync(dotVenvDir, { recursive: true });

  const bootstrap = resolveBootstrapPython();
  const createVenv = spawnSync(
    bootstrap.command,
    [...bootstrap.args, "-m", "venv", dotVenvDir],
    {
      cwd: backendDir,
      stdio: "inherit",
    }
  );

  if (createVenv.status !== 0 || !fs.existsSync(dotVenvPython)) {
    throw new Error(`Failed to bootstrap backend virtual environment at ${dotVenvDir}`);
  }

  const installDeps = spawnSync(
    dotVenvPython,
    [
      "-m",
      "pip",
      "install",
      "-q",
      "-r",
      "requirements.txt",
      "-r",
      "requirements-dev.txt",
    ],
    {
      cwd: backendDir,
      stdio: "inherit",
    }
  );

  if (installDeps.status !== 0) {
    throw new Error("Failed to install backend dependencies for smoke backend");
  }

  return dotVenvPython;
}

function resolveBackendPython() {
  const candidates = [
    path.join(backendDir, ".venv", "Scripts", "python.exe"),
    path.join(backendDir, ".venv", "bin", "python"),
    path.join(backendDir, "venv", "Scripts", "python.exe"),
    path.join(backendDir, "venv", "bin", "python"),
  ];

  const resolved = candidates.find((candidate) => fs.existsSync(candidate));
  if (!resolved) {
    return ensureBackendVenv();
  }

  return resolved;
}

function toDatabaseUrl(databasePath) {
  return `sqlite+aiosqlite:///${databasePath.replace(/\\/g, "/")}`;
}

function forwardSignal(signal, childProcess) {
  if (childProcess.exitCode !== null) {
    return;
  }
  childProcess.kill(signal);
}

fs.mkdirSync(smokeRuntimeDir, { recursive: true });
fs.rmSync(smokeDatabasePath, { force: true });
fs.rmSync(smokeProjectsRoot, { recursive: true, force: true });
fs.mkdirSync(smokeProjectsRoot, { recursive: true });

const backendPython = resolveBackendPython();
const backendEnv = {
  ...process.env,
  DEBUG: "false",
  CONSOLE_PROVIDER: process.env.CONSOLE_PROVIDER ?? "legacy",
  DATABASE_URL: toDatabaseUrl(smokeDatabasePath),
  API_BASE_URL: `${smokeBackendUrl}/api/v1`,
  PROJECTS_ROOT: smokeProjectsRoot,
};

const migrate = spawnSync(
  backendPython,
  ["-m", "alembic", "upgrade", "head"],
  {
    cwd: backendDir,
    env: backendEnv,
    stdio: "inherit",
  }
);

if (migrate.status !== 0) {
  process.exit(migrate.status ?? 1);
}

const backendProcess = spawn(
  backendPython,
  [
    "-m",
    "uvicorn",
    "app.main:app",
    "--host",
    "127.0.0.1",
    "--port",
    String(smokeBackendPort),
  ],
  {
    cwd: backendDir,
    env: backendEnv,
    stdio: "inherit",
  }
);

process.on("SIGINT", () => forwardSignal("SIGINT", backendProcess));
process.on("SIGTERM", () => forwardSignal("SIGTERM", backendProcess));

backendProcess.on("exit", (code) => {
  process.exit(code ?? 0);
});
