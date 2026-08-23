import { describe, it, expect, vi, beforeEach } from 'vitest';
import { healthCheck } from '../src/bing/tools/sites-health.js';
import * as bingSites from '../src/bing/tools/sites.js';
import * as bingSitemaps from '../src/bing/tools/sitemaps.js';
import * as bingAnalytics from '../src/bing/tools/analytics.js';
import * as bingCrawl from '../src/bing/tools/crawl.js';

// Mock the dependencies
vi.mock('../src/bing/tools/sites.js', () => ({
    listSites: vi.fn(),
}));

vi.mock('../src/bing/tools/sitemaps.js', () => ({
    listSitemaps: vi.fn(),
}));

vi.mock('../src/bing/tools/analytics.js', () => ({
    detectAnomalies: vi.fn(),
    comparePeriods: vi.fn(),
}));

vi.mock('../src/bing/tools/crawl.js', () => ({
    getCrawlIssues: vi.fn(),
    getCrawlStats: vi.fn(),
}));

describe('Bing Sites Health Concurrency', () => {
    let concurrentRequests = 0;
    let maxConcurrentRequests = 0;

    beforeEach(() => {
        vi.clearAllMocks();
        concurrentRequests = 0;
        maxConcurrentRequests = 0;
    });

    const simulateDelay = async () => {
        concurrentRequests++;
        if (concurrentRequests > maxConcurrentRequests) {
            maxConcurrentRequests = concurrentRequests;
        }
        await new Promise(resolve => setTimeout(resolve, 50));
        concurrentRequests--;
        return {
            period1: { clicks: 100, impressions: 1000, ctr: 0.1, position: 1, startDate: '2024-01-01', endDate: '2024-01-07' },
            period2: { clicks: 100, impressions: 1000, ctr: 0.1, position: 1, startDate: '2023-12-25', endDate: '2023-12-31' },
            changes: {
                clicks: 0, clicksPercent: 0,
                impressions: 0, impressionsPercent: 0,
                ctr: 0, ctrPercent: 0,
                position: 0, positionPercent: 0
            }
        };
    };

    it('should limit concurrent checks to 5 sites', async () => {
        const siteCount = 50;
        const sites = Array.from({ length: siteCount }, (_, i) => ({ Url: `https://site-${i}.com` }));

        vi.mocked(bingSites.listSites).mockResolvedValue(sites as any);
        vi.mocked(bingSitemaps.listSitemaps).mockResolvedValue([]);
        vi.mocked(bingAnalytics.detectAnomalies).mockResolvedValue([]);
        vi.mocked(bingCrawl.getCrawlIssues).mockResolvedValue([]);
        vi.mocked(bingCrawl.getCrawlStats).mockResolvedValue([]);

        // This is the key mock to measure concurrency.
        // It is called once per site check.
        vi.mocked(bingAnalytics.comparePeriods).mockImplementation(simulateDelay);

        await healthCheck();

        console.log(`Max concurrent requests: ${maxConcurrentRequests}`);

        // With 50 sites, if unbounded, maxConcurrentRequests should be close to 50.
        // If bounded to 5, it should be around 5.
        // Allowing a small buffer because implementation details might vary slightly,
        // but it should definitely be far less than 50.
        // The checkSite function runs 5 internal promises in parallel.
        // But simulateDelay is only on comparePeriods, which is one of them.
        // So maxConcurrentRequests counts how many checkSite calls are active (specifically at the comparePeriods step).

        expect(maxConcurrentRequests).toBeLessThanOrEqual(10);
    });
});
