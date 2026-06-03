import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/common/auth/config.js';
import { resolveAccount } from '../src/common/auth/resolver.js';
import { runWithTenant } from '../src/tenant/context.js';
import { TenantContext } from '../src/tenant/types.js';

vi.mock('../src/common/auth/config.js', async (importOriginal) => {
    const actual: any = await importOriginal();
    return {
        ...actual,
        loadConfig: vi.fn()
    };
});

const tenant: TenantContext = {
    tenantId: 'tenant-a',
    displayName: 'Tenant A',
    admin: false,
    allowedTools: ['*'],
    deniedTools: [],
    allowMutations: false,
    allowedMutatingTools: [],
    engines: {
        google: {
            accountIds: ['tenant_google'],
            allowedSites: ['sc-domain:a.example']
        }
    },
    limits: {
        maxRows: 100,
        maxBatchUrls: 10,
        requestTimeoutSeconds: 30
    },
    indexNowKeys: {}
};

describe('Tenant-aware account resolver', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(loadConfig).mockResolvedValue({
            accounts: {
                tenant_google: {
                    id: 'tenant_google',
                    engine: 'google',
                    alias: 'Tenant Google',
                    websites: ['sc-domain:a.example']
                },
                global_google: {
                    id: 'global_google',
                    engine: 'google',
                    alias: 'Global Google'
                },
                other_tenant_google: {
                    id: 'other_tenant_google',
                    engine: 'google',
                    alias: 'Other Google',
                    websites: ['sc-domain:b.example']
                }
            }
        });
    });

    it('does not fall back to global accounts inside tenant context', async () => {
        await expect(runWithTenant(tenant, () => resolveAccount('sc-domain:b.example', 'google')))
            .rejects.toThrow('site is not allowed');
    });

    it('resolves tenant-authorized accounts inside tenant context', async () => {
        await expect(runWithTenant(tenant, () => resolveAccount('sc-domain:a.example', 'google')))
            .resolves.toMatchObject({ id: 'tenant_google' });
    });

    it('preserves legacy global fallback outside tenant context', async () => {
        await expect(resolveAccount('sc-domain:unknown.example', 'google'))
            .resolves.toMatchObject({ id: 'global_google' });
    });
});
