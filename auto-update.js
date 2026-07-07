#!/usr/bin/env node
import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Helper to log to stderr so we don't break MCP stdout protocol
function log(msg) {
  console.error(`[Auto-Update] ${msg}`);
}

function runCmd(cmd, options = {}) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...options });
  } catch (error) {
    log(`Failed to run command "${cmd}": ${error.message}`);
    if (error.stderr) log(error.stderr);
    return null;
  }
}

function updateAndStart() {
  const cwd = __dirname;
  log("Checking for updates...");

  // Check if we are in a git repository
  const gitStatus = runCmd("git status --porcelain", { cwd });
  if (gitStatus === null) {
    log("Not a git repository or git is not installed. Skipping update.");
    startServer();
    return;
  }

  const hasLocalChanges = gitStatus.trim().length > 0;
  let stashed = false;

  if (hasLocalChanges) {
    log("Stashing local changes...");
    const stashResult = runCmd("git stash", { cwd });
    if (stashResult && !stashResult.includes("No local changes to save")) {
      stashed = true;
    }
  }

  // Get current commit hash
  const beforeCommit = runCmd("git rev-parse HEAD", { cwd })?.trim();

  log("Pulling latest changes...");
  const pullResult = runCmd("git pull", { cwd });

  // Get new commit hash
  const afterCommit = runCmd("git rev-parse HEAD", { cwd })?.trim();

  let updated = beforeCommit !== afterCommit;

  if (updated) {
    log("New changes pulled! Rebuilding project...");
    // Run install and build
    runCmd("pnpm install", { cwd, stdio: ['ignore', 'inherit', 'inherit'] });
    runCmd("pnpm build", { cwd, stdio: ['ignore', 'inherit', 'inherit'] });
    log("Update and rebuild complete.");
  } else {
    log("Already up to date.");
  }

  if (stashed) {
    log("Restoring local changes...");
    runCmd("git stash pop", { cwd });
  }

  startServer();
}

function startServer() {
  const args = process.argv.slice(2);
  const serverPath = join(__dirname, 'dist', 'index.js');
  
  // Forward all args, stdin, stdout, and stderr to the child process
  const child = spawn('node', [serverPath, ...args], {
    stdio: 'inherit'
  });

  child.on('close', (code) => {
    process.exit(code ?? 0);
  });

  child.on('error', (err) => {
    log(`Failed to start server: ${err.message}`);
    process.exit(1);
  });
}

updateAndStart();
