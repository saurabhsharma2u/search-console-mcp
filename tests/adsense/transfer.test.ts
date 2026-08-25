import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScriptedDriver } from '../helpers/scripted-driver.js';

const { mockAdsenseApi, oauthInstances } = vi.hoisted(() => ({
    mockAdsenseApi: {
        accounts: {
            list: vi.fn(),
            reports: { generate: vi.fn() },
        },
    },
    oauthInstances: [] as any[],
}));

vi.mock('../../src/common/auth/config.js', () => ({
    loadConfig: vi.fn(),
    updateAccount: vi.fn(),
    saveConfig: vi.fn(),
    AccountConfig: {},
    assertServiceAccountKeyReadable: vi.fn(),
    isServiceAccountKeyMissing: vi.fn(() => false),
}));

vi.mock('../../src/google/client.js', () => ({
    startLocalFlow: vi.fn(),
    getUserEmail: vi.fn(),
    loadTokensForAccount: vi.fn(),
    saveTokensForAccount: vi.fn(),
    DEFAULT_CLIENT_ID: 'mock-id',
    DEFAULT_CLIENT_SECRET: 'mock-secret',
}));

vi.mock('googleapis', () => ({
    google: {
        auth: {
            OAuth2: vi.fn(function (this: any) {
                const instance: any = {
                    credentials: {} as Record<string, any>,
                    setCredentials: vi.fn((c: any) => {
                        instance.credentials = { ...instance.credentials, ...c };
                    }),
                };
                oauthInstances.push(instance);
                return instance;
            }),
        },
        adsense: vi.fn(() => mockAdsenseApi),
        oauth2: vi.fn(function () {
            const inst = oauthInstances[oauthInstances.length - 1];
            return {
                userinfo: {
                    get: vi.fn(async () => {
                        // Simulate the library refreshing credentials on the client instance.
                        inst.credentials.access_token = 'fresh-access';
                        inst.credentials.expiry_date = Date.now() + 3_600_000;
                        return { data: { email: 'user@test.com' } };
                    }),
                },
            };
        }),
    },
}));

vi.mock('../../src/utils/ui.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/utils/ui.js')>();
    return {
        ...actual,
        log: vi.fn(),
        printError: vi.fn(),
        printSuccess: vi.fn(),
        printInfo: vi.fn(),
    };
});

import * as config from '../../src/common/auth/config.js';
import * as googleClient from '../../src/google/client.js';
import * as ui from '../../src/utils/ui.js';
import { runExport, runImport } from '../../src/adsense/transfer.js';
import { prompts, setPromptDriver } from '../../src/utils/prompts.js';

const adsenseAccount = (overrides: Partial<any> = {}) => ({
    id: 'adsense_1',
    engine: 'adsense',
    alias: 'My AdSense',
    adsenseAccountId: 'accounts/pub-123',
    ...overrides,
});

