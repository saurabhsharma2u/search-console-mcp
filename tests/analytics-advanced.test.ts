
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockSearchConsoleClient } from './mocks';
import {
    detectTrends,
    detectAnomalies,
    getPerformanceByCountry,
    getPerformanceBySearchAppearance,
    clearAnalyticsCache
} from '../src/google/tools/analytics';

describe('Advanced Analytics Tools', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearAnalyticsCache();
    });

    describe('detectTrends', () => {
        it('should detect rising trends', async () => {
            // Mock two periods: Current (High) vs Previous (Low)
            mockSearchConsoleClient.searchanalytics.query
                // Current period
                .mockResolvedValueOnce({
                    data: { rows: [{ keys: ['rising query'], clicks: 200 }] }
                })
                // Previous period
                .mockResolvedValueOnce({
                    data: { rows: [{ keys: ['rising query'], clicks: 100 }] }
                });

            const trends = await detectTrends('https://example.com', { minClicks: 50 });

            expect(trends.length).toBe(1);
            expect(trends[0].key).toBe('rising query');
            expect(trends[0].trend).toBe('rising');
            expect(trends[0].changePercent).toBe(100);
        });

        it('should detect declining trends', async () => {
            mockSearchConsoleClient.searchanalytics.query
                // Current period
                .mockResolvedValueOnce({
                    data: { rows: [{ keys: ['dropping query'], clicks: 50 }] }
                })
                // Previous period
                .mockResolvedValueOnce({
                    data: { rows: [{ keys: ['dropping query'], clicks: 100 }] }
                });

            const trends = await detectTrends('https://example.com', { minClicks: 10 });

            expect(trends.length).toBe(1);
            expect(trends[0].key).toBe('dropping query');
            expect(trends[0].trend).toBe('declining');
            expect(trends[0].changePercent).toBe(-50);
        });

        it('should detect new trending items (zero to hero)', async () => {
            mockSearchConsoleClient.searchanalytics.query
                // Current period
                .mockResolvedValueOnce({
                    data: { rows: [{ keys: ['new query'], clicks: 100 }] }
                })
                // Previous period (empty)
                .mockResolvedValueOnce({
                    data: { rows: [] }
                });

            const trends = await detectTrends('https://example.com', { minClicks: 50 });

            expect(trends.length).toBe(1);
            expect(trends[0].key).toBe('new query');
            expect(trends[0].changePercent).toBe(100);
            expect(trends[0].previousValue).toBe(0);
        });

        it('should sort trends by absolute change', async () => {
            mockSearchConsoleClient.searchanalytics.query
                .mockResolvedValueOnce({
                    data: {
                        rows: [
                            { keys: ['query A'], clicks: 110 },
                            { keys: ['query B'], clicks: 200 }
                        ]
                    }
                })
                .mockResolvedValueOnce({
                    data: {
                        rows: [
                            { keys: ['query A'], clicks: 100 },
                            { keys: ['query B'], clicks: 100 }
                        ]
                    }
                });

            const trends = await detectTrends('https://example.com', { minClicks: 10 });
            expect(trends[0].key).toBe('query B'); // Change 100 vs Change 10
        });
    });

    describe('detectAnomalies', () => {
        it('should detect spikes in traffic', async () => {
            // Mock data with a clear spike
            // Baseline ~100, Spike 500
            const rows = Array(20).fill({ keys: ['2024-01-XX'], clicks: 100 });
            rows.push({ keys: ['2024-01-21'], clicks: 500 }); // Spike

            mockSearchConsoleClient.searchanalytics.query.mockResolvedValue({
                data: { rows }
            });

            const anomalies = await detectAnomalies('https://example.com');

            expect(anomalies.length).toBe(1);
            expect(anomalies[0].type).toBe('spike');
            expect(anomalies[0].value).toBe(500);
        });

        it('should detect drops in traffic', async () => {
            // Mock data with a clear drop
            // Baseline ~100, Drop 0
            const rows = Array(20).fill({ keys: ['2024-01-XX'], clicks: 100 });
            rows.push({ keys: ['2024-01-21'], clicks: 0 }); // Drop

            mockSearchConsoleClient.searchanalytics.query.mockResolvedValue({
                data: { rows }
            });

            const anomalies = await detectAnomalies('https://example.com');

            expect(anomalies.length).toBeGreaterThan(0);
            expect(anomalies.find(a => a.type === 'drop')).toBeDefined();
        });

        it('should return empty if no anomalies found', async () => {
            // Stable data
            const rows = Array(20).fill({ keys: ['2024-01-XX'], clicks: 100 });

            mockSearchConsoleClient.searchanalytics.query.mockResolvedValue({
                data: { rows }
            });

            const anomalies = await detectAnomalies('https://example.com');

            expect(anomalies.length).toBe(0);
        });
    });
});

describe('getPerformanceByCountry', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearAnalyticsCache();
    });

    it('should get performance sorted by clicks', async () => {
        const mockRows = [
            { keys: ['USA'], clicks: 100, impressions: 1000, ctr: 0.1, position: 1 },
            { keys: ['UK'], clicks: 50, impressions: 500, ctr: 0.1, position: 2 }
        ];
        mockSearchConsoleClient.searchanalytics.query.mockResolvedValue({
            data: { rows: mockRows }
        });

        const result = await getPerformanceByCountry('https://example.com');

        expect(result.items.length).toBe(2);
        expect(result.items[0].key).toBe('USA');
        expect(result.items[0].clicks).toBe(100);
        expect(mockSearchConsoleClient.searchanalytics.query).toHaveBeenCalledWith(
            expect.objectContaining({
                requestBody: expect.objectContaining({
                    dimensions: ['country']
                })
            }),
            expect.objectContaining({ timeout: expect.any(Number) })
        );
    });
});

describe('getPerformanceBySearchAppearance', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearAnalyticsCache();
    });

    it('should get performance data', async () => {
        const mockRows = [
            { keys: ['AMP_BLUE_LINK'], clicks: 100, impressions: 1000 }
        ];
        mockSearchConsoleClient.searchanalytics.query.mockResolvedValue({
            data: { rows: mockRows }
        });

        const result = await getPerformanceBySearchAppearance('https://example.com');

        expect(result.items.length).toBe(1);
        expect(result.items[0].key).toBe('AMP_BLUE_LINK');
        expect(mockSearchConsoleClient.searchanalytics.query).toHaveBeenCalledWith(
            expect.objectContaining({
                requestBody: expect.objectContaining({
                    dimensions: ['searchAppearance']
                })
            }),
            expect.objectContaining({ timeout: expect.any(Number) })
        );
    });
});
