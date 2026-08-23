import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ScriptedDriver } from './helpers/scripted-driver.js';

const { mockAdminApi, mockAdsenseApi } = vi.hoisted(() => ({
    mockAdminApi: {
        accountSummaries: {
            list: vi.fn().mockResolvedValue({ data: { accountSummaries: [] } }),
        },
    },
    mockAdsenseApi: {
        accounts: {
            list: vi.fn().mockResolvedValue({ data: { accounts: [] } }),
            reports: {
                generate: vi.fn().mockResolvedValue({ data: {} }),
            },
        },
    },
}));

vi.mock('../src/common/auth/config.js', () => ({
    loadConfig: vi.fn(),
    updateAccount: vi.fn(),
    saveConfig: vi.fn(),
    assertServiceAccountKeyReadable: vi.fn(),
    isServiceAccountKeyMissing: vi.fn(() => false),
}));

vi.mock('../src/google/client.js', () => ({
    startLocalFlow: vi.fn(),
    getUserEmail: vi.fn(),
    saveTokensForAccount: vi.fn(),
    DEFAULT_CLIENT_ID: 'mock-id',
    DEFAULT_CLIENT_SECRET: 'mock-secret',
}));

vi.mock('googleapis', () => ({
    google: {
        auth: {
            GoogleAuth: vi.fn(function () {
                return { getClient: vi.fn().mockResolvedValue({}) };
            }),
            OAuth2: vi.fn(function () {
                return { setCredentials: vi.fn() };
            }),
        },
        analyticsadmin: vi.fn().mockReturnValue(mockAdminApi),
        adsense: vi.fn().mockReturnValue(mockAdsenseApi),
        searchconsole: vi.fn(),
    },
}));

vi.mock('@google-analytics/data', () => ({
    BetaAnalyticsDataClient: vi.fn(function () {
        return { runReport: vi.fn().mockResolvedValue([{}]) };
    }),
}));

vi.mock('../src/utils/validation.js', () => ({
    validateAlias: (v?: string) => (v && v.trim() ? undefined : 'Alias cannot be empty.'),
    parseServiceAccountKey: vi.fn(),
}));

vi.mock('../src/setup/shared.js', () => ({
    log: vi.fn(),
    printStep: vi.fn(),
    printSuccess: vi.fn(),
    printError: vi.fn(),
    printInfo: vi.fn(),
    printBoxHeader: vi.fn(),
    showMcpConfigSnippet: vi.fn(),
    supportProject: vi.fn(),
    acquireServiceAccountKey: vi.fn(),
}));

import * as config from '../src/common/auth/config.js';
import * as googleClient from '../src/google/client.js';
import * as validation from '../src/utils/validation.js';
import * as shared from '../src/setup/shared.js';
import { prompts, setPromptDriver } from '../src/utils/prompts.js';
import { configureGA4 } from '../src/setup/flows/ga4.js';
import { configureAdSense } from '../src/setup/flows/adsense.js';

const emptyStatus: any = {
    googleAccounts: [],
    bingAccounts: [],
    ga4Accounts: [],
    adsenseAccounts: [],
    legacyBing: false,
    pagespeedApiKey: false,
};