describe('adsense-export', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setPromptDriver(new ScriptedDriver() as any);
        delete process.env.GOOGLE_CLIENT_ID;
        delete process.env.GOOGLE_CLIENT_SECRET;
    });

    it('returns 1 when no AdSense account is configured', async () => {
        vi.mocked(config.loadConfig).mockResolvedValue({ accounts: {} } as any);

        expect(await runExport([])).toBe(1);
        expect(ui.printError).toHaveBeenCalledWith(expect.stringContaining('No AdSense account configured'));
    });

    it('prints a ready-to-run import command for a single account', async () => {
        vi.mocked(config.loadConfig).mockResolvedValue({ accounts: { adsense_1: adsenseAccount() } } as any);
        vi.mocked(googleClient.loadTokensForAccount).mockResolvedValue({ refresh_token: 'rt_abc' } as any);

        expect(await runExport([])).toBe(0);
        const logged = vi.mocked(ui.log).mock.calls.map(c => c.join(' ')).join('\n');
        expect(logged).toContain("adsense-import");
        expect(logged).toContain("--token='rt_abc'");
        expect(logged).toContain("--publisher-id='accounts/pub-123'");
    });

    it('fails with re-setup guidance when no refresh token exists', async () => {
        vi.mocked(config.loadConfig).mockResolvedValue({ accounts: { adsense_1: adsenseAccount() } } as any);
        vi.mocked(googleClient.loadTokensForAccount).mockResolvedValue(null as any);

        expect(await runExport([])).toBe(1);
        expect(ui.printError).toHaveBeenCalledWith(expect.stringContaining('No OAuth refresh token stored'));
        expect(vi.mocked(ui.log).mock.calls.map(c => String(c[0])).join()).toContain('setup --engine=adsense');
    });

    it('selects by alias or id via --account', async () => {
        vi.mocked(config.loadConfig).mockResolvedValue({
            accounts: {
                a: adsenseAccount({ id: 'a', alias: 'One', adsenseAccountId: 'accounts/pub-1' }),
                b: adsenseAccount({ id: 'b', alias: 'Two', adsenseAccountId: 'accounts/pub-2' }),
            },
        } as any);
        vi.mocked(googleClient.loadTokensForAccount).mockImplementation(async (acct: any) =>
            ({ refresh_token: `token-for-${acct.id}` }) as any);

        expect(await runExport(['--account=b'])).toBe(0);
        expect(googleClient.loadTokensForAccount).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
        const logged = vi.mocked(ui.log).mock.calls.map(c => c.join(' ')).join('\n');
        expect(logged).toContain('--token=\'token-for-b\'');
    });

    it('errors on unknown --account value', async () => {
        vi.mocked(config.loadConfig).mockResolvedValue({ accounts: { adsense_1: adsenseAccount() } } as any);

        expect(await runExport(['--account=nope'])).toBe(1);
        expect(ui.printError).toHaveBeenCalledWith(expect.stringContaining('"nope" not found'));
    });

    it('warns when a custom OAuth client is configured', async () => {
        process.env.GOOGLE_CLIENT_ID = 'custom-id';
        vi.mocked(config.loadConfig).mockResolvedValue({ accounts: { adsense_1: adsenseAccount() } } as any);
        vi.mocked(googleClient.loadTokensForAccount).mockResolvedValue({ refresh_token: 'rt' } as any);

        await runExport([]);
        expect(ui.printInfo).toHaveBeenCalledWith(expect.stringContaining('GOOGLE_CLIENT_ID'));
    });
});

