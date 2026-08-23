import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing target modules
const mockRunReport = vi.fn().mockResolvedValue([{
  dimensionHeaders: [{ name: 'pagePath' }],
  metricHeaders: [{ name: 'sessions' }],
  rows: [{ dimensionValues: [{ value: '/home' }], metricValues: [{ value: '100' }] }]
}]);

const mockBatchRunReports = vi.fn().mockResolvedValue([{
  reports: [
    {
      dimensionHeaders: [{ name: 'deviceCategory' }],
      metricHeaders: [{ name: 'activeUsers' }],
      rows: [{ dimensionValues: [{ value: 'desktop' }], metricValues: [{ value: '50' }] }]
    },
    {
      dimensionHeaders: [{ name: 'country' }],
      metricHeaders: [{ name: 'activeUsers' }],
      rows: [{ dimensionValues: [{ value: 'US' }], metricValues: [{ value: '30' }] }]
    },
    {
      dimensionHeaders: [],
      metricHeaders: [{ name: 'averageSessionDuration' }],
      rows: [{ dimensionValues: [], metricValues: [{ value: '120' }] }]
    }
  ]
}]);

const mockRunRealtimeReport = vi.fn().mockResolvedValue([{
  rows: [{ dimensionValues: [], metricValues: [{ value: '42' }] }]
}]);

vi.mock('@google-analytics/data', () => {
  return {
    BetaAnalyticsDataClient: vi.fn().mockImplementation(function (this: any) {
      this.runReport = mockRunReport;
      this.batchRunReports = mockBatchRunReports;
      this.runRealtimeReport = mockRunRealtimeReport;
    })
  };
});

vi.mock('../src/common/auth/config.js', () => ({
    assertServiceAccountKeyReadable: vi.fn(),
    isServiceAccountKeyMissing: vi.fn(() => false),
  loadConfig: vi.fn().mockResolvedValue({
    accounts: {
      ga4_acc: {
        id: 'ga4_acc',
        alias: 'GA4 Test Account',
        engine: 'ga4',
        ga4PropertyId: '12345678',
        serviceAccountPath: '/path/to/sa.json'
      },
      ga4_acc_oauth: {
        id: 'ga4_acc_oauth',
        alias: 'GA4 OAuth Account',
        engine: 'ga4',
        ga4PropertyId: '87654321'
      },
      ga4_no_pid: {
        id: 'ga4_no_pid',
        alias: 'GA4 No Property ID Account',
        engine: 'ga4'
      }
    }
  })
}));

vi.mock('../src/common/auth/resolver.js', () => ({
  resolveAccount: vi.fn().mockImplementation((siteUrl, engine) => {
    if (siteUrl === '99999') {
      return Promise.resolve({
        id: 'ga4_acc_resolved',
        alias: 'Resolved Account',
        engine: 'ga4',
        ga4PropertyId: '99999',
        serviceAccountPath: '/path/to/sa.json'
      });
    }
    throw new Error('Not found');
  })
}));

vi.mock('../src/google/client.js', () => ({
  loadTokensForAccount: vi.fn().mockImplementation((acc) => {
    if (acc.id === 'ga4_acc_oauth') {
      return Promise.resolve({ access_token: 'fake', expiry_date: Date.now() - 1000 });
    }
    if (acc.id === 'ga4_acc_bad_tokens') {
      return Promise.resolve({ access_token: 'bad' });
    }
    return Promise.resolve(null);
  }),
  saveTokensForAccount: vi.fn().mockResolvedValue(undefined),
  DEFAULT_CLIENT_ID: 'def_client_id',
  DEFAULT_CLIENT_SECRET: 'def_client_secret'
}));

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: class {
        setCredentials = vi.fn();
        refreshAccessToken = vi.fn().mockResolvedValue({
          credentials: { access_token: 'new_token', expiry_date: Date.now() + 3600000 }
        });
      }
    }
  }
}));

