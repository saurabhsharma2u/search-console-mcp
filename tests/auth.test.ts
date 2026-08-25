import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadTokensForAccount, saveTokensForAccount, logout, getUserEmail } from '../src/google/client.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { AccountConfig } from '../src/common/auth/config.js';

// Mock fs
vi.mock('fs', () => ({
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
}));

// Mock node-machine-id
vi.mock('node-machine-id', () => ({
    default: {
        machineIdSync: vi.fn(() => 'test-machine-id'),
    }
}));

// Mock common/auth/config.js to avoid encryption issues in these tests
vi.mock('../src/common/auth/config.js', async () => {
    const actual = await vi.importActual('../src/common/auth/config.js');
    return {
        ...actual as any,
        loadConfig: vi.fn().mockResolvedValue({ accounts: {} }),
        updateAccount: vi.fn().mockResolvedValue(undefined),
        removeAccount: vi.fn().mockResolvedValue(undefined),
    };
});

// Mock @napi-rs/keyring
const mockDeletePassword = vi.fn();
const mockGetPassword = vi.fn();
const mockSetPassword = vi.fn();

vi.mock('@napi-rs/keyring', () => ({
    Entry: function () {
        return {
            deletePassword: mockDeletePassword,
            getPassword: mockGetPassword,
            setPassword: mockSetPassword,
        };
    },
}));

// Mock googleapis
const mockSetCredentials = vi.fn();
const mockUserInfoGet = vi.fn().mockResolvedValue({ data: { email: 'test@example.com' } });

vi.mock('googleapis', () => {
    return {
        google: {
            auth: {
                OAuth2: function () {
                    return {
                        setCredentials: mockSetCredentials,
                    };
                },
            },
            oauth2: vi.fn().mockImplementation(() => ({
                userinfo: {
                    get: mockUserInfoGet,
                },
            })),
            searchconsole: vi.fn(),
        },
    };
});

describe('Authentication & Security (Multi-Account)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const mockAccount: AccountConfig = {
        id: 'google_test',
        engine: 'google',
        alias: 'test@example.com'
    };

    it('should save tokens to keychain and update config', async () => {
        const tokens = { refresh_token: 'test-refresh', expiry_date: 12345 };

        await saveTokensForAccount(mockAccount, tokens);

        // Check Keychain
        expect(mockSetPassword).toHaveBeenCalled();
        const callValue = mockSetPassword.mock.calls[0][0];
        expect(JSON.parse(callValue)).toMatchObject({ refresh_token: 'test-refresh' });

        // Check that config update was called
        const { updateAccount } = await import('../src/common/auth/config.js');
        expect(updateAccount).toHaveBeenCalledWith(expect.objectContaining({
            id: 'google_test',
            tokens: expect.objectContaining({ refresh_token: 'test-refresh' })
        }));
    });

    it('should load tokens from keychain if available', async () => {
        const tokens = { refresh_token: 'keychain-refresh' };
        mockGetPassword.mockResolvedValue(JSON.stringify(tokens));

        const result = await loadTokensForAccount(mockAccount);

        expect(result).toMatchObject(tokens);
        expect(mockGetPassword).toHaveBeenCalled();
    });

    it('should fallback to tokens in account config if keychain fails', async () => {
        mockGetPassword.mockRejectedValue(new Error('Keychain error'));

        const accountWithTokens: AccountConfig = {
            ...mockAccount,
            tokens: { refresh_token: 'config-refresh' }
        };

        const result = await loadTokensForAccount(accountWithTokens);
        expect(result).toMatchObject({ refresh_token: 'config-refresh' });
    });

    it('should delete tokens on logout', async () => {
        const { loadConfig, removeAccount } = await import('../src/common/auth/config.js');
        vi.mocked(loadConfig).mockResolvedValue({
            accounts: {
                'google_test': mockAccount
            }
        });

        await logout('google_test');

        expect(mockDeletePassword).toHaveBeenCalled();
        expect(removeAccount).toHaveBeenCalledWith('google_test');
    });

    it('should resolve logout by alias (case-insensitive)', async () => {
        const { loadConfig, removeAccount } = await import('../src/common/auth/config.js');
        vi.mocked(loadConfig).mockResolvedValue({
            accounts: {
                'google_test': mockAccount
            }
        });

        await logout('TEST@EXAMPLE.COM');

        expect(mockDeletePassword).toHaveBeenCalled();
        expect(removeAccount).toHaveBeenCalledWith('google_test');
    });

    it('should throw when no account matches the logout identifier', async () => {
        const { loadConfig, removeAccount } = await import('../src/common/auth/config.js');
        vi.mocked(loadConfig).mockResolvedValue({ accounts: {} });

        await expect(logout('ghost@example.com')).rejects.toThrow(/No account found matching "ghost@example\.com"/);
        expect(mockDeletePassword).not.toHaveBeenCalled();
        expect(removeAccount).not.toHaveBeenCalled();
    });

    it('should require an account identifier', async () => {
        const { removeAccount } = await import('../src/common/auth/config.js');
        await expect(logout()).rejects.toThrow(/Specify an account/);
        expect(removeAccount).not.toHaveBeenCalled();
    });

    it('should still remove the account when keychain deletion fails', async () => {
        const { loadConfig, removeAccount } = await import('../src/common/auth/config.js');
        vi.mocked(loadConfig).mockResolvedValue({
            accounts: {
                'google_test': mockAccount
            }
        });
        mockDeletePassword.mockRejectedValue(new Error('Keychain unavailable'));

        await expect(logout('google_test')).resolves.toBeUndefined();

        expect(removeAccount).toHaveBeenCalledWith('google_test');
    });

    it('should fetch user email', async () => {
        const email = await getUserEmail({ access_token: 'abc' });
        expect(email).toBe('test@example.com');
    });
});
