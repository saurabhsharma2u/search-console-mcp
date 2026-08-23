import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAdsenseClient, clearAdSenseClientCache } from '../../src/adsense/client.js';
import { loadConfig } from '../../src/common/auth/config.js';

// Hoisted mocks
const { mockGenerate, mockListAccounts, mockListPayments, mockListAlerts, mockRefreshAccessToken, mockAdsenseFactory } = vi.hoisted(() => ({
    mockGenerate: vi.fn(),
    mockListAccounts: vi.fn(),
    mockListPayments: vi.fn(),
    mockListAlerts: vi.fn(),
    mockRefreshAccessToken: vi.fn(),
    mockAdsenseFactory: vi.fn()
}));

vi.mock('googleapis', () => ({
    google: {
        auth: {
            OAuth2: class {
                credentials: any;
                constructor() {
                    this.credentials = {};
                }
                setCredentials(c: any) {
                    this.credentials = c;
                }
                refreshAccessToken = mockRefreshAccessToken;
            },
            GoogleAuth: vi.fn()
        },
        adsense: mockAdsenseFactory
    }
}));

vi.mock('../../src/common/auth/config.js', () => ({
    assertServiceAccountKeyReadable: vi.fn(),
    isServiceAccountKeyMissing: vi.fn(() => false),
    loadConfig: vi.fn(),
    AccountConfig: {},
    updateAccount: vi.fn(),
    saveConfig: vi.fn()
}));

vi.mock('@napi-rs/keyring', () => ({
    Entry: vi.fn()
}));

vi.mock('../../src/google/client.js', () => ({
    loadTokensForAccount: vi.fn().mockResolvedValue(null),
    saveTokensForAccount: vi.fn(),
    DEFAULT_CLIENT_ID: 'test',
    DEFAULT_CLIENT_SECRET: 'test'
}));

function stubAdsenseApi() {
    return {
        accounts: {
            list: mockListAccounts,
            reports: { generate: mockGenerate },
            payments: { list: mockListPayments },
            alerts: { list: mockListAlerts }
        }
    };
}