import { GA4Client, getGA4Client, clearGA4ClientCache } from '../src/ga4/client.js';
import {
  batchQueryAnalytics,
  queryAnalytics,
  getPagePerformance,
  getTrafficSources,
  getOrganicLandingPages,
  getContentPerformance,
  getEcommerce,
  clearAnalyticsCache
} from '../src/ga4/tools/analytics.js';
import { getUserBehavior, getAudienceSegments, getConversionFunnel } from '../src/ga4/tools/behavior.js';

describe('GA4 Full Coverage Suite', () => {
  beforeEach(() => {
    clearGA4ClientCache();
    clearAnalyticsCache();
    vi.clearAllMocks();
  });

  describe('src/ga4/client.ts', () => {
    it('should create and cache GA4Client via service account', async () => {
      const client = await getGA4Client('12345678', 'ga4_acc');
      expect(client).toBeInstanceOf(GA4Client);
      expect(client.getPropertyId()).toBe('12345678');

      // Second call should hit cache
      const cachedClient = await getGA4Client('12345678', 'ga4_acc');
      expect(cachedClient).toBe(client);
    });

    it('should resolve account by propertyId or resolver fallback', async () => {
      const client1 = await getGA4Client('12345678');
      expect(client1.getPropertyId()).toBe('12345678');

      const client2 = await getGA4Client('99999');
      expect(client2.getPropertyId()).toBe('99999');
    });

    it('should create GA4Client via OAuth tokens and refresh when expired', async () => {
      const client = await getGA4Client('87654321', 'ga4_acc_oauth');
      expect(client).toBeInstanceOf(GA4Client);
    });

    it('should execute runReport, batchRunReports, and runRealtimeReport methods', async () => {
      const client = await getGA4Client('12345678', 'ga4_acc');
      await client.runReport({ dimensions: [{ name: 'pagePath' }] });
      expect(mockRunReport).toHaveBeenCalled();

      await client.batchRunReports({ requests: [] });
      expect(mockBatchRunReports).toHaveBeenCalled();

      await client.runRealtimeReport({ metrics: [{ name: 'activeUsers' }] });
      expect(mockRunRealtimeReport).toHaveBeenCalled();
    });

    it('should throw error when accountId is missing/invalid', async () => {
      await expect(getGA4Client('12345678', 'invalid_acc')).rejects.toThrow();
      await expect(getGA4Client(undefined, 'ga4_no_pid')).rejects.toThrow('No Property ID found');
    });

    it('should fallback to env GOOGLE_APPLICATION_CREDENTIALS if no account tokens or serviceAccountPath', async () => {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = '/path/to/env-creds.json';
      vi.mocked((await import('../src/common/auth/config.js')).loadConfig).mockResolvedValueOnce({
        accounts: {
          ga4_env: { id: 'ga4_env', alias: 'ENV Account', engine: 'ga4', ga4PropertyId: '99999' }
        }
      });
      const client = await getGA4Client('99999', 'ga4_env');
      expect(client).toBeInstanceOf(GA4Client);
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    });

    it('should handle multi-account resolution errors', async () => {
      vi.mocked((await import('../src/common/auth/config.js')).loadConfig).mockResolvedValueOnce({
        accounts: {
          a1: { id: 'a1', engine: 'ga4', alias: 'A1', ga4PropertyId: '111' },
          a2: { id: 'a2', engine: 'ga4', alias: 'A2', ga4PropertyId: '222' }
        }
      });
      await expect(getGA4Client()).rejects.toThrow('Multiple GA4 accounts found');

      vi.mocked((await import('../src/common/auth/config.js')).loadConfig).mockResolvedValueOnce({
        accounts: {
          a1: { id: 'a1', engine: 'ga4', alias: 'A1', ga4PropertyId: '111' },
          a2: { id: 'a2', engine: 'ga4', alias: 'A2', ga4PropertyId: '222' }
        }
      });
      await expect(getGA4Client('999')).rejects.toThrow('GA4 account for Property ID 999 not found');
    });
  });

  describe('src/ga4/tools/analytics.ts', () => {
    it('should execute queryAnalytics and hit LRU cache on second call', async () => {
      const res1 = await queryAnalytics({ propertyId: '12345678', accountId: 'ga4_acc', startDate: '2026-01-01', endDate: '2026-01-31' });
      expect(res1).toBeDefined();

      const res2 = await queryAnalytics({ propertyId: '12345678', accountId: 'ga4_acc', startDate: '2026-01-01', endDate: '2026-01-31' });
      expect(res2).toEqual(res1);
    });

    it('should execute batchQueryAnalytics and handle error rejection', async () => {
      const options = {
        propertyId: '12345678',
        accountId: 'ga4_acc',
        requests: [{ dimensions: ['pagePath'], metrics: ['sessions'] }]
      };
      const res1 = await batchQueryAnalytics(options);
      expect(res1).toBeDefined();

      mockBatchRunReports.mockRejectedValueOnce(new Error('API error'));
      await expect(batchQueryAnalytics({ propertyId: '12345678', accountId: 'ga4_acc', requests: [{ limit: 999 }] })).rejects.toThrow('API error');
    });

    it('should handle queryAnalytics rejection', async () => {
      mockRunReport.mockRejectedValueOnce(new Error('RunReport error'));
      await expect(queryAnalytics({ propertyId: '12345678', accountId: 'ga4_acc', limit: 888 })).rejects.toThrow('RunReport error');
    });

    it('should execute getPagePerformance with pagePath filter and offset', async () => {
      const res = await getPagePerformance('12345678', '2026-01-01', '2026-01-31', '/home', 10, 'ga4_acc', 5);
      expect(res).toBeDefined();
    });

    it('should execute getTrafficSources with channelGroup filter', async () => {
      const res = await getTrafficSources('12345678', '2026-01-01', '2026-01-31', 'Organic Search', 10, 'ga4_acc');
      expect(res).toBeDefined();
    });

    it('should execute getOrganicLandingPages', async () => {
      const res = await getOrganicLandingPages('12345678', '2026-01-01', '2026-01-31', 10, 'ga4_acc');
      expect(res).toBeDefined();
    });

    it('should execute getContentPerformance and handle (not set) contentGroup warning', async () => {
      mockRunReport.mockResolvedValueOnce([{
        dimensionHeaders: [{ name: 'contentGroup' }],
        metricHeaders: [{ name: 'sessions' }],
        rows: [{ dimensionValues: [{ value: '(not set)' }], metricValues: [{ value: '10' }] }]
      }]);
      const res = await getContentPerformance('12345678', '2026-01-01', '2026-01-31', 10, 'ga4_acc');
      expect(res).toHaveProperty('warning');
    });

    it("should execute getEcommerce and handle 'no data' warning", async () => {
      mockRunReport.mockResolvedValueOnce([{
        dimensionHeaders: [{ name: 'itemName' }],
        metricHeaders: [{ name: 'itemRevenue' }],
        rows: []
      }]);
      const res = await getEcommerce('12345678', '2026-01-01', '2026-01-31', 10, 'ga4_acc');
      expect(res).toHaveProperty('warning');
    });
  });

  describe('src/ga4/tools/behavior.ts', () => {
    it('should execute getUserBehavior', async () => {
      const res = await getUserBehavior('12345678', '2026-01-01', '2026-01-31', 'ga4_acc');
      expect(res).toHaveProperty('devices');
      expect(res).toHaveProperty('countries');
      expect(res).toHaveProperty('engagement');
    });

    it('should execute getAudienceSegments', async () => {
      const res = await getAudienceSegments('12345678', '2026-01-01', '2026-01-31', 'ga4_acc');
      expect(res).toHaveProperty('newVsReturning');
      expect(res).toHaveProperty('ageBrackets');
      expect(res).toHaveProperty('operatingSystems');
    });

    it('should execute getConversionFunnel with and without eventName filter', async () => {
      const res1 = await getConversionFunnel('12345678', '2026-01-01', '2026-01-31', undefined, 'ga4_acc');
      expect(res1).toHaveProperty('topConvertingPages');
      expect(res1).toHaveProperty('topEvents');

      const res2 = await getConversionFunnel('12345678', '2026-01-01', '2026-01-31', 'purchase', 'ga4_acc');
      expect(res2).toHaveProperty('topConvertingPages');
    });
  });
});
