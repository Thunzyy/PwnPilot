import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const vitestEntry = path.resolve(scriptDir, "../node_modules/vitest/vitest.mjs");
const vitestArgs = ["run", ...process.argv.slice(2)];

// Node 25 emits noisy --localstorage-file warnings in Vitest workers on Windows.
// Keep Node runtime warnings muted for the test runner while preserving test stderr.
const child = spawn(process.execPath, [vitestEntry, ...vitestArgs], {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_NO_WARNINGS: process.env.NODE_NO_WARNINGS ?? "1",
  },
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
