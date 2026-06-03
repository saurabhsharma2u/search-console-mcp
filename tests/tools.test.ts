import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockSearchConsoleClient } from './mocks';
import { listSites, addSite, deleteSite, getSite } from '../src/google/tools/sites';
import { listSitemaps, submitSitemap, deleteSitemap, getSitemap } from '../src/google/tools/sitemaps';
import {
    queryAnalytics,
    getPerformanceSummary,
    comparePeriods,
    getTopQueries,
    getTopPages,
    clearAnalyticsCache
} from '../src/google/tools/analytics';
import { inspectUrl } from '../src/google/tools/inspection';

describe('Sites Tools', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should list sites', async () => {
        mockSearchConsoleClient.sites.list.mockResolvedValue({
            data: { siteEntry: [{ siteUrl: 'https://example.com' }] },
        });
        const sites = await listSites();
        expect(sites).toEqual([{ siteUrl: 'https://example.com' }]);
        expect(mockSearchConsoleClient.sites.list).toHaveBeenCalled();
    });

    it('should list sites with empty result', async () => {
        mockSearchConsoleClient.sites.list.mockResolvedValue({
            data: {},
        });
        const sites = await listSites();
        expect(sites).toEqual([]);
    });

    it('should add a site', async () => {
        mockSearchConsoleClient.sites.add.mockResolvedValue({});
        const result = await addSite('https://example.com');
        expect(result).toContain('Successfully added site');
        expect(mockSearchConsoleClient.sites.add).toHaveBeenCalledWith(
            { siteUrl: 'https://example.com' },
            expect.objectContaining({ timeout: expect.any(Number) })
        );
    });

    it('should delete a site', async () => {
        mockSearchConsoleClient.sites.delete.mockResolvedValue({});
        const result = await deleteSite('https://example.com');
        expect(result).toContain('Successfully deleted site');
        expect(mockSearchConsoleClient.sites.delete).toHaveBeenCalledWith(
            { siteUrl: 'https://example.com' },
            expect.objectContaining({ timeout: expect.any(Number) })
        );
    });

    it('should get a site', async () => {
        mockSearchConsoleClient.sites.get.mockResolvedValue({ data: { siteUrl: 'https://example.com', permissionLevel: 'siteOwner' } });
        const result = await getSite('https://example.com');
        expect(result).toEqual({ siteUrl: 'https://example.com', permissionLevel: 'siteOwner' });
        expect(mockSearchConsoleClient.sites.get).toHaveBeenCalledWith(
            { siteUrl: 'https://example.com' },
            expect.objectContaining({ timeout: expect.any(Number) })
        );
    });
});

describe('Sitemaps Tools', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should list sitemaps', async () => {
        mockSearchConsoleClient.sitemaps.list.mockResolvedValue({
            data: { sitemap: [{ path: 'https://example.com/sitemap.xml' }] }
        });
        const sitemaps = await listSitemaps('https://example.com');
        expect(sitemaps).toEqual([{ path: 'https://example.com/sitemap.xml' }]);
        expect(mockSearchConsoleClient.sitemaps.list).toHaveBeenCalledWith(
            { siteUrl: 'https://example.com' },
            expect.objectContaining({ timeout: expect.any(Number) })
        );
    });

    it('should list sitemaps with empty result', async () => {
        mockSearchConsoleClient.sitemaps.list.mockResolvedValue({
            data: {}
        });
        const sitemaps = await listSitemaps('https://example.com');
        expect(sitemaps).toEqual([]);
    });

    it('should submit sitemap', async () => {
        mockSearchConsoleClient.sitemaps.submit.mockResolvedValue({});
        const result = await submitSitemap('https://example.com', 'https://example.com/sitemap.xml');
        expect(result).toContain('Successfully submitted sitemap');
        expect(mockSearchConsoleClient.sitemaps.submit).toHaveBeenCalledWith(
            {
                siteUrl: 'https://example.com',
                feedpath: 'https://example.com/sitemap.xml'
            },
            expect.objectContaining({ timeout: expect.any(Number) })
        );
    });

    it('should delete sitemap', async () => {
        mockSearchConsoleClient.sitemaps.delete.mockResolvedValue({});
        const result = await deleteSitemap('https://example.com', 'https://example.com/sitemap.xml');
        expect(result).toContain('Successfully deleted sitemap');
        expect(mockSearchConsoleClient.sitemaps.delete).toHaveBeenCalledWith(
            {
                siteUrl: 'https://example.com',
                feedpath: 'https://example.com/sitemap.xml'
            },
            expect.objectContaining({ timeout: expect.any(Number) })
        );
    });

    it('should get sitemap', async () => {
        const mockSitemap = { path: 'https://example.com/sitemap.xml', lastSubmitted: '2024-01-01' };
        mockSearchConsoleClient.sitemaps.get.mockResolvedValue({ data: mockSitemap });
        const result = await getSitemap('https://example.com', 'https://example.com/sitemap.xml');
        expect(result).toEqual(mockSitemap);
        expect(mockSearchConsoleClient.sitemaps.get).toHaveBeenCalledWith(
            {
                siteUrl: 'https://example.com',
                feedpath: 'https://example.com/sitemap.xml'
            },
            expect.objectContaining({ timeout: expect.any(Number) })
        );
    });
});

