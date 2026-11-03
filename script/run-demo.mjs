#!/usr/bin/env node
/**
 * Migrate, start one demo backend, then Vite.
 * Entry: script/server
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const demoDir = path.join(repoRoot, "spec/examples/demo");

const NODE_FLAGS = ["--disable-warning=ExperimentalWarning", "--experimental-strip-types"];

export function run(argv) {
  const backend = parseBackend(argv);
  ensureDeps();
  runMigrate(backend);

  const backendProc = startBackend(backend);
  let viteProc = null;
  let exiting = false;

  function shutdown(code = 0) {
    if (exiting) return;
    exiting = true;
    if (viteProc && !viteProc.killed) viteProc.kill("SIGTERM");
    if (backendProc && !backendProc.killed) backendProc.kill("SIGTERM");
    process.exit(code);
  }

  process.on("SIGINT", () => shutdown(130));
  process.on("SIGTERM", () => shutdown(143));

  backendProc.on("exit", (code, signal) => {
    if (exiting) return;
    if (signal) shutdown(1);
    if (code && code !== 0) shutdown(code);
    shutdown(0);
  });

  viteProc = startVite();
  viteProc.on("exit", (code, signal) => {
    if (exiting) return;
    if (signal) shutdown(1);
    shutdown(code ?? 0);
  });
}

function usage() {
  console.error("Usage: script/server [--backend python|go|node]");
  console.error("  Default backend: python");
}

function parseBackend(argv) {
  let backend = "python";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    }
    if (arg === "--backend") {
      const value = argv[i + 1];
      if (!value) {
        console.error("Missing value for --backend.");
        usage();
        process.exit(1);
      }
      backend = value;
      i++;
      continue;
    }
    console.error(`Unknown argument: ${arg}`);
    usage();
    process.exit(1);
  }
  if (!["python", "go", "node"].includes(backend)) {
    console.error(`Unknown backend: ${backend}`);
    usage();
    process.exit(1);
  }
  return backend;
}

function ensureDeps() {
  if (fs.existsSync(path.join(demoDir, "node_modules", "vite"))) return;
  console.error("Run once: npm install --prefix spec/examples/demo");
  process.exit(1);
}

function runMigrate(backend) {
  let command;
  if (backend === "python") {
    command = {
      bin: "python3",
      args: ["-m", "plgkit", "migrate"],
      env: { ...process.env, PYTHONPATH: path.join(repoRoot, "packages/python") },
    };
  } else if (backend === "go") {
    command = {
      bin: "go",
      args: ["run", path.join(repoRoot, "packages/go/cmd/plgkit"), "migrate"],
      env: process.env,
    };
  } else {
    command = {
      bin: "node",
      args: [...NODE_FLAGS, path.join(repoRoot, "packages/node/src/cli.ts"), "migrate"],
      env: process.env,
    };
  }
  const result = spawnSync(command.bin, command.args, {
    cwd: demoDir,
    env: command.env,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function startBackend(backend) {
  if (backend === "python") {
    return spawn("python3", ["backends/python/server.py"], {
      cwd: demoDir,
      env: { ...process.env, PYTHONPATH: path.join(repoRoot, "packages/python") },
      stdio: "inherit",
    });
  }
  if (backend === "go") {
    return spawn("go", ["run", "./backends/go"], {
      cwd: demoDir,
      env: process.env,
      stdio: "inherit",
    });
  }
  return spawn("node", [...NODE_FLAGS, "backends/node/server.ts"], {
    cwd: demoDir,
    env: process.env,
    stdio: "inherit",
  });
}

function startVite() {
  const viteBin = path.join(demoDir, "node_modules", "vite", "bin", "vite.js");
  return spawn(process.execPath, [viteBin], {
    cwd: demoDir,
    env: process.env,
    stdio: "inherit",
  });
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(thisFile) === path.resolve(process.argv[1])) {
  run(process.argv.slice(2));
}
