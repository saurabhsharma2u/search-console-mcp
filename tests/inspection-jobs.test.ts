import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
        expect(page.pagination).toMatchObject({ offset: 1, limit: 1, returned: 1, total: 2, hasMore: false });
        expect(page.results).toHaveLength(1);
        const capped = getInspectionBatchJobResults(tenant, started.jobId, { limit: 5000 });
        expect(capped.pagination.limit).toBe(1000);
        expect(() => getInspectionBatchJobStatus(otherTenant, started.jobId)).toThrow('job is not allowed');
    });

    it('uses a bounded default results page for large jobs', async () => {
        const urls = Array.from({ length: 105 }, (_, index) => `not-a-url-${index}`);
        const started = startInspectionBatchJob({
            siteUrl: 'sc-domain:a.example',
            urls,
            tenant,
            cacheMode: 'read_only',
            maxApiCallsPerRun: 0
        });
        await waitForJob(started.jobId, 'completed');

        const firstPage = getInspectionBatchJobResults(tenant, started.jobId);
        expect(firstPage.pagination).toMatchObject({
            offset: 0,
            limit: 100,
            returned: 100,
            total: 105,
            hasMore: true
        });
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

    it('cleans up expired terminal jobs before new jobs are started', async () => {
        const started = startInspectionBatchJob({
            siteUrl: 'sc-domain:a.example',
            urls: ['not-a-url'],
            tenant,
            cacheMode: 'read_only',
            maxApiCallsPerRun: 0
        });
        await waitForJob(started.jobId, 'completed');

        const jobFile = findJobFile(started.jobId);
        const job = JSON.parse(readFileSync(jobFile, 'utf8'));
        job.expiresAt = '2000-01-01T00:00:00.000Z';
        writeFileSync(jobFile, `${JSON.stringify(job, null, 2)}\n`);

        startInspectionBatchJob({
            siteUrl: 'sc-domain:a.example',
            urls: [],
            tenant,
            cacheMode: 'read_only',
            maxApiCallsPerRun: 0
        });

        expect(() => getInspectionBatchJobStatus(tenant, started.jobId)).toThrow('not found');
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

function findJobFile(jobId: string) {
    const files = readdirSync(join(tempInspectionDir(), 'jobs'));
    const jobFile = files.find(file => file === `${jobId}.json`);
    if (!jobFile) throw new Error(`Job file not found for ${jobId}`);
    return join(tempInspectionDir(), 'jobs', jobFile);
}

function tempInspectionDir() {
    const dir = process.env.MCP_INSPECTION_CACHE_DIR;
    if (!dir) throw new Error('MCP_INSPECTION_CACHE_DIR is not set');
    return dir;
}
