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
        (loadConfig as any).mockResolvedValue({
            accounts: {
                'adsense_1': {
                    id: 'adsense_1',
                    engine: 'adsense',
                    alias: 'My AdSense',
                    adsenseAccountId: 'accounts/pub-123',
                    serviceAccountPath: 'test.json'
                }
            }
        });
        mockGenerate.mockResolvedValue({ data: { headers: [], rows: [] } });
        // No tokens -> falls through to the service-account path
        delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

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
            { access_token: 'new' }
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

    it('falls back to service account when token-based auth fails', async () => {
        const saveTokens = await import('../../src/google/client.js');
        const { google } = await import('googleapis');
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
        // Tokens exist but the adsense factory rejects them -> caught, falls through
        (saveTokens.loadTokensForAccount as any).mockResolvedValue({ refresh_token: 'r', expiry_date: null });
        mockAdsenseFactory.mockImplementationOnce(() => {
            throw new Error('invalid_grant');
        });

        const client = await getAdsenseClient();

        expect(client.getPublisherId()).toBe('accounts/pub-123');
        expect((google.auth as any).GoogleAuth).toHaveBeenCalledWith(expect.objectContaining({
            keyFile: '/path/to/key.json'
        }));
    });

    it('falls back to GOOGLE_APPLICATION_CREDENTIALS env when no tokens or key file', async () => {
        const saveTokens = await import('../../src/google/client.js');
        const { google } = await import('googleapis');
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
            const client = await getAdsenseClient();
            expect(client.getPublisherId()).toBe('accounts/pub-123');
            expect((google.auth as any).GoogleAuth).toHaveBeenCalledWith(expect.objectContaining({
                keyFile: '/path/to/env-key.json'
            }));
        } finally {
            delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
        }
    });

    it('throws when no auth path is available', async () => {
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

        await expect(getAdsenseClient()).rejects.toThrow(/Authentication configuration not found/);
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
        const { AdSenseClient } = await import('../../src/adsense/client.js');
        const stub = stubAdsenseApi();
        mockListAccounts.mockResolvedValue({ data: { accounts: [{ name: 'accounts/pub-9' }] } });
        mockListPayments.mockResolvedValue({ data: { payments: [{ name: 'p1', amount: '$5' }] } });
        mockListAlerts.mockResolvedValue({ data: { alerts: [{ name: 'a1' }] } });
        // No tokens -> service-account path
        delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
        (loadConfig as any).mockResolvedValue({
            accounts: {
                'adsense_x': {
                    id: 'adsense_x',
                    engine: 'adsense',
                    alias: 'X',
                    adsenseAccountId: 'accounts/pub-9',
                    serviceAccountPath: 'key.json'
                }
            }
        });

        const client = await getAdsenseClient('adsense_x');

        expect(client.listAccounts()).resolves.toEqual([{ name: 'accounts/pub-9' }]);
        expect(client.listPayments()).resolves.toEqual([{ name: 'p1', amount: '$5' }]);
        expect(client.listAlerts()).resolves.toEqual([{ name: 'a1' }]);
    });

    it('evicts oldest cached client beyond MAX_CLIENT_CACHE_SIZE', async () => {
        const accounts: Record<string, any> = {};
        for (let i = 0; i < 11; i++) {
            accounts[`adsense_${i}`] = {
                id: `adsense_${i}`,
                engine: 'adsense',
                alias: `AdSense ${i}`,
                adsenseAccountId: `accounts/pub-${i}`,
                serviceAccountPath: 'key.json'
            };
        }
        (loadConfig as any).mockResolvedValue({ accounts });
        delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

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
