import { describe, it, expect, beforeAll } from "vitest";
import { execSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("server bootstrap", () => {
  beforeAll(() => {
    execSync("npm run build", { cwd: projectRoot, stdio: "pipe" });
  }, 120_000);

  it("starts without duplicate prompt/tool registration errors", async () => {
    const entry = path.join(projectRoot, "dist/index.js");
    const child = spawn(process.execPath, [entry], {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1" },
    });

    let stderr = "";

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const interval = setInterval(() => {
        if (stderr.includes("is already registered")) {
          clearInterval(interval);
          clearTimeout(timeout);
          child.kill();
          reject(new Error(stderr));
          return;
        }

        if (stderr.includes("Search Console MCP running on stdio")) {
          clearInterval(interval);
          clearTimeout(timeout);
          child.kill();
          resolve();
          return;
        }

        if (Date.now() - startedAt > 10_000) {
          clearInterval(interval);
          clearTimeout(timeout);
          child.kill();
          reject(new Error(`Timed out waiting for server start. stderr: ${stderr}`));
        }
      }, 100);

      const timeout = setTimeout(() => {
        clearInterval(interval);
        child.kill();
        reject(new Error(`Timed out waiting for server start. stderr: ${stderr}`));
      }, 10_500);

      child.on("exit", (code) => {
        if (code !== null && code !== 0) {
          clearInterval(interval);
          clearTimeout(timeout);
          reject(new Error(`Process exited with code ${code}: ${stderr}`));
        }
      });
    });

    expect(stderr).toContain("Search Console MCP running on stdio");
    expect(stderr).not.toMatch(/is already registered/);
  }, 30_000);
});
