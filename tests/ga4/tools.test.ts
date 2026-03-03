import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getPagePerformance } from '../../src/ga4/tools/analytics.js';
import { getRealtimeData } from '../../src/ga4/tools/realtime.js';
import { listProperties } from '../../src/ga4/tools/properties.js';
import * as clientModule from '../../src/ga4/client.js';
import * as configModule from '../../src/common/auth/config.js';

// Mock dependencies
vi.mock('../../src/common/auth/config.js', () => ({
    loadConfig: vi.fn(),
}));

const mockRunReport = vi.fn();
const mockBatchRunReports = vi.fn();
const mockRunRealtimeReport = vi.fn();

vi.mock('../../src/ga4/client.js', () => ({
    getGA4Client: vi.fn(),
    GA4Client: class {}
}));

describe('GA4 Tools', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (clientModule.getGA4Client as any).mockResolvedValue({
            runReport: mockRunReport,
            batchRunReports: mockBatchRunReports,
            runRealtimeReport: mockRunRealtimeReport
        });
    });

    it('getPagePerformance should call runReport and format results', async () => {
        mockRunReport.mockResolvedValue(
            {
                rows: [
                    {
                        dimensionValues: [{ value: '/home' }],
                        metricValues: [{ value: '100' }]
                    }
                ],
                dimensionHeaders: [{ name: 'pagePath' }],
                metricHeaders: [{ name: 'sessions' }]
            }
        );

        const result = await getPagePerformance('123', '2023-01-01', '2023-01-31');

        expect(mockRunReport).toHaveBeenCalled();
        expect(result).toEqual([{ pagePath: '/home', sessions: 100 }]);
    });

    it('getRealtimeData should call runRealtimeReport', async () => {
        mockRunRealtimeReport.mockResolvedValue([
            {
                rows: [],
                dimensionHeaders: [],
                metricHeaders: []
            }
        ]);

        await getRealtimeData('123');
        expect(mockRunRealtimeReport).toHaveBeenCalled();
    });

    it('listProperties should return configured GA4 properties', async () => {
        (configModule.loadConfig as any).mockResolvedValue({
            accounts: {
                ga4_test_1: {
                    id: 'ga4_test_1',
                    engine: 'ga4',
                    alias: 'GA4 Test Account 1',
                    ga4PropertyId: '123456'
                },
                google_test: {
                    id: 'google_test',
                    engine: 'google',
                    alias: 'Google Account'
                },
                ga4_test_2: {
                    id: 'ga4_test_2',
                    engine: 'ga4',
                    alias: 'GA4 Test Account 2',
                    ga4PropertyId: '789012'
                }
            }
        });

        const properties = await listProperties();
        expect(properties).toHaveLength(2);
        expect(properties[0]).toEqual({
            id: 'ga4_test_1',
            alias: 'GA4 Test Account 1',
            propertyId: '123456'
        });
        expect(properties[1]).toEqual({
            id: 'ga4_test_2',
            alias: 'GA4 Test Account 2',
            propertyId: '789012'
        });
    });

    it('listProperties should filter by accountId if provided', async () => {
        (configModule.loadConfig as any).mockResolvedValue({
            accounts: {
                ga4_test_1: {
                    id: 'ga4_test_1',
                    engine: 'ga4',
                    alias: 'GA4 Test Account 1',
                    ga4PropertyId: '123456'
                },
                ga4_test_2: {
                    id: 'ga4_test_2',
                    engine: 'ga4',
                    alias: 'GA4 Test Account 2',
                    ga4PropertyId: '789012'
                }
            }
        });

        const properties = await listProperties('ga4_test_2');
        expect(properties).toHaveLength(1);
        expect(properties[0]).toEqual({
            id: 'ga4_test_2',
            alias: 'GA4 Test Account 2',
            propertyId: '789012'
        });
    });

    it('listProperties should throw error if accountId not found', async () => {
        (configModule.loadConfig as any).mockResolvedValue({
            accounts: {
                ga4_test_1: {
                    id: 'ga4_test_1',
                    engine: 'ga4',
                    alias: 'GA4 Test Account 1',
                    ga4PropertyId: '123456'
                }
            }
        });

        await expect(listProperties('ga4_invalid')).rejects.toThrow('GA4 account ga4_invalid not found.');
    });
});
