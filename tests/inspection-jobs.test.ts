import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TenantContext } from '../src/tenant/types.js';
import { getSearchConsoleClient } from '../src/google/client.js';
import {
    cancelInspectionBatchJob,
    getInspectionBatchJobResults,
    getInspectionBatchJobStatus,
    startInspectionBatchJob
} from '../src/google/tools/inspection-jobs.js';

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
        maxBatchUrls: 2,
        requestTimeoutSeconds: 30
    },
    indexNowKeys: {}
};

const otherTenant = {
    ...tenant,
    tenantId: 'tenant-b'
};

const rawInspection = {
    inspectionResult: {
        inspectionResultLink: 'https://search.google.com/search-console/inspect',
        indexStatusResult: {
            verdict: 'PASS',
            coverageState: 'Submitted and indexed',
            indexingState: 'INDEXING_ALLOWED',
            pageFetchState: 'SUCCESSFUL',
            robotsTxtState: 'ALLOWED'
        }
    }
};

describe('URL Inspection async jobs', () => {
    let tempDir: string;
    let inspectMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'inspection-jobs-'));
        process.env.MCP_INSPECTION_CACHE_DIR = tempDir;
        process.env.MCP_INSPECTION_JOB_CHUNK_SIZE = '1';
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
        delete process.env.MCP_INSPECTION_JOB_CHUNK_SIZE;
        rmSync(tempDir, { recursive: true, force: true });
        vi.clearAllMocks();
    });

    it('starts and completes an async batch job with partial per-URL statuses', async () => {
        const started = startInspectionBatchJob({
            siteUrl: 'sc-domain:a.example',
            urls: [
                'not-a-url',
                'https://b.example/blocked',
                'https://a.example/one',
                'https://a.example/two'
            ],
            tenant,
            cacheMode: 'bypass',
            maxApiCallsPerRun: 1
        });

        const status = await waitForJob(started.jobId, 'completed');
        expect(status.summary).toMatchObject({
            requested: 4,
            returned: 4,
            invalidUrls: 1,
            forbiddenUrls: 1,
            apiCallsMade: 1,
            quotaLimited: 1,
            quotaUnitEstimate: 1
        });

        const results = getInspectionBatchJobResults(tenant, started.jobId);
        expect(results.results.map((row: any) => row.status)).toEqual([
            'invalid_url',
            'forbidden_url',
            'ok',
            'quota_limited'
        ]);
        expect(inspectMock).toHaveBeenCalledTimes(1);
    });

    it('returns paginated results and enforces tenant ownership', async () => {
        const started = startInspectionBatchJob({
            siteUrl: 'sc-domain:a.example',
            urls: ['https://a.example/one', 'https://a.example/two'],
            tenant,
            cacheMode: 'bypass',
            maxApiCallsPerRun: 2
        });
        await waitForJob(started.jobId, 'completed');

        const page = getInspectionBatchJobResults(tenant, started.jobId, { offset: 1, limit: 1 });
        expect(page.pagination).toMatchObject({ offset: 1, limit: 1, returned: 1, total: 2 });
        expect(page.results).toHaveLength(1);
        expect(() => getInspectionBatchJobStatus(otherTenant, started.jobId)).toThrow('job is not allowed');
    });

    it('cancels queued jobs before provider calls start', async () => {
        const started = startInspectionBatchJob({
            siteUrl: 'sc-domain:a.example',
            urls: ['https://a.example/one'],
            tenant,
            cacheMode: 'bypass',
            maxApiCallsPerRun: 1
        });

        const cancelled = cancelInspectionBatchJob(tenant, started.jobId);
        expect(cancelled).toMatchObject({ cancelAccepted: true, status: 'cancelled' });
        await new Promise(resolve => setTimeout(resolve, 20));
        const status = getInspectionBatchJobStatus(tenant, started.jobId);
        expect(status.status).toBe('cancelled');
        expect(inspectMock).not.toHaveBeenCalled();
    });
});

async function waitForJob(jobId: string, expectedStatus: string) {
    for (let attempt = 0; attempt < 50; attempt++) {
        const status = getInspectionBatchJobStatus(tenant, jobId);
        if (status.status === expectedStatus) return status;
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`Job ${jobId} did not reach ${expectedStatus}`);
}
