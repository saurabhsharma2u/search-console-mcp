import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
    appendTokenRecord,
    createTokenRecord,
    hashBearerToken,
    resetTenantRegistryCache,
    resolveBearerToken
} from '../src/tenant/registry.js';

describe('Tenant registry', () => {
    const originalEnv = { ...process.env };
    let tempDir: string | undefined;

    afterEach(() => {
        process.env = { ...originalEnv };
        resetTenantRegistryCache();
        if (tempDir) rmSync(tempDir, { recursive: true, force: true });
        tempDir = undefined;
    });

    function setupRegistry() {
        tempDir = mkdtempSync(join(tmpdir(), 'scmcp-tenants-'));
        const tenantsDir = join(tempDir, 'tenants');
        const tokensPath = join(tempDir, 'tokens', 'tokens.json');
        mkdirSync(tenantsDir, { recursive: true });
        mkdirSync(join(tempDir, 'tokens'), { recursive: true });

        process.env.MCP_TENANTS_DIR = tenantsDir;
        process.env.MCP_TOKEN_REGISTRY = tokensPath;

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
            allowed_tools: ['analytics_*'],
            limits: {
                max_rows: 100,
                max_batch_urls: 5,
                request_timeout_seconds: 30
            }
        }));

        return { tokensPath };
    }

    it('stores only token hashes and resolves enabled tokens to tenants', () => {
        const { tokensPath } = setupRegistry();
        const record = createTokenRecord('tenant-a', 'primary', 'tenant-a-primary');
        writeFileSync(tokensPath, JSON.stringify({ tokens: [record.record] }));

        const resolved = resolveBearerToken(record.plaintext);

        expect(resolved.token.token_id).toBe('tenant-a-primary');
        expect(resolved.tenant.tenantId).toBe('tenant-a');
        expect(record.record.token_hash).toBe(hashBearerToken(record.plaintext));
        expect(readFileSync(tokensPath, 'utf8')).not.toContain(record.plaintext);
    });

    it('rejects unknown and disabled tokens', () => {
        const { tokensPath } = setupRegistry();
        const record = createTokenRecord('tenant-a', 'disabled', 'tenant-a-disabled');
        writeFileSync(tokensPath, JSON.stringify({
            tokens: [{ ...record.record, enabled: false }]
        }));

        expect(() => resolveBearerToken('unknown')).toThrow('Invalid or disabled bearer token');
        expect(() => resolveBearerToken(record.plaintext)).toThrow('Invalid or disabled bearer token');
    });

    it('appends token records without writing plaintext tokens', () => {
        const { tokensPath } = setupRegistry();
        const { plaintext, record } = createTokenRecord('tenant-a', 'created');

        appendTokenRecord(record);

        const saved = readFileSync(tokensPath, 'utf8');
        expect(saved).toContain(record.token_hash);
        expect(saved).not.toContain(plaintext);
    });
});