describe('Analytics Tools', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearAnalyticsCache();
    });

    it('should query analytics', async () => {
        const mockRows = [{ clicks: 100, impressions: 1000 }];
        mockSearchConsoleClient.searchanalytics.query.mockResolvedValue({
            data: { rows: mockRows }
        });

        const result = await queryAnalytics({
            siteUrl: 'https://example.com',
            startDate: '2023-01-01',
            endDate: '2023-01-31'
        });

        expect(result).toEqual(mockRows);
        expect(mockSearchConsoleClient.searchanalytics.query).toHaveBeenCalledWith(
            expect.objectContaining({
                siteUrl: 'https://example.com',
                requestBody: expect.objectContaining({
                    startDate: '2023-01-01',
                    endDate: '2023-01-31'
                })
            }),
            expect.objectContaining({ timeout: expect.any(Number) })
        );
    });

    it('should query analytics with empty results', async () => {
        mockSearchConsoleClient.searchanalytics.query.mockResolvedValue({
            data: {}
        });

        const result = await queryAnalytics({
            siteUrl: 'https://example.com',
            startDate: '2023-01-01',
            endDate: '2023-01-31'
        });

        expect(result).toEqual([]);
    });

    it('should query analytics with filters', async () => {
        const mockRows = [{ clicks: 100, impressions: 1000 }];
        mockSearchConsoleClient.searchanalytics.query.mockResolvedValue({
            data: { rows: mockRows }
        });

        const result = await queryAnalytics({
            siteUrl: 'https://example.com',
            startDate: '2023-01-01',
            endDate: '2023-01-31',
            filters: [{ dimension: 'query', operator: 'contains', expression: 'test' }]
        });

        expect(result).toEqual(mockRows);
        expect(mockSearchConsoleClient.searchanalytics.query).toHaveBeenCalledWith(
            expect.objectContaining({
                requestBody: expect.objectContaining({
                    dimensionFilterGroups: [{
                        filters: [{ dimension: 'query', operator: 'contains', expression: 'test' }]
                    }]
                })
            }),
            expect.objectContaining({ timeout: expect.any(Number) })
        );
    });

    it('should query analytics with startRow for pagination', async () => {
        const mockRows = [{ clicks: 50, impressions: 500 }];
        mockSearchConsoleClient.searchanalytics.query.mockResolvedValue({
            data: { rows: mockRows }
        });

        const result = await queryAnalytics({
            siteUrl: 'https://example.com',
            startDate: '2023-01-01',
            endDate: '2023-01-31',
            startRow: 100
        });

        expect(result).toEqual(mockRows);
        expect(mockSearchConsoleClient.searchanalytics.query).toHaveBeenCalledWith(
            expect.objectContaining({
                requestBody: expect.objectContaining({
                    startRow: 100
                })
            }),
            expect.objectContaining({ timeout: expect.any(Number) })
        );
    });

    it('should get performance summary', async () => {
        const mockRows = [{ clicks: 100, impressions: 1000, ctr: 0.1, position: 5 }];
        mockSearchConsoleClient.searchanalytics.query.mockResolvedValue({
            data: { rows: mockRows }
        });

        const result = await getPerformanceSummary('https://example.com');

        expect(result).toEqual({
            clicks: 100,
            impressions: 1000,
            ctr: 0.1,
            position: 5,
            startDate: expect.any(String),
            endDate: expect.any(String)
        });
        expect(mockSearchConsoleClient.searchanalytics.query).toHaveBeenCalled();
    });

    it('should get performance summary with empty results', async () => {
        mockSearchConsoleClient.searchanalytics.query.mockResolvedValue({
            data: { rows: [] }
        });

        const result = await getPerformanceSummary('https://example.com', 7);

        expect(result).toEqual({
            clicks: 0,
            impressions: 0,
            ctr: 0,
            position: 0,
            startDate: expect.any(String),
            endDate: expect.any(String)
        });
    });

    it('should compare periods', async () => {
        const period1Rows = [{ clicks: 100, impressions: 1000, ctr: 0.1, position: 5 }];
        const period2Rows = [{ clicks: 80, impressions: 800, ctr: 0.08, position: 6 }];

        mockSearchConsoleClient.searchanalytics.query
            .mockResolvedValueOnce({ data: { rows: period1Rows } })
            .mockResolvedValueOnce({ data: { rows: period2Rows } });

        const result = await comparePeriods(
            'https://example.com',
            '2024-01-08',
            '2024-01-14',
            '2024-01-01',
            '2024-01-07'
        );

        expect(result.period1.clicks).toBe(100);
        expect(result.period2.clicks).toBe(80);
        expect(result.changes.clicks).toBe(20);
        expect(result.changes.clicksPercent).toBe(25);
    });

    it('should compare periods with empty data', async () => {
        mockSearchConsoleClient.searchanalytics.query
            .mockResolvedValueOnce({ data: { rows: [] } })
            .mockResolvedValueOnce({ data: { rows: [] } });

        const result = await comparePeriods(
            'https://example.com',
            '2024-01-08',
            '2024-01-14',
            '2024-01-01',
            '2024-01-07'
        );

        expect(result.period1.clicks).toBe(0);
        expect(result.period2.clicks).toBe(0);
        expect(result.changes.clicks).toBe(0);
        expect(result.changes.clicksPercent).toBe(0);
    });

    it('should get top queries', async () => {
        const mockRows = [
            { keys: ['query1'], clicks: 100, impressions: 1000, ctr: 0.1, position: 5 },
            { keys: ['query2'], clicks: 50, impressions: 500, ctr: 0.1, position: 3 }
        ];
        mockSearchConsoleClient.searchanalytics.query.mockResolvedValue({
            data: { rows: mockRows }
        });

        const result = await getTopQueries('https://example.com');

        expect(result.items.length).toBe(2);
        expect(result.items[0].key).toBe('query1');
        expect(result.items[0].clicks).toBe(100);
        expect(result.totalRows).toBe(2);
    });

    it('should get top queries sorted by impressions', async () => {
        const mockRows = [
            { keys: ['query1'], clicks: 50, impressions: 1000, ctr: 0.05, position: 5 },
            { keys: ['query2'], clicks: 100, impressions: 500, ctr: 0.2, position: 3 }
        ];
        mockSearchConsoleClient.searchanalytics.query.mockResolvedValue({
            data: { rows: mockRows }
        });

        const result = await getTopQueries('https://example.com', { sortBy: 'impressions' });

        expect(result.items[0].key).toBe('query1');
        expect(result.items[0].impressions).toBe(1000);
    });

    it('should get top pages', async () => {
        const mockRows = [
            { keys: ['https://example.com/page1'], clicks: 100, impressions: 1000, ctr: 0.1, position: 5 },
            { keys: ['https://example.com/page2'], clicks: 50, impressions: 500, ctr: 0.1, position: 3 }
        ];
        mockSearchConsoleClient.searchanalytics.query.mockResolvedValue({
            data: { rows: mockRows }
        });

        const result = await getTopPages('https://example.com', { days: 14, limit: 5 });

        expect(result.items.length).toBe(2);
        expect(result.items[0].key).toBe('https://example.com/page1');
        expect(result.items[0].clicks).toBe(100);
    });

    it('should get top pages sorted by impressions', async () => {
        const mockRows = [
            { keys: ['https://example.com/page1'], clicks: 50, impressions: 1000, ctr: 0.05, position: 5 },
            { keys: ['https://example.com/page2'], clicks: 100, impressions: 500, ctr: 0.2, position: 3 }
        ];
        mockSearchConsoleClient.searchanalytics.query.mockResolvedValue({
            data: { rows: mockRows }
        });

        const result = await getTopPages('https://example.com', { sortBy: 'impressions' });

        expect(result.items[0].key).toBe('https://example.com/page1');
        expect(result.items[0].impressions).toBe(1000);
    });

    it('should handle null values in performance summary', async () => {
        const mockRows = [{ clicks: null, impressions: null, ctr: null, position: null }];
        mockSearchConsoleClient.searchanalytics.query.mockResolvedValue({
            data: { rows: mockRows }
        });

        const result = await getPerformanceSummary('https://example.com');

        expect(result.clicks).toBe(0);
        expect(result.impressions).toBe(0);
        expect(result.ctr).toBe(0);
        expect(result.position).toBe(0);
    });

    it('should handle null values in compare periods', async () => {
        const period1Rows = [{ clicks: null, impressions: null, ctr: null, position: null }];
        const period2Rows = [{ clicks: 100, impressions: 1000, ctr: 0.1, position: 5 }];

        mockSearchConsoleClient.searchanalytics.query
            .mockResolvedValueOnce({ data: { rows: period1Rows } })
            .mockResolvedValueOnce({ data: { rows: period2Rows } });

        const result = await comparePeriods(
            'https://example.com',
            '2024-01-08',
            '2024-01-14',
            '2024-01-01',
            '2024-01-07'
        );

        expect(result.period1.clicks).toBe(0);
        expect(result.period2.clicks).toBe(100);
        expect(result.changes.clicksPercent).toBe(-100);
    });

    it('should handle null values in top queries', async () => {
        const mockRows = [
            { keys: null, clicks: null, impressions: null, ctr: null, position: null },
            { keys: ['query2'], clicks: 50, impressions: 500, ctr: 0.1, position: 3 }
        ];
        mockSearchConsoleClient.searchanalytics.query.mockResolvedValue({
            data: { rows: mockRows }
        });

        const result = await getTopQueries('https://example.com');

        expect(result.items[0].key).toBe('query2');
        expect(result.items[1].key).toBe('');
        expect(result.items[1].clicks).toBe(0);
    });

    it('should handle null values in top pages', async () => {
        const mockRows = [
            { keys: null, clicks: null, impressions: null, ctr: null, position: null }
        ];
        mockSearchConsoleClient.searchanalytics.query.mockResolvedValue({
            data: { rows: mockRows }
        });

        const result = await getTopPages('https://example.com');

        expect(result.items[0].key).toBe('');
        expect(result.items[0].clicks).toBe(0);
    });
});

