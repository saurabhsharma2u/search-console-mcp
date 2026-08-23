import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listAdSenseAccounts, listAccessibleAdSenseAccounts } from '../../src/adsense/tools/accounts.js';
import { loadConfig } from '../../src/common/auth/config.js';
import { getAdsenseClient } from '../../src/adsense/client.js';

vi.mock('../../src/adsense/client.js', () => ({
    getAdsenseClient: vi.fn(),
    clearAdSenseClientCache: vi.fn(),
    AdSenseClient: class {}
}));

vi.mock('../../src/common/auth/config.js', () => ({
    assertServiceAccountKeyReadable: vi.fn(),
    isServiceAccountKeyMissing: vi.fn(() => false),
    loadConfig: vi.fn()
}));

beforeEach(() => {
    vi.clearAllMocks();
});

describe('listAdSenseAccounts', () => {
    it('maps configured adsense accounts', async () => {
        (loadConfig as any).mockResolvedValue({
            accounts: {
                'adsense_1': {
                    id: 'adsense_1',
                    engine: 'adsense',
                    alias: 'Main',
                    adsenseAccountId: 'accounts/pub-123'
                },
                'g1': { id: 'g1', engine: 'google', alias: 'Not AdSense' }
            }
        });

        const result = await listAdSenseAccounts();

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
            id: 'adsense_1',
            alias: 'Main',
            publisherId: 'accounts/pub-123',
            siteUrl: 'accounts/pub-123'
        });
    });

    it('filters by accountId', async () => {
        (loadConfig as any).mockResolvedValue({
            accounts: {
                'adsense_1': { id: 'adsense_1', engine: 'adsense', alias: 'One', adsenseAccountId: 'accounts/pub-1' },
                'adsense_2': { id: 'adsense_2', engine: 'adsense', alias: 'Two', adsenseAccountId: 'accounts/pub-2' }
            }
        });

        const result = await listAdSenseAccounts('adsense_2');

        expect(result).toHaveLength(1);
        expect(result[0].alias).toBe('Two');
    });

    it('throws when accountId does not match any adsense account', async () => {
        (loadConfig as any).mockResolvedValue({ accounts: {} });

        await expect(listAdSenseAccounts('missing')).rejects.toThrow(/not found/);
    });
});

describe('listAccessibleAdSenseAccounts', () => {
    it('discovers all accessible publisher accounts via the API', async () => {
        (getAdsenseClient as any).mockResolvedValue({
            listAccounts: vi.fn().mockResolvedValue([
                { name: 'accounts/pub-111', displayName: 'Pub One', state: 'READY', timeZone: { id: 'Europe/London' }, premium: false },
                { name: 'accounts/pub-222', displayName: 'Pub Two', state: 'CLOSED' }
            ])
        });

        const result = await listAccessibleAdSenseAccounts();

        expect(result).toEqual([
            { name: 'accounts/pub-111', publisherId: 'pub-111', displayName: 'Pub One', state: 'READY', timeZone: { id: 'Europe/London' }, premium: false },
            { name: 'accounts/pub-222', publisherId: 'pub-222', displayName: 'Pub Two', state: 'CLOSED', timeZone: undefined, premium: undefined }
        ]);
    });
});
