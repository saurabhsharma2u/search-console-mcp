import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TenantContext } from '../src/tenant/types.js';
import {
    getInspectionCacheStats,
    normalizeInspectionResponse,
    readFreshInspectionCache
} from '../src/google/tools/inspection-cache.js';
import {
    inspectBatchWithCache,
    inspectUrlNormalized
} from '../src/google/tools/inspection.js';
import { getSearchConsoleClient } from '../src/google/client.js';

vi.mock('../src/google/client.js', () => ({
    getSearchConsoleClient: vi.fn()
}));

const tenant: TenantContext = {
    tenantId: 'tenant-a',
    displayName: 'Tenant A',
    admin: false,
    allowedTools: ['inspection_*'],
    deniedTools: [],
    allowMutations: false,
    allowedMutatingTools: [],
    engines: {
        google: {
            accountIds: ['google_a'],
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

const rawInspection = {
    inspectionResult: {
        inspectionResultLink: 'https://search.google.com/search-console/inspect',
        indexStatusResult: {
            verdict: 'PASS',
            coverageState: 'Submitted and indexed',
            indexingState: 'INDEXING_ALLOWED',
            lastCrawlTime: '2026-05-25T10:00:00Z',
            pageFetchState: 'SUCCESSFUL',
            robotsTxtState: 'ALLOWED',
            googleCanonical: 'https://a.example/page',
            userCanonical: 'https://a.example/page',
            referringUrls: ['https://a.example/'],
            sitemap: ['https://a.example/sitemap.xml']
        }
    }
};

describe('URL Inspection cache layer', () => {
    let tempDir: string;
    let inspectMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'inspection-cache-'));
        process.env.MCP_INSPECTION_CACHE_DIR = tempDir;
        inspectMock = vi.fn().mockResolvedValue({ data: rawInspection });
        vi.mocked(getSearchConsoleClient).mockResolvedValue({
            urlInspection: {
                index: {
                    inspect: inspectMock
                }
            }
        } as any);
    });

    afterEach(() => {
        delete process.env.MCP_INSPECTION_CACHE_DIR;
        rmSync(tempDir, { recursive: true, force: true });
        vi.clearAllMocks();
    });

    it('normalizes URL Inspection raw payload while keeping raw data', () => {
        const normalized = normalizeInspectionResponse('sc-domain:a.example', 'https://a.example/page', rawInspection as any);

        expect(normalized).toMatchObject({
            inspectionUrl: 'https://a.example/page',
            siteUrl: 'sc-domain:a.example',
            verdict: 'PASS',
            coverageState: 'Submitted and indexed',
            indexingState: 'INDEXING_ALLOWED',
            lastCrawlTime: '2026-05-25T10:00:00Z',
            pageFetchState: 'SUCCESSFUL',
            robotsTxtState: 'ALLOWED',
            googleCanonical: 'https://a.example/page',
            userCanonical: 'https://a.example/page',
            referringUrls: ['https://a.example/'],
            sitemap: ['https://a.example/sitemap.xml'],
            inspectionResultLink: 'https://search.google.com/search-console/inspect',
            raw: rawInspection
        });
    });

    it('uses a fresh cache hit without calling Google again', async () => {
        const first = await inspectUrlNormalized('sc-domain:a.example', 'https://a.example/page', 'en-US', tenant);
        expect(first.metadata).toMatchObject({ cacheHit: false, apiCallMade: true, quotaUnitEstimate: 1 });

        const second = await inspectUrlNormalized('sc-domain:a.example', 'https://a.example/page', 'en-US', tenant);
        expect(second.metadata).toMatchObject({ cacheHit: true, apiCallMade: false, quotaUnitEstimate: 0 });
        expect(inspectMock).toHaveBeenCalledTimes(1);

        const cached = readFreshInspectionCache('tenant-a', 'sc-domain:a.example', 'https://a.example/page');
        expect(cached?.entry.normalized?.coverageState).toBe('Submitted and indexed');
    });

    it('returns partial batch statuses for API errors and quota limits', async () => {
        inspectMock
            .mockResolvedValueOnce({ data: rawInspection })
            .mockRejectedValueOnce(new Error('Google quota exhausted'));

        const result = await inspectBatchWithCache('sc-domain:a.example', [
            'https://a.example/one',
            'https://a.example/two',
            'https://a.example/three'
        ], tenant, {
            forceRefresh: true,
            maxApiCallsPerRun: 2
        });

        expect(result.summary).toMatchObject({
            requested: 3,
            apiCallsMade: 2,
            errors: 1,
            quotaLimited: 1,
            quotaUnitEstimate: 2
        });
        expect(result.results.map((row: any) => row.status)).toEqual(['ok', 'error', 'quota_limited']);
    });

    it('reports cache stats for Paperclip consumers', async () => {
        await inspectUrlNormalized('sc-domain:a.example', 'https://a.example/page', 'en-US', tenant);
        await inspectUrlNormalized('sc-domain:a.example', 'https://a.example/page', 'en-US', tenant);

        const stats = getInspectionCacheStats(tenant, { siteUrl: 'sc-domain:a.example' });
        expect(stats).toMatchObject({
            tenantId: 'tenant-a',
            siteUrl: 'sc-domain:a.example',
            totalRequests: 2,
            cacheHits: 1,
            apiCalls: 1,
            errors: 0,
            quotaUnitEstimate: 1
        });
    });
});