describe('setup flows: ga4 + adsense', () => {
    let driver: ScriptedDriver;

    beforeEach(() => {
        vi.clearAllMocks();
        driver = new ScriptedDriver();
        setPromptDriver(driver as any);
        vi.mocked(config.loadConfig).mockResolvedValue({ accounts: {} } as any);
        vi.mocked(googleClient.startLocalFlow).mockResolvedValue({ access_token: 't' } as any);
        vi.mocked(googleClient.getUserEmail).mockResolvedValue('user@test.com');
        mockAdminApi.accountSummaries.list.mockResolvedValue({
            data: {
                accountSummaries: [{
                    propertySummaries: [{ property: 'properties/458548565', displayName: 'My Property' }],
                }],
            },
        } as any);
        mockAdsenseApi.accounts.list.mockResolvedValue({
            data: { accounts: [{ name: 'accounts/pub-123', displayName: 'My Site' }] },
        } as any);
    });

    afterEach(() => {
        setPromptDriver(undefined);
    });

    describe('configureGA4', () => {
        it('reuses existing GSC service account key when confirmed', async () => {
            vi.mocked(config.loadConfig).mockResolvedValue({
                accounts: {
                    g1: { id: 'g1', engine: 'google', alias: 'gsc', serviceAccountPath: '/keys/gsc.json' },
                },
            } as any);
            vi.mocked(validation.parseServiceAccountKey).mockReturnValue({
                key: { client_email: 'sa@gsc.iam.gserviceaccount.com' },
            } as any);
            driver.confirmResponses = [true]; // reuse key
            driver.selectResponses = ['458548565']; // property pick

            await configureGA4(emptyStatus);

            expect(driver.received).toContainEqual(expect.stringContaining('Reuse it?'));
            expect(config.updateAccount).toHaveBeenCalledWith(expect.objectContaining({
                engine: 'ga4',
                ga4PropertyId: '458548565',
                serviceAccountPath: '/keys/gsc.json',
                alias: 'sa@gsc.iam.gserviceaccount.com-458548565',
            }));
            expect(shared.supportProject).toHaveBeenCalledWith('GA4');
        });

        it('falls back to acquireServiceAccountKey when no GSC key exists', async () => {
            vi.mocked(shared.acquireServiceAccountKey).mockResolvedValue({
                path: '/keys/fresh.json',
                key: { client_email: 'fresh@sa.iam.gserviceaccount.com' },
            } as any);
            driver.selectResponses = ['458548565'];

            await configureGA4(emptyStatus);

            expect(shared.acquireServiceAccountKey).toHaveBeenCalled();
            expect(config.updateAccount).toHaveBeenCalledWith(expect.objectContaining({
                engine: 'ga4',
                serviceAccountPath: '/keys/fresh.json',
            }));
        });

        it('cancels cleanly when no key is acquired', async () => {
            vi.mocked(shared.acquireServiceAccountKey).mockResolvedValue(undefined as any);

            await configureGA4(emptyStatus);

            expect(shared.printError).toHaveBeenCalledWith(expect.stringContaining('cancelled'));
            expect(config.updateAccount).not.toHaveBeenCalled();
        });

        it('reports verification failure and does not save', async () => {
            const { BetaAnalyticsDataClient } = await import('@google-analytics/data');
            vi.mocked(BetaAnalyticsDataClient as any).mockImplementation(function () {
                return { runReport: vi.fn().mockRejectedValue(new Error('PERMISSION_DENIED')) };
            });
            vi.mocked(validation.parseServiceAccountKey).mockReturnValue({
                key: { client_email: 'sa@gsc.iam.gserviceaccount.com' },
            } as any);
            vi.mocked(config.loadConfig).mockResolvedValue({
                accounts: {
                    g1: { id: 'g1', engine: 'google', alias: 'gsc', serviceAccountPath: '/keys/gsc.json' },
                },
            } as any);
            driver.confirmResponses = [true];
            driver.selectResponses = ['458548565'];

            await configureGA4(emptyStatus);

            expect(shared.printError).toHaveBeenCalledWith(expect.stringContaining('Verification failed'));
            expect(config.updateAccount).not.toHaveBeenCalled();
        });

        it('returns early when already connected and user declines reconfigure', async () => {
            driver.confirmResponses = [false];

            await configureGA4({
                ...emptyStatus,
                ga4Accounts: [{ id: 'ga4_1', engine: 'ga4', alias: 'x', ga4PropertyId: '123' }],
            } as any);

            expect(config.updateAccount).not.toHaveBeenCalled();
            expect(driver.received.some(r => r.includes('reconfigure'))).toBe(true);
        });
    });

    describe('configureAdSense', () => {
        it('runs OAuth flow and saves a single publisher account automatically', async () => {
            await configureAdSense(emptyStatus);

            expect(googleClient.startLocalFlow).toHaveBeenCalled();
            expect(mockAdsenseApi.accounts.reports.generate).toHaveBeenCalledWith(
                expect.objectContaining({ account: 'accounts/pub-123' })
            );
            expect(config.updateAccount).toHaveBeenCalledWith(expect.objectContaining({
                engine: 'adsense',
                adsenseAccountId: 'accounts/pub-123',
                alias: 'user@test.com-adsense',
            }));
            expect(googleClient.saveTokensForAccount).toHaveBeenCalled();
            expect(shared.supportProject).toHaveBeenCalledWith('AdSense');
        });

        it('prompts selection when multiple publisher accounts exist', async () => {
            mockAdsenseApi.accounts.list.mockResolvedValue({
                data: {
                    accounts: [
                        { name: 'accounts/pub-1', displayName: 'One' },
                        { name: 'accounts/pub-2', displayName: 'Two' },
                    ],
                },
            } as any);
            driver.selectResponses = [{ name: 'accounts/pub-2', displayName: 'Two' }];

            await configureAdSense(emptyStatus);

            expect(config.updateAccount).toHaveBeenCalledWith(expect.objectContaining({
                adsenseAccountId: 'accounts/pub-2',
            }));
        });

        it('errors when the account has no publisher accounts', async () => {
            mockAdsenseApi.accounts.list.mockResolvedValue({ data: { accounts: [] } } as any);

            await configureAdSense(emptyStatus);

            expect(shared.printError).toHaveBeenCalledWith(expect.stringContaining('No AdSense publisher accounts'));
            expect(config.updateAccount).not.toHaveBeenCalled();
        });

        it('does not save when verification report fails', async () => {
            mockAdsenseApi.accounts.reports.generate.mockRejectedValue(new Error('forbidden'));

            await configureAdSense(emptyStatus);

            expect(shared.printError).toHaveBeenCalledWith(expect.stringContaining('forbidden'));
            expect(config.updateAccount).not.toHaveBeenCalled();
        });

        it('lists existing accounts and exits when reconfigure declined', async () => {
            vi.mocked(config.loadConfig).mockResolvedValue({
                accounts: {
                    a1: { id: 'a1', engine: 'adsense', alias: 'mine', adsenseAccountId: 'accounts/pub-9' },
                },
            } as any);
            driver.confirmResponses = [false];

            await configureAdSense({
                ...emptyStatus,
                adsenseAccounts: [{ id: 'a1', engine: 'adsense', alias: 'mine', adsenseAccountId: 'accounts/pub-9' }],
            } as any);

            expect(googleClient.startLocalFlow).not.toHaveBeenCalled();
            expect(config.updateAccount).not.toHaveBeenCalled();
        });
    });
});
