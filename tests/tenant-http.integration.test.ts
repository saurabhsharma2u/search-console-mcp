import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { installTenantGuard } from '../src/tenant/tool-guard.js';
import { startHttpServer } from '../src/tenant/http.js';
import { createTokenRecord, resetTenantRegistryCache } from '../src/tenant/registry.js';

describe('Tenant HTTP integration', () => {
    const originalEnv = { ...process.env };
    let tempDir: string | undefined;
    let httpServer: Server | undefined;

    afterEach(async () => {
        process.env = { ...originalEnv };
        resetTenantRegistryCache();
        if (httpServer) {
            await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
            httpServer = undefined;
        }
        if (tempDir) rmSync(tempDir, { recursive: true, force: true });
        tempDir = undefined;
    });

    async function startTenantServer(options: { useFactory?: boolean } = {}) {
        tempDir = mkdtempSync(join(tmpdir(), 'scmcp-http-'));
        const tenantsDir = join(tempDir, 'tenants');
        const tokensDir = join(tempDir, 'tokens');
        const tokensPath = join(tokensDir, 'tokens.json');
        mkdirSync(tenantsDir, { recursive: true });
        mkdirSync(tokensDir, { recursive: true });

        const token = createTokenRecord('tenant-a', 'integration', 'tenant-a-primary');
        writeFileSync(tokensPath, JSON.stringify({ tokens: [token.record] }));
        writeFileSync(join(tenantsDir, 'tenant-a.json'), JSON.stringify({
            tenant_id: 'tenant-a',
            display_name: 'Tenant A',
            enabled: true,
            engines: {
                google: {
                    account_ids: ['google_a'],
                    allowed_sites: ['sc-domain:a.example']
                }
            },
            allowed_tools: ['echo_site', 'sites_list'],
            denied_tools: [],
            limits: {
                max_rows: 100,
                max_batch_urls: 5,
                request_timeout_seconds: 30
            }
        }));

        process.env.MCP_REQUIRE_TENANT_TOKEN = 'true';
        process.env.MCP_PRODUCTION_MODE = 'true';
        process.env.MCP_TENANTS_DIR = tenantsDir;
        process.env.MCP_TOKEN_REGISTRY = tokensPath;
        process.env.MCP_BIND_HOST = '127.0.0.1';
        process.env.MCP_PORT = '0';

        const createServer = () => {
            const server = new McpServer({ name: 'tenant-http-test', version: '1.0.0' });
            installTenantGuard(server);
            server.tool(
                'echo_site',
                'Echoes a tenant-authorized site',
                { siteUrl: z.string() },
                async ({ siteUrl }) => ({ content: [{ type: 'text', text: siteUrl }] })
            );
            server.tool(
                'sites_list',
                'Tenant-filtered sites list',
                { engine: z.enum(['google', 'bing', 'ga4']).optional() },
                async () => ({ content: [{ type: 'text', text: 'should be replaced by tenant guard' }] })
            );
            return server;
        };

        httpServer = await startHttpServer(options.useFactory ? createServer : createServer()) as Server;
        const port = (httpServer.address() as AddressInfo).port;
        return { token: token.plaintext, url: new URL(`http://127.0.0.1:${port}/mcp`) };
    }

    async function initialize(url: URL, token: string, id: number) {
        return fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'content-type': 'application/json',
                accept: 'application/json, text/event-stream'
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id,
                method: 'initialize',
                params: {
                    protocolVersion: '2025-06-18',
                    capabilities: {},
                    clientInfo: { name: `test-client-${id}`, version: '1.0.0' }
                }
            })
        });
    }

    it('requires a valid bearer token before MCP initialization', async () => {
        const { token, url } = await startTenantServer();

        const missing = await fetch(url, { method: 'POST' });
        expect(missing.status).toBe(401);
        await expect(missing.json()).resolves.toMatchObject({
            error: { message: 'Missing Authorization bearer token' }
        });

        const invalid = await fetch(url, {
            method: 'POST',
            headers: { Authorization: 'Bearer invalid-token' }
        });
        expect(invalid.status).toBe(401);
        await expect(invalid.json()).resolves.toMatchObject({
            error: { message: 'Invalid or disabled bearer token' }
        });

        const initialized = await initialize(url, token, 1);
        expect(initialized.status).toBe(200);
        await expect(initialized.json()).resolves.toMatchObject({
            result: { serverInfo: { name: 'tenant-http-test' } }
        });
    });

    it('creates a fresh MCP server for each streamable HTTP session when a factory is provided', async () => {
        const { token, url } = await startTenantServer({ useFactory: true });

        const first = await initialize(url, token, 1);
        expect(first.status).toBe(200);
        expect(first.headers.get('mcp-session-id')).toBeTruthy();
        await first.json();

        const second = await initialize(url, token, 2);
        expect(second.status).toBe(200);
        expect(second.headers.get('mcp-session-id')).toBeTruthy();
        await expect(second.json()).resolves.toMatchObject({
            result: { serverInfo: { name: 'tenant-http-test' } }
        });
    });
});
