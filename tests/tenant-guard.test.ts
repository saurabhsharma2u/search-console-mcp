import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TenantContext } from '../src/tenant/types.js';
import {
    assertBatchUrlsAllowed,
    assertGa4PropertyAllowed,
    assertGoogleSiteAllowed,
    assertSitemapBelongsToAllowedSite,
    assertToolAllowed,
    assertUrlBelongsToAllowedSite,
    guardToolArguments,
    resolveTenantAccount,
    tenantSitesList
} from '../src/tenant/guard.js';
import { loadConfig } from '../src/common/auth/config.js';

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
    allowedTools: ['analytics_*', 'inspection_*', 'sites_list', 'schema_validate', 'pagespeed_*', 'bing_index_now'],
    deniedTools: ['sites_delete'],
    allowMutations: false,
    allowedMutatingTools: [],
    engines: {
        google: {
            accountIds: ['google_a'],
            allowedSites: ['sc-domain:a.example'],
            defaultSite: 'sc-domain:a.example'
        },
        bing: {
            accountIds: ['bing_a'],
            allowedSites: ['https://www.a.example/']
        },
        ga4: {
            accountIds: ['ga4_a'],
            allowedProperties: ['12345']
        }
    },
    limits: {
        maxRows: 100,
        maxBatchUrls: 2,
        requestTimeoutSeconds: 30
    },
    indexNowKeys: {
        'www.a.example': { key: 'server-side-key' }
    }
};

describe('Tenant guard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('allows wildcard tools and rejects denied or unlisted tools', () => {
        expect(() => assertToolAllowed(tenant, 'analytics_query')).not.toThrow();
        expect(() => assertToolAllowed(tenant, 'sites_delete')).toThrow('denied');
        expect(() => assertToolAllowed(tenant, 'accounts_list')).toThrow('admin tenant');
        expect(() => assertToolAllowed(tenant, 'sitemaps_submit')).toThrow('mutating tool');
        expect(() => assertToolAllowed(tenant, 'ga4_realtime')).toThrow('not allowed');
    });

    it('enforces exact sc-domain matching with subdomain URL allowance', () => {
        expect(() => assertGoogleSiteAllowed(tenant, 'sc-domain:a.example')).not.toThrow();
        expect(() => assertUrlBelongsToAllowedSite(tenant, 'https://blog.a.example/post')).not.toThrow();
        expect(() => assertGoogleSiteAllowed(tenant, 'sc-domain:b.example')).toThrow('site is not allowed');
        expect(() => assertUrlBelongsToAllowedSite(tenant, 'https://b.example/post')).toThrow('URL is not allowed');
    });

    it('enforces GA4 properties, sitemap URLs, and batch limits', () => {
        expect(() => assertGa4PropertyAllowed(tenant, '12345')).not.toThrow();
        expect(() => assertGa4PropertyAllowed(tenant, '99999')).toThrow('GA4 property is not allowed');
        expect(() => assertSitemapBelongsToAllowedSite(tenant, 'https://www.a.example/sitemap.xml')).not.toThrow();
        expect(() => assertSitemapBelongsToAllowedSite(tenant, 'https://b.example/sitemap.xml')).toThrow('URL is not allowed');
        expect(() => assertBatchUrlsAllowed(tenant, [
            'https://www.a.example/one',
            'https://www.a.example/two',
            'https://www.a.example/three'
        ])).toThrow('batch URL limit exceeded');
    });

    it('filters sites_list to tenant-authorized sites only', async () => {
        await expect(tenantSitesList(tenant, 'google')).resolves.toEqual([
            { tenant: 'tenant-a', engine: 'google', sites: ['sc-domain:a.example'] }
        ]);
    });

    it('resolves accounts only from tenant account IDs', async () => {
        vi.mocked(loadConfig).mockResolvedValue({
            accounts: {
                google_a: {
                    id: 'google_a',
                    engine: 'google',
                    alias: 'tenant-a',
                    websites: ['sc-domain:a.example']
                },
                google_b: {
                    id: 'google_b',
                    engine: 'google',
                    alias: 'tenant-b',
                    websites: ['sc-domain:b.example']
                }
            }
        });

        await expect(resolveTenantAccount(tenant, 'sc-domain:a.example', 'google')).resolves.toMatchObject({
            id: 'google_a'
        });
        await expect(resolveTenantAccount(tenant, 'sc-domain:b.example', 'google')).rejects.toThrow('site is not allowed');
    });

    it('guards tenant URLs before schema and IndexNow tool execution', () => {
        const mutationTenant = {
            ...tenant,
            allowMutations: true,
            allowedMutatingTools: ['bing_index_now']
        };

        expect(() => guardToolArguments(tenant, 'schema_validate', {
            type: 'url',
            data: 'https://www.a.example/page'
        })).not.toThrow();
        expect(() => guardToolArguments(tenant, 'schema_validate', {
            type: 'url',
            data: 'https://b.example/page'
        })).toThrow('URL is not allowed');
        expect(() => guardToolArguments(mutationTenant, 'bing_index_now', {
            host: 'www.a.example',
            key: 'client-supplied-key',
            urlList: ['https://www.a.example/post']
        })).toThrow('IndexNow key must be configured server-side');
        expect(() => guardToolArguments(mutationTenant, 'bing_index_now', {
            host: 'www.a.example',
            urlList: ['https://other.a.example/post']
        })).toThrow('IndexNow URL host does not match');
    });
});
