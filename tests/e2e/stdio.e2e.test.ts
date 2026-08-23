import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

/**
 * E2E: spawn dist/index.js as a child process and speak MCP over stdio.
 * Runs isolated (throwaway HOME/cwd, no credentials, no network).
 */

const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8'));
const SERVER_ENTRY = resolve(__dirname, '../../dist/index.js');

const CORE_TOOLS = [
  'get_started',
  'sites_list',
  'sites_manage',
  'accounts_manage',
  'sitemaps_list',
  'sitemaps_submit',
  'sitemaps_delete',
  'analytics_query',
  'analytics_compare',
  'analytics_anomalies',
  'analytics_advanced',
  'inspection_inspect',
  'pagespeed_analyze',
  'indexing_submit',
  'indexing_status',
  'seo_audit',
  'seo_keywords_research',
  'schema_validate',
  'site_health_check',
  'compare_engines',
  'diagnostics',
];

let tmpHome: string;
let transport: StdioClientTransport;
let client: Client;

function buildChildEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (/^(GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_CLIENT_EMAIL|GOOGLE_PRIVATE_KEY|BING_API_KEY|PAGESPEED_API_KEY|GA4_|ADSENSE_)/.test(key)) continue;
    env[key] = value;
  }
  env.HOME = tmpHome;
  env.USERPROFILE = tmpHome;
  return env;
}

async function startServer(): Promise<void> {
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_ENTRY],
    cwd: tmpHome,
    env: buildChildEnv(),
    stderr: 'pipe',
  });
  // Drain stderr so the child never blocks on a full pipe
  const stderrStream = transport.stderr;
  stderrStream?.on('data', () => {});

  client = new Client({ name: 'search-console-mcp-e2e', version: '1.0.0' });
  await client.connect(transport);
}

describe('E2E: search-console-mcp binary over stdio', () => {
  beforeAll(async () => {
    if (!existsSync(SERVER_ENTRY)) {
      throw new Error(`Built server not found at ${SERVER_ENTRY}. Run "pnpm build" first.`);
    }
    tmpHome = mkdtempSync(join(tmpdir(), 'scmcp-e2e-'));
    // Pre-seed the update cache so no network calls happen
    writeFileSync(
      join(tmpHome, '.search-console-mcp-update-cache.json'),
      JSON.stringify({ lastCheck: Date.now(), latestVersion: pkg.version }),
      'utf8'
    );
    await startServer();
  }, 30000);

  afterAll(async () => {
    try {
      await client?.close();
    } catch {
      // ignore
    }
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  });

  it('completes the MCP initialize handshake with correct identity', async () => {
    const serverInfo = client.getServerVersion();
    expect(serverInfo).toBeDefined();
    expect(serverInfo!.name).toBe('search-console-mcp');
    expect(serverInfo!.version).toBe(pkg.version);

    const capabilities = client.getServerCapabilities();
    expect(capabilities?.tools).toBeDefined();
    expect(capabilities?.prompts).toBeDefined();
    expect(capabilities?.resources).toBeDefined();
  });

  it('exposes all core tools via tools/list with valid schemas', async () => {
    const { tools } = await client.listTools();
    const names = tools.map(t => t.name);

    for (const expected of CORE_TOOLS) {
      expect(names, `missing tool: ${expected}`).toContain(expected);
    }

    for (const tool of tools) {
      expect(tool.description, `tool ${tool.name} lacks description`).toBeTruthy();
      expect(tool.inputSchema, `tool ${tool.name} lacks inputSchema`).toEqual(
        expect.objectContaining({ type: 'object' })
      );
    }
  });

  it('lists prompts and resources', async () => {
    const prompts = await client.listPrompts();
    expect(prompts.prompts.length).toBeGreaterThan(0);

    const resources = await client.listResources();
    expect(Array.isArray(resources.resources)).toBe(true);
  });

  it('returns a capability map from get_started without any credentials', async () => {
    const result = await client.callTool({ name: 'get_started', arguments: {} });
    expect(result.isError).toBeFalsy();

    const text = (result.content as any)[0].text;
    const payload = JSON.parse(text);
    expect(payload.server_summary).toBeTruthy();
    expect(payload.active_platforms).toEqual({});
    expect(Array.isArray(payload.intent_groups)).toBe(true);
    expect(payload.workflow_chains.length).toBeGreaterThan(0);
  });

  it('returns an empty account list from accounts_manage when unconfigured', async () => {
    const result = await client.callTool({
      name: 'accounts_manage',
      arguments: { action: 'list' },
    });
    expect(result.isError).toBeFalsy();
    const accounts = JSON.parse((result.content as any)[0].text);
    expect(accounts).toEqual([]);
  });

  it('degrades gracefully on data tools when unconfigured (per-engine errors)', async () => {
    const result = await client.callTool({ name: 'sites_list', arguments: {} });
    expect(result.isError).toBeFalsy();

    const payload = JSON.parse((result.content as any)[0].text);
    expect(payload.google).toEqual(
      expect.objectContaining({ error: expect.any(String) })
    );
    expect(payload.bing).toEqual(
      expect.objectContaining({ error: expect.any(String) })
    );
  });

  it('returns a structured error envelope from tools that throw directly', async () => {
    const result = await client.callTool({
      name: 'seo_keywords_research',
      arguments: { keywords: ['test'], type: 'traffic' },
    });
    expect(result.isError).toBe(true);
    expect((result.content as any)[0].text).toContain('siteUrl is required');
  });

  it('rejects schema-invalid tool arguments without crashing the server', async () => {
    const result = await client.callTool({
      name: 'analytics_query',
      arguments: { rowLimit: 'not-a-number' },
    });
    expect(result.isError).toBe(true);
    const ping = await client.ping();
    expect(ping).toBeDefined();
  });

  it('reports unknown tool names as tool errors without crashing the server', async () => {
    const result = await client.callTool({ name: 'totally_not_a_tool', arguments: {} });
    expect(result.isError).toBe(true);
    expect((result.content as any)[0].text).toMatch(/not found/i);
    const pong = await client.ping();
    expect(pong).toBeDefined();
  });

  it('answers ping requests mid-session', async () => {
    const pong = await client.ping();
    expect(pong).toBeDefined();
  });
});
