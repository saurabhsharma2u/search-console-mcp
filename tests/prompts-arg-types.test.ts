import { describe, it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerPrompts } from '../src/prompts/index.js';

// Hermetic: the find_quick_wins Google branch depends on platform detection,
// which reads real credential files/env on the host. Pin it so CI (no local
// Google config) takes the same path as dev machines.
vi.mock('../src/common/platforms.js', () => ({
  getEnabledPlatforms: async () => ({
    isGoogleEnabled: true,
    isBingEnabled: false,
    isGA4Enabled: false,
    isAdSenseEnabled: false,
  }),
}));

/**
 * Regression test for issue #112.
 *
 * MCP clients send prompt arguments as strings — per spec, prompts/get
 * arguments are Record<string, string>. Declaring `min_impressions` as
 * z.number() made every numeric use of `find_quick_wins` fail with -32602,
 * and even a real JS number failed at the protocol layer (-32603). The fix
 * declares the argument as z.string() and coerces inside the prompt body.
 */

async function makePromptServer(): Promise<Client> {
  const server = new McpServer({ name: 'repro-server', version: '2.1.4' });
  registerPrompts(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'repro-client', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe('find_quick_wins prompt argument typing (issue #112)', () => {
  it('accepts min_impressions sent the way MCP clients must send it: as a string', async () => {
    const client = await makePromptServer();
    const result = await client.getPrompt({
      name: 'find_quick_wins',
      arguments: { site_url: 'https://example.com', min_impressions: '500', date_range: 'last 90 days' },
    });

    const text = (result.messages[0].content as any).text;
    expect(text).toContain('minImpressions=500');
    expect(text).toContain('minimum 500 impressions');
    client.close();
  });

  it('defaults to 1000 when min_impressions is omitted', async () => {
    const client = await makePromptServer();
    const result = await client.getPrompt({
      name: 'find_quick_wins',
      arguments: { site_url: 'https://example.com' },
    });

    const text = (result.messages[0].content as any).text;
    expect(text).toContain('minImpressions=1000');
    expect(text).toContain('minimum 1000 impressions');
    client.close();
  });

  it('garbage input (not a numeric string) falls back to the default instead of erroring', async () => {
    const client = await makePromptServer();
    const result = await client.getPrompt({
      name: 'find_quick_wins',
      arguments: { site_url: 'https://example.com', min_impressions: 'not-a-number' },
    });

    const text = (result.messages[0].content as any).text;
    expect(text).toContain('minImpressions=1000');
    client.close();
  });

  it('schema advertising stays type-agnostic as the protocol expects', async () => {
    const client = await makePromptServer();
    const { prompts } = await client.listPrompts();
    const quickWins = prompts.find((p: any) => p.name === 'find_quick_wins');
    const arg = (quickWins as any).arguments.find((a: any) => a.name === 'min_impressions');
    expect(arg.required).toBe(false);
    client.close();
  });
});
