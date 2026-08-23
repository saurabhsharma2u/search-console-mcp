import { describe, it, expect, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import http from 'http';
import { resolve } from 'path';
import { existsSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * E2E for the remote HTTP/SSE transport of the real built binary
 * (`dist/index.js serve --transport=sse`). Verifies the shipped server,
 * not a test-local McpServer instance (that lives in http-transport-spec.test.ts).
 */

const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8'));
const SERVER_ENTRY = resolve(__dirname, '../../dist/index.js');

const PORT = 39000 + Math.floor(Math.random() * 1000);
let child: ChildProcess | undefined;
let tmpHome: string;

function get(path: string): Promise<{ status: number; body: any; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolveReq, reject) => {
    const req = http.get(`http://127.0.0.1:${PORT}${path}`, (res) => {
      let raw = '';
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        let body: any = raw;
        try {
          body = JSON.parse(raw);
        } catch {
          // keep raw string (SSE streams)
        }
        resolveReq({ status: res.statusCode || 500, body, headers: res.headers });
      });
    });
    req.on('error', reject);
  });
}

async function waitForServer(timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await get('/health');
      if (res.status === 200) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`SSE server did not become healthy on port ${PORT}`);
}

describe.skipIf(process.platform === 'win32')('E2E: built server in SSE mode', () => {
  afterAll(() => {
    child?.kill('SIGTERM');
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  });

  it('boots via CLI arg, reports healthy, and rejects unauthenticated message posts', async () => {
    if (!existsSync(SERVER_ENTRY)) {
      throw new Error(`Built server not found at ${SERVER_ENTRY}. Run "pnpm build" first.`);
    }
    tmpHome = mkdtempSync(join(tmpdir(), 'scmcp-e2e-sse-'));
    writeFileSync(
      join(tmpHome, '.search-console-mcp-update-cache.json'),
      JSON.stringify({ lastCheck: Date.now(), latestVersion: pkg.version }),
      'utf8'
    );

    child = spawn(process.execPath, [SERVER_ENTRY, 'serve', '--transport=sse', `--port=${PORT}`], {
      cwd: tmpHome,
      stdio: 'ignore',
      env: {
        ...process.env,
        HOME: tmpHome,
        USERPROFILE: tmpHome,
        BING_API_KEY: '',
        GOOGLE_APPLICATION_CREDENTIALS: '',
        GOOGLE_CLIENT_EMAIL: '',
        GOOGLE_PRIVATE_KEY: '',
      },
    });
    child.on('error', () => {});

    await waitForServer();

    const health = await get('/health');
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('ok');
    expect(health.body).toHaveProperty('activeConnections');

    // POST /messages without a valid sessionId must be rejected
    const postStatus = await new Promise<number>((resolvePost) => {
      const req = http.request(
        `http://127.0.0.1:${PORT}/messages?sessionId=bogus-session`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } },
        (res) => resolvePost(res.statusCode || 500)
      );
      req.write(JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }));
      req.end();
    });
    expect(postStatus).toBeGreaterThanOrEqual(400);
    expect(postStatus).toBeLessThan(500);
  }, 30000);
});