describe('Inspection Tools', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should inspect url', async () => {
        const mockResponse = { inspectionResult: { indexStatusResult: { status: 'VERDICT_PASS' } } };
        mockSearchConsoleClient.urlInspection.index.inspect.mockResolvedValue({
            data: mockResponse
        });

        const result = await inspectUrl('https://example.com', 'https://example.com/page');

        expect(result).toEqual(mockResponse);
        expect(mockSearchConsoleClient.urlInspection.index.inspect).toHaveBeenCalledWith(
            {
                requestBody: {
                    inspectionUrl: 'https://example.com/page',
                    siteUrl: 'https://example.com',
                    languageCode: 'en-US'
                }
            },
            expect.objectContaining({ timeout: expect.any(Number) })
        );
    });

    it('should inspect url with custom language code', async () => {
        const mockResponse = { inspectionResult: { indexStatusResult: { status: 'VERDICT_PASS' } } };
        mockSearchConsoleClient.urlInspection.index.inspect.mockResolvedValue({
            data: mockResponse
        });

        const result = await inspectUrl('https://example.com', 'https://example.com/page', 'de-DE');

        expect(result).toEqual(mockResponse);
        expect(mockSearchConsoleClient.urlInspection.index.inspect).toHaveBeenCalledWith(
            {
                requestBody: {
                    inspectionUrl: 'https://example.com/page',
                    siteUrl: 'https://example.com',
                    languageCode: 'de-DE'
                }
            },
            expect.objectContaining({ timeout: expect.any(Number) })
        );
    });
});
