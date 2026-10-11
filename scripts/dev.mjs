#!/usr/bin/env node
// Runs the FastAPI backend and the Vite frontend together with prefixed logs.
// The Vite dev server proxies /generate-code (WebSocket), /api and
// /local-assets to the backend, so the browser only ever talks to one origin.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
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

function isPortFree(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(Number(port), host);
  });
}

function freePort(port) {
  // A previous dev run can leave an orphaned uvicorn reloader holding the port.
  spawnSync("fuser", ["-k", "-TERM", `${port}/tcp`], { stdio: "ignore" });
  spawnSync("sh", ["-c", `lsof -ti tcp:${port} | xargs -r kill -TERM`], { stdio: "ignore" });
}

async function ensurePortAvailable(port, host) {
  if (await isPortFree(port, host)) return;
  console.log(
    `${colors.backend}[backend]${colors.reset} Port ${port} is busy (likely a stale dev process). Freeing it...`,
  );
  freePort(port);
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await isPortFree(port, host)) return;
  }
  console.error(
    `${colors.backend}[backend]${colors.reset} Port ${port} is still in use. Stop the process using it or set BACKEND_PORT.`,
  );
  process.exit(1);
}

const children = [];
let shuttingDown = false;

function killTree(child, signal) {
  try {
    // Children run in their own process group, so this also reaches
    // grandchildren such as uvicorn's reloader worker.
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

function run(name, command, args, options) {
  const child = spawn(command, args, {
    ...options,
    env: { ...process.env, FORCE_COLOR: "1", ...options.env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
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
  for (const child of children) killTree(child, "SIGTERM");
  setTimeout(() => {
    for (const child of children) killTree(child, "SIGKILL");
    process.exit(exitCode);
  }, 3000);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("SIGHUP", () => shutdown(0));
process.on("exit", () => {
  for (const child of children) killTree(child, "SIGKILL");
});

if (only !== "frontend") {
  const poetry = findPoetry();
  if (!poetry) {
    console.error(
      "Poetry was not found. Run `pnpm bootstrap` (or `bash scripts/setup.sh`) to install the backend toolchain.",
    );
    process.exit(1);
  }
  if (!existsSync(path.join(backendDir, ".env"))) {
    console.log(
      `${colors.backend}[backend]${colors.reset} Note: no backend/.env found. Copy backend/.env.example and add an LLM key, or set keys in the in-app Settings dialog.`,
    );
  }
  await ensurePortAvailable(backendPort, backendHost);
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
