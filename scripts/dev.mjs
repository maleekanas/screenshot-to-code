#!/usr/bin/env node
// Runs the FastAPI backend and the Vite frontend together with prefixed logs.
// The Vite dev server proxies /generate-code (WebSocket), /api and
// /local-assets to the backend, so the browser only ever talks to one origin.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backendDir = path.join(repoRoot, "backend");
const frontendDir = path.join(repoRoot, "frontend");

const backendPort = process.env.BACKEND_PORT || "7001";
const backendHost = process.env.BACKEND_HOST || "127.0.0.1";
const only = process.argv[2]; // "frontend" | "backend" | undefined

const colors = { backend: "\x1b[35m", frontend: "\x1b[36m", reset: "\x1b[0m" };

function findPoetry() {
  const candidates = [
    process.env.POETRY_BIN,
    "poetry",
    path.join(homedir(), ".local", "bin", "poetry"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (result.status === 0) return candidate;
  }
  return null;
}

function prefixStream(stream, name, target) {
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      target.write(`${colors[name]}[${name}]${colors.reset} ${line}\n`);
    }
  });
  stream.on("end", () => {
    if (buffer) target.write(`${colors[name]}[${name}]${colors.reset} ${buffer}\n`);
  });
}

const children = [];
let shuttingDown = false;

function run(name, command, args, options) {
  const child = spawn(command, args, {
    ...options,
    env: { ...process.env, FORCE_COLOR: "1", ...options.env },
    stdio: ["inherit", "pipe", "pipe"],
  });
  prefixStream(child.stdout, name, process.stdout);
  prefixStream(child.stderr, name, process.stderr);
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(
      `${colors[name]}[${name}]${colors.reset} exited (${signal ?? `code ${code}`}). Stopping all processes.`,
    );
    shutdown(code ?? 1);
  });
  children.push(child);
  return child;
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(exitCode), 1500).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

if (only !== "frontend") {
  const poetry = findPoetry();
  if (!poetry) {
    console.error(
      "Poetry was not found. Run `pnpm bootstrap` (or `bash scripts/setup.sh`) to install the backend toolchain.",
    );
    process.exit(1);
  }
  if (!existsSync(path.join(backendDir, ".env"))) {
    console.warn(
      `${colors.backend}[backend]${colors.reset} No backend/.env found. Copy backend/.env.example and add at least one LLM key, or set keys in the in-app Settings dialog.`,
    );
  }
  run(
    "backend",
    poetry,
    ["run", "uvicorn", "main:app", "--reload", "--host", backendHost, "--port", backendPort],
    { cwd: backendDir, env: {} },
  );
}

if (only !== "backend") {
  run("frontend", "pnpm", ["exec", "vite", "--host", "0.0.0.0"], {
    cwd: frontendDir,
    env: { PROXY_CODEGEN_BACKEND: `http://127.0.0.1:${backendPort}` },
  });
}
