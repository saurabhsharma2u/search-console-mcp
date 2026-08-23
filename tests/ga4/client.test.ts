import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getGA4Client } from '../../src/ga4/client.js';
import { loadConfig } from '../../src/common/auth/config.js';

// Hoist mocks
const { mockRunReport, mockBatchRunReports, mockRunRealtimeReport } = vi.hoisted(() => ({
    mockRunReport: vi.fn(),
    mockBatchRunReports: vi.fn(),
    mockRunRealtimeReport: vi.fn()
}));

vi.mock('@google-analytics/data', () => {
    return {
        BetaAnalyticsDataClient: class {
            constructor(options: any) {
                // Return the mock object instead of 'this' to proxy calls
                return {
                    runReport: mockRunReport,
                    batchRunReports: mockBatchRunReports,
                    runRealtimeReport: mockRunRealtimeReport
                };
            }
        }
    };
});

vi.mock('../../src/common/auth/config.js', () => ({
    assertServiceAccountKeyReadable: vi.fn(),
    isServiceAccountKeyMissing: vi.fn(() => false),
    loadConfig: vi.fn(),
    AccountConfig: {},
    updateAccount: vi.fn(),
    saveConfig: vi.fn()
}));

// Mock googleapis
vi.mock('googleapis', () => ({
    google: {
        auth: {
            OAuth2: vi.fn(),
            GoogleAuth: vi.fn()
        }
    }
}));

// Mock keyring
vi.mock('@napi-rs/keyring', () => ({
    Entry: vi.fn()
}));

// Mock ../google/client.js
vi.mock('../../src/google/client.js', () => ({
    loadTokensForAccount: vi.fn().mockResolvedValue(null),
    saveTokensForAccount: vi.fn(),
    DEFAULT_CLIENT_ID: 'test',
    DEFAULT_CLIENT_SECRET: 'test'
}));

describe('GA4Client', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should resolve account and call runReport', async () => {
        (loadConfig as any).mockResolvedValue({
            accounts: {
                'test_account': {
                    id: 'test_account',
                    engine: 'ga4',
                    alias: 'Test GA4',
                    ga4PropertyId: '123456',
                    serviceAccountPath: 'test.json'
                }
            }
        });

        mockRunReport.mockResolvedValue([{}]);

        const client = await getGA4Client('123456', 'test_account');
        await client.runReport({ metrics: [{ name: 'sessions' }] });

        expect(mockRunReport).toHaveBeenCalledWith(expect.objectContaining({
            property: 'properties/123456',
            metrics: [{ name: 'sessions' }]
        }));
    });
});