describe('adsense-import', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        oauthInstances.length = 0;
        setPromptDriver(new ScriptedDriver() as any);
    });

    it('validates the token, auto-detects a single publisher, and persists an account', async () => {
        vi.mocked(config.loadConfig).mockResolvedValue({ accounts: {} } as any);
        vi.mocked(googleClient.getUserEmail).mockResolvedValue('user@test.com');
        mockAdsenseApi.accounts.list.mockResolvedValue({
            data: { accounts: [{ name: 'accounts/pub-123', displayName: 'My Site' }] },
        });
        mockAdsenseApi.accounts.reports.generate.mockResolvedValue({ data: {} });

        expect(await runImport(['--token=rt_valid'])).toBe(0);

        expect(googleClient.getUserEmail).toHaveBeenCalledWith({ refresh_token: 'rt_valid' });
        expect(mockAdsenseApi.accounts.list).toHaveBeenCalled();
        expect(mockAdsenseApi.accounts.reports.generate).toHaveBeenCalledWith(
            expect.objectContaining({ account: 'accounts/pub-123', dateRange: 'LAST_7_DAYS' })
        );
        expect(googleClient.saveTokensForAccount).toHaveBeenCalledWith(
            expect.objectContaining({ engine: 'adsense', alias: 'user@test.com-adsense', adsenseAccountId: 'accounts/pub-123' }),
            expect.objectContaining({ refresh_token: 'rt_valid' })
        );
        expect(config.updateAccount).toHaveBeenCalledWith(
            expect.objectContaining({ id: expect.stringMatching(/^adsense_\d+$/) })
        );
        expect(ui.printSuccess).toHaveBeenCalledWith(expect.stringContaining('imported'));
    });

    it('prompts for the token when the flag is omitted', async () => {
        const driver = new ScriptedDriver();
        driver.textResponses.push('  pasted-token  ');
        setPromptDriver(driver as any);

        vi.mocked(config.loadConfig).mockResolvedValue({ accounts: {} } as any);
        vi.mocked(googleClient.getUserEmail).mockResolvedValue('user@test.com');
        mockAdsenseApi.accounts.list.mockResolvedValue({
            data: { accounts: [{ name: 'accounts/pub-1' }] },
        });
        mockAdsenseApi.accounts.reports.generate.mockResolvedValue({ data: {} });

        expect(await runImport([])).toBe(0);
        expect(googleClient.getUserEmail).toHaveBeenCalledWith({ refresh_token: 'pasted-token' });
    });

    it('returns 1 when Google rejects the token', async () => {
        vi.mocked(googleClient.getUserEmail).mockRejectedValue(new Error('invalid_grant'));

        expect(await runImport(['--token=bad'])).toBe(1);
        expect(ui.printError).toHaveBeenCalledWith(expect.stringContaining('Import failed'));
        expect(config.updateAccount).not.toHaveBeenCalled();
    });

    it('lists --publisher-id options when several publishers exist non-interactively', async () => {
        vi.mocked(googleClient.getUserEmail).mockResolvedValue('user@test.com');
        mockAdsenseApi.accounts.list.mockResolvedValue({
            data: { accounts: [{ name: 'accounts/pub-1' }, { name: 'accounts/pub-2' }] },
        });

        expect(await runImport(['--token=rt'])).toBe(1);
        expect(ui.printError).toHaveBeenCalledWith(expect.stringContaining('specify one'));
        const logged = vi.mocked(ui.log).mock.calls.map(c => c.join(' ')).join('\n');
        expect(logged).toContain('--publisher-id=accounts/pub-1');
        expect(logged).toContain('--publisher-id=accounts/pub-2');
        expect(config.updateAccount).not.toHaveBeenCalled();
    });

    it('skips publisher detection when --publisher-id is given', async () => {
        vi.mocked(config.loadConfig).mockResolvedValue({ accounts: {} } as any);
        vi.mocked(googleClient.getUserEmail).mockResolvedValue('user@test.com');
        mockAdsenseApi.accounts.reports.generate.mockResolvedValue({ data: {} });

        expect(await runImport(['--token=rt', '--publisher-id=accounts/pub-9'])).toBe(0);
        expect(mockAdsenseApi.accounts.list).not.toHaveBeenCalled();
        expect(config.updateAccount).toHaveBeenCalledWith(
            expect.objectContaining({ adsenseAccountId: 'accounts/pub-9' })
        );
    });

    it('updates the existing entry instead of duplicating a known publisher ID', async () => {
        vi.mocked(config.loadConfig).mockResolvedValue({
            accounts: { adsense_42: adsenseAccount({ id: 'adsense_42', alias: 'Old Name' }) },
        } as any);
        vi.mocked(googleClient.getUserEmail).mockResolvedValue('user@test.com');
        mockAdsenseApi.accounts.list.mockResolvedValue({
            data: { accounts: [{ name: 'accounts/pub-123' }] },
        });
        mockAdsenseApi.accounts.reports.generate.mockResolvedValue({ data: {} });

        expect(await runImport(['--token=rt'])).toBe(0);

        expect(config.updateAccount).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'adsense_42', adsenseAccountId: 'accounts/pub-123' })
        );
        expect(ui.printSuccess).toHaveBeenCalledWith(expect.stringContaining('Updated'));
    });

    it('honors a custom alias via --alias', async () => {
        vi.mocked(config.loadConfig).mockResolvedValue({ accounts: {} } as any);
        vi.mocked(googleClient.getUserEmail).mockResolvedValue('user@test.com');
        mockAdsenseApi.accounts.list.mockResolvedValue({
            data: { accounts: [{ name: 'accounts/pub-5' }] },
        });
        mockAdsenseApi.accounts.reports.generate.mockResolvedValue({ data: {} });

        expect(await runImport(['--token=rt', '--alias=my-blog'])).toBe(0);
        expect(config.updateAccount).toHaveBeenCalledWith(
            expect.objectContaining({ alias: 'my-blog' })
        );
    });
});
