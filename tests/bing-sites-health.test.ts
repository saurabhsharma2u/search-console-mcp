import { describe, it, expect, vi, beforeEach } from 'vitest';
import { healthCheck } from '../src/bing/tools/sites-health.js';
import * as bingSites from '../src/bing/tools/sites.js';
import * as bingSitemaps from '../src/bing/tools/sitemaps.js';
import * as bingAnalytics from '../src/bing/tools/analytics.js';
import * as bingCrawl from '../src/bing/tools/crawl.js';

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

describe('Bing Sites Health', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const mockSiteUrl = 'https://example.com';
    const mockPerf = { clicks: 100, impressions: 1000, ctr: 0.1, position: 1, startDate: '2024-01-01', endDate: '2024-01-07' };
    const mockChanges = {
        clicks: 0, clicksPercent: 0,
        impressions: 0, impressionsPercent: 0,
        ctr: 0, ctrPercent: 0,
        position: 0, positionPercent: 0
    };

    const mockComparison = {
        period1: mockPerf,
        period2: mockPerf,
        changes: mockChanges
    };

    it('should return healthy status for good metrics', async () => {
        vi.mocked(bingSitemaps.listSitemaps).mockResolvedValue([{ Path: 'sitemap.xml', Status: 'Success' }]);
        vi.mocked(bingAnalytics.comparePeriods).mockResolvedValue(mockComparison);
        vi.mocked(bingAnalytics.detectAnomalies).mockResolvedValue([]);
        vi.mocked(bingCrawl.getCrawlIssues).mockResolvedValue([]);
        vi.mocked(bingCrawl.getCrawlStats).mockResolvedValue([]);

        const result = await healthCheck(mockSiteUrl);

        expect(result).toHaveLength(1);
        expect(result[0].status).toBe('healthy');
        expect(result[0].issues).toHaveLength(0);
    });

    it('should handle critical traffic drop', async () => {
        const criticalComparison = {
            ...mockComparison,
            changes: { ...mockChanges, clicksPercent: -35 }
        };

        vi.mocked(bingSitemaps.listSitemaps).mockResolvedValue([{ Path: 'sitemap.xml', Status: 'Success' }]);
        vi.mocked(bingAnalytics.comparePeriods).mockResolvedValue(criticalComparison);
        vi.mocked(bingAnalytics.detectAnomalies).mockResolvedValue([]);
        vi.mocked(bingCrawl.getCrawlIssues).mockResolvedValue([]);
        vi.mocked(bingCrawl.getCrawlStats).mockResolvedValue([]);

        const result = await healthCheck(mockSiteUrl);

        expect(result[0].status).toBe('critical');
        expect(result[0].issues.some(i => i.startsWith('Critical traffic drop'))).toBe(true);
    });

    it('should handle traffic declining warning', async () => {
        const warningComparison = {
            ...mockComparison,
            changes: { ...mockChanges, clicksPercent: -20 }
        };

        vi.mocked(bingSitemaps.listSitemaps).mockResolvedValue([{ Path: 'sitemap.xml' }]);
        vi.mocked(bingAnalytics.comparePeriods).mockResolvedValue(warningComparison);
        vi.mocked(bingAnalytics.detectAnomalies).mockResolvedValue([]);
        vi.mocked(bingCrawl.getCrawlIssues).mockResolvedValue([]);
        vi.mocked(bingCrawl.getCrawlStats).mockResolvedValue([]);

        const result = await healthCheck(mockSiteUrl);

        expect(result[0].status).toBe('warning');
        expect(result[0].issues.some(i => i.startsWith('Traffic declining'))).toBe(true);
    });

    it('should handle no traffic data (critical)', async () => {
        const noTrafficComparison = {
            period1: { ...mockPerf, clicks: 0, impressions: 0 },
            period2: mockPerf,
            changes: mockChanges
        };

        vi.mocked(bingSitemaps.listSitemaps).mockResolvedValue([{ Path: 'sitemap.xml' }]);
        vi.mocked(bingAnalytics.comparePeriods).mockResolvedValue(noTrafficComparison);
        vi.mocked(bingAnalytics.detectAnomalies).mockResolvedValue([]);
        vi.mocked(bingCrawl.getCrawlIssues).mockResolvedValue([]);
        vi.mocked(bingCrawl.getCrawlStats).mockResolvedValue([]);

        const result = await healthCheck(mockSiteUrl);

        expect(result[0].status).toBe('critical');
        expect(result[0].issues.some(i => i.includes('No traffic data'))).toBe(true);
    });

    it('should handle no sitemaps (warning)', async () => {
        vi.mocked(bingSitemaps.listSitemaps).mockResolvedValue([]);
        vi.mocked(bingAnalytics.comparePeriods).mockResolvedValue(mockComparison);
        vi.mocked(bingAnalytics.detectAnomalies).mockResolvedValue([]);
        vi.mocked(bingCrawl.getCrawlIssues).mockResolvedValue([]);
        vi.mocked(bingCrawl.getCrawlStats).mockResolvedValue([]);

        const result = await healthCheck(mockSiteUrl);

        expect(result[0].status).toBe('warning');
        expect(result[0].issues.some(i => i.includes('No sitemaps submitted'))).toBe(true);
    });

    it('should handle crawl issues (warning)', async () => {
        vi.mocked(bingSitemaps.listSitemaps).mockResolvedValue([{ Path: 'sitemap.xml' }]);
        vi.mocked(bingAnalytics.comparePeriods).mockResolvedValue(mockComparison);
        vi.mocked(bingAnalytics.detectAnomalies).mockResolvedValue([]);
        vi.mocked(bingCrawl.getCrawlIssues).mockResolvedValue([{ IssueId: '1' } as any]);
        vi.mocked(bingCrawl.getCrawlStats).mockResolvedValue([]);

        const result = await healthCheck(mockSiteUrl);

        expect(result[0].status).toBe('warning');
        expect(result[0].issues.some(i => i.includes('crawl issues detected'))).toBe(true);
    });

    it('should handle crawl stats errors (warning)', async () => {
        vi.mocked(bingSitemaps.listSitemaps).mockResolvedValue([{ Path: 'sitemap.xml' }]);
        vi.mocked(bingAnalytics.comparePeriods).mockResolvedValue(mockComparison);
        vi.mocked(bingAnalytics.detectAnomalies).mockResolvedValue([]);
        vi.mocked(bingCrawl.getCrawlIssues).mockResolvedValue([]);
        vi.mocked(bingCrawl.getCrawlStats).mockResolvedValue([{ CrawlErrors: 5 }]);

        const result = await healthCheck(mockSiteUrl);

        expect(result[0].status).toBe('warning');
        expect(result[0].issues.some(i => i.includes('Crawl errors detected'))).toBe(true);
    });

    it('should handle anomalies (warning)', async () => {
        vi.mocked(bingSitemaps.listSitemaps).mockResolvedValue([{ Path: 'sitemap.xml' }]);
        vi.mocked(bingAnalytics.comparePeriods).mockResolvedValue(mockComparison);
        vi.mocked(bingAnalytics.detectAnomalies).mockResolvedValue([{ date: '2023-01-01' }]);
        vi.mocked(bingCrawl.getCrawlIssues).mockResolvedValue([]);
        vi.mocked(bingCrawl.getCrawlStats).mockResolvedValue([]);

        const result = await healthCheck(mockSiteUrl);

        expect(result[0].status).toBe('warning');
        expect(result[0].issues.some(i => i.includes('traffic anomaly drop(s) detected'))).toBe(true);
    });

    it('should check all sites if no url provided', async () => {
        vi.mocked(bingSites.listSites).mockResolvedValue([{ Url: 'site1' }, { Url: 'site2' }] as any);

        vi.mocked(bingSitemaps.listSitemaps).mockResolvedValue([{ Path: 'sitemap.xml' }]);
        vi.mocked(bingAnalytics.comparePeriods).mockResolvedValue(mockComparison);
        vi.mocked(bingAnalytics.detectAnomalies).mockResolvedValue([]);
        vi.mocked(bingCrawl.getCrawlIssues).mockResolvedValue([]);
        vi.mocked(bingCrawl.getCrawlStats).mockResolvedValue([]);

        const result = await healthCheck();

        expect(result).toHaveLength(2);
        expect(result[0].siteUrl).toBe('site1');
        expect(result[1].siteUrl).toBe('site2');
    });

    it('should return empty if no sites and no url provided', async () => {
        vi.mocked(bingSites.listSites).mockResolvedValue([]);
        const result = await healthCheck();
        expect(result).toEqual([]);
    });

    it('should handle errors gracefully (fallback to empty)', async () => {
        vi.mocked(bingSitemaps.listSitemaps).mockRejectedValue(new Error('Fail'));
        vi.mocked(bingAnalytics.detectAnomalies).mockRejectedValue(new Error('Fail'));
        vi.mocked(bingCrawl.getCrawlIssues).mockRejectedValue(new Error('Fail'));
        vi.mocked(bingCrawl.getCrawlStats).mockRejectedValue(new Error('Fail'));
        vi.mocked(bingAnalytics.comparePeriods).mockResolvedValue(mockComparison);

        const result = await healthCheck(mockSiteUrl);

        expect(result[0].status).toBe('warning');
        expect(result[0].sitemaps.total).toBe(0);
        expect(result[0].anomalies).toEqual([]);
        expect(result[0].crawl.issues).toBe(0);
    });
});