describe('AdSenseClient', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearAdSenseClientCache();
        mockAdsenseFactory.mockReturnValue(stubAdsenseApi());
    });

    it('auto-selects a single adsense account and injects the account path into report calls', async () => {
        const saveTokens = await import('../../src/google/client.js');
        (loadConfig as any).mockResolvedValue({
            accounts: {
                'adsense_1': {
                    id: 'adsense_1',
                    engine: 'adsense',
                    alias: 'My AdSense',
                    adsenseAccountId: 'accounts/pub-123'
                }
            }
        });
        mockGenerate.mockResolvedValue({ data: { headers: [], rows: [] } });
        (saveTokens.loadTokensForAccount as any).mockResolvedValue({
            refresh_token: 'r',
            expiry_date: Date.now() + 3_600_000
        });

        const client = await getAdsenseClient();
        expect(client.getPublisherId()).toBe('accounts/pub-123');

        await client.generateReport({ dateRange: 'LAST_7_DAYS' } as any);
        expect(mockGenerate).toHaveBeenCalledWith(expect.objectContaining({
            account: 'accounts/pub-123',
            dateRange: 'LAST_7_DAYS'
        }));
    });

    it('throws when multiple accounts exist without accountId', async () => {
        (loadConfig as any).mockResolvedValue({
            accounts: {
                'a1': { id: 'a1', engine: 'adsense', alias: 'One', adsenseAccountId: 'accounts/pub-1' },
                'a2': { id: 'a2', engine: 'adsense', alias: 'Two', adsenseAccountId: 'accounts/pub-2' }
            }
        });

        await expect(getAdsenseClient()).rejects.toThrow(/Multiple AdSense accounts/);
    });

    it('throws when no accounts are configured', async () => {
        (loadConfig as any).mockResolvedValue({ accounts: {} });

        await expect(getAdsenseClient()).rejects.toThrow(/No AdSense accounts found/);
    });

    it('rejects non-adsense accounts passed explicitly', async () => {
        (loadConfig as any).mockResolvedValue({
            accounts: {
                'g1': { id: 'g1', engine: 'google', alias: 'GSC' }
            }
        });

        await expect(getAdsenseClient('g1')).rejects.toThrow(/not an AdSense account/);
    });

    it('refreshes expired tokens and saves new credentials', async () => {
        const saveTokens = await import('../../src/google/client.js');
        (loadConfig as any).mockResolvedValue({
            accounts: {
                'adsense_1': {
                    id: 'adsense_1',
                    engine: 'adsense',
                    alias: 'My AdSense',
                    adsenseAccountId: 'accounts/pub-123'
                }
            }
        });
        (saveTokens.loadTokensForAccount as any).mockResolvedValue({
            refresh_token: 'r',
            expiry_date: Date.now() - 1000
        });
        mockRefreshAccessToken.mockResolvedValue({ credentials: { access_token: 'new' } });

        await getAdsenseClient();

        expect(mockRefreshAccessToken).toHaveBeenCalled();
        expect(saveTokens.saveTokensForAccount).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'adsense_1' }),
            expect.objectContaining({ access_token: 'new', refresh_token: 'r' })
        );
    });

    it('uses valid OAuth tokens without refreshing', async () => {
        const saveTokens = await import('../../src/google/client.js');
        (loadConfig as any).mockResolvedValue({
            accounts: {
                'adsense_1': {
                    id: 'adsense_1',
                    engine: 'adsense',
                    alias: 'My AdSense',
                    adsenseAccountId: 'accounts/pub-123'
                }
            }
        });
        (saveTokens.loadTokensForAccount as any).mockResolvedValue({
            refresh_token: 'r',
            expiry_date: Date.now() + 3_600_000
        });

        const client = await getAdsenseClient();

        expect(mockRefreshAccessToken).not.toHaveBeenCalled();
        expect(saveTokens.saveTokensForAccount).not.toHaveBeenCalled();
        expect(client.getPublisherId()).toBe('accounts/pub-123');
    });

    it('rejects service-account auth: the AdSense API only supports user OAuth', async () => {
        const saveTokens = await import('../../src/google/client.js');
        (loadConfig as any).mockResolvedValue({
            accounts: {
                'adsense_1': {
                    id: 'adsense_1',
                    engine: 'adsense',
                    alias: 'My AdSense',
                    adsenseAccountId: 'accounts/pub-123',
                    serviceAccountPath: '/path/to/key.json'
                }
            }
        });
        (saveTokens.loadTokensForAccount as any).mockResolvedValue(null);
        delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

        await expect(getAdsenseClient()).rejects.toThrow(/does not support service accounts.*setup --engine=adsense/s);
    });

    it('ignores GOOGLE_APPLICATION_CREDENTIALS env and directs to OAuth setup', async () => {
        const saveTokens = await import('../../src/google/client.js');
        process.env.GOOGLE_APPLICATION_CREDENTIALS = '/path/to/env-key.json';
        (loadConfig as any).mockResolvedValue({
            accounts: {
                'adsense_1': {
                    id: 'adsense_1',
                    engine: 'adsense',
                    alias: 'My AdSense',
                    adsenseAccountId: 'accounts/pub-123'
                }
            }
        });
        (saveTokens.loadTokensForAccount as any).mockResolvedValue(null);

        try {
            await expect(getAdsenseClient()).rejects.toThrow(/OAuth/);
        } finally {
            delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
        }
    });

    it('throws when no OAuth tokens are available', async () => {
        const saveTokens = await import('../../src/google/client.js');
        delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
        (loadConfig as any).mockResolvedValue({
            accounts: {
                'adsense_1': {
                    id: 'adsense_1',
                    engine: 'adsense',
                    alias: 'My AdSense',
                    adsenseAccountId: 'accounts/pub-123'
                }
            }
        });
        (saveTokens.loadTokensForAccount as any).mockResolvedValue(null);

        await expect(getAdsenseClient()).rejects.toThrow(/requires user-authorized OAuth 2.0/);
    });

    it('throws when account has no Publisher ID', async () => {
        delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
        const saveTokens = await import('../../src/google/client.js');
        (loadConfig as any).mockResolvedValue({
            accounts: {
                'adsense_broken': {
                    id: 'adsense_broken',
                    engine: 'adsense',
                    alias: 'Broken'
                }
            }
        });
        (saveTokens.loadTokensForAccount as any).mockResolvedValue(null);

        await expect(getAdsenseClient('adsense_broken')).rejects.toThrow(/No AdSense Publisher ID found/);
    });

    it('wraps API calls with the bound account path (listAccounts/payments/alerts)', async () => {
        const saveTokens = await import('../../src/google/client.js');
        (loadConfig as any).mockResolvedValue({
            accounts: {
                'adsense_x': {
                    id: 'adsense_x',
                    engine: 'adsense',
                    alias: 'X',
                    adsenseAccountId: 'accounts/pub-9'
                }
            }
        });
        (saveTokens.loadTokensForAccount as any).mockResolvedValue({
            refresh_token: 'r',
            expiry_date: Date.now() + 3_600_000
        });
        mockListAccounts.mockResolvedValue({ data: { accounts: [{ name: 'accounts/pub-9' }] } });
        mockListPayments.mockResolvedValue({ data: { payments: [{ name: 'p1', amount: '$5' }] } });
        mockListAlerts.mockResolvedValue({ data: { alerts: [{ name: 'a1' }] } });

        const client = await getAdsenseClient('adsense_x');

        await Promise.all([
            expect(client.listAccounts()).resolves.toEqual([{ name: 'accounts/pub-9' }]),
            expect(client.listPayments()).resolves.toEqual([{ name: 'p1', amount: '$5' }]),
            expect(client.listAlerts()).resolves.toEqual([{ name: 'a1' }]),
        ]);
    });

    it('follows nextPageToken across listAccounts pages', async () => {
        const saveTokens = await import('../../src/google/client.js');
        (loadConfig as any).mockResolvedValue({
            accounts: {
                'adsense_p': {
                    id: 'adsense_p',
                    engine: 'adsense',
                    alias: 'Paged',
                    adsenseAccountId: 'accounts/pub-p'
                }
            }
        });
        (saveTokens.loadTokensForAccount as any).mockResolvedValue({
            refresh_token: 'r',
            expiry_date: Date.now() + 3_600_000
        });
        mockListAccounts
            .mockResolvedValueOnce({ data: { accounts: [{ name: 'accounts/pub-1' }], nextPageToken: 'PAGE2' } })
            .mockResolvedValueOnce({ data: { accounts: [{ name: 'accounts/pub-2' }] } });

        const client = await getAdsenseClient('adsense_p');
        const accounts = await client.listAccounts();

        expect(accounts).toEqual([{ name: 'accounts/pub-1' }, { name: 'accounts/pub-2' }]);
        expect(mockListAccounts).toHaveBeenCalledTimes(2);
        expect(mockListAccounts).toHaveBeenLastCalledWith(expect.objectContaining({ pageToken: 'PAGE2' }));
    });

    it('evicts oldest cached client beyond MAX_CLIENT_CACHE_SIZE', async () => {
        const saveTokens = await import('../../src/google/client.js');
        const accounts: Record<string, any> = {};
        for (let i = 0; i < 11; i++) {
            accounts[`adsense_${i}`] = {
                id: `adsense_${i}`,
                engine: 'adsense',
                alias: `AdSense ${i}`,
                adsenseAccountId: `accounts/pub-${i}`
            };
        }
        (loadConfig as any).mockResolvedValue({ accounts });
        delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
        (saveTokens.loadTokensForAccount as any).mockResolvedValue({
            refresh_token: 'r',
            expiry_date: Date.now() + 3_600_000
        });

        // Fill cache with 11 distinct accounts
        for (let i = 0; i < 11; i++) {
            await getAdsenseClient(`adsense_${i}`);
        }
        const factoryCallsAfterFill = mockAdsenseFactory.mock.calls.length;

        // adsense_0 was evicted (oldest) -> re-request triggers a new factory call
        await getAdsenseClient('adsense_0');
        expect(mockAdsenseFactory.mock.calls.length).toBe(factoryCallsAfterFill + 1);

        // adsense_10 is still cached -> no new factory call
        await getAdsenseClient('adsense_10');
        expect(mockAdsenseFactory.mock.calls.length).toBe(factoryCallsAfterFill + 1);
    });
});
