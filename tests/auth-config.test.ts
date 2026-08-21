import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadConfig, saveConfig, updateAccount, removeAccount, AccountConfig, AppConfig, resetConfigCache } from '../src/common/auth/config.js';
import * as fs from 'fs';

// Mock dependencies
vi.mock('fs', () => ({
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
}));

vi.mock('node-machine-id', () => ({
    machineId: vi.fn().mockResolvedValue('test-machine-id'),
    default: {
        machineIdSync: vi.fn(() => 'test-machine-id'),
    }
}));

describe('Auth Config', () => {
    let mockFS: Record<string, string> = {};

    beforeEach(() => {
        resetConfigCache();
        vi.clearAllMocks();
        mockFS = {};
        delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
        delete process.env.GOOGLE_CLIENT_EMAIL;
        delete process.env.GOOGLE_PRIVATE_KEY;
        delete process.env.BING_API_KEY;

        vi.mocked(fs.existsSync).mockImplementation((p) => {
            const pathStr = p as string;
            return Object.keys(mockFS).some(k => pathStr.includes(k));
        });

        vi.mocked(fs.readFileSync).mockImplementation((p) => {
            const pathStr = p as string;
            const key = Object.keys(mockFS).find(k => pathStr.includes(k));
            if (key) return mockFS[key];
            throw new Error(`File not found: ${pathStr}`);
        });

        vi.mocked(fs.writeFileSync).mockImplementation((p, c) => {
            const pathStr = p as string;
            if (pathStr.includes('.search-console-mcp-config.enc')) {
                mockFS['config.enc'] = c as string;
            } else if (pathStr.includes('.search-console-mcp-tokens.enc')) {
                mockFS['tokens.enc'] = c as string;
            } else if (pathStr.includes('.search-console-mcp-tokens.json')) {
                mockFS['tokens.json'] = c as string;
            } else {
                mockFS[pathStr] = c as string;
            }
        });
    });

    const mockAccount: AccountConfig = {
        id: 'test_123',
        engine: 'google',
        alias: 'test'
    };

    const mockConfig: AppConfig = {
        accounts: {
            'test_123': mockAccount
        }
    };

    it('should save config encrypted', async () => {
        await saveConfig(mockConfig);

        expect(fs.writeFileSync).toHaveBeenCalled();
        expect(mockFS['config.enc']).toBeDefined();
        expect(mockFS['config.enc']).toContain(':');
    });

    it('should load config and decrypt it', async () => {
        await saveConfig(mockConfig);
        const config = await loadConfig();
        expect(config).toEqual(mockConfig);
    });

    it('should return empty config if file does not exist', async () => {
        const config = await loadConfig();
        expect(config).toEqual({ accounts: {} });
    });

    it('should handle corrupt config file', async () => {
        mockFS['config.enc'] = 'invalid-content';
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const config = await loadConfig();
        expect(config).toEqual({ accounts: {} });
        expect(consoleSpy).toHaveBeenCalled();
    });

    it('should migrate legacy Google tokens (encrypted file)', async () => {
        const legacyData = { 'test@example.com': { access_token: 'legacy' } };

        // Temporarily override writeFileSync to capture output
        let encryptedLegacy = '';
        const originalWrite = fs.writeFileSync;
        vi.mocked(fs.writeFileSync).mockImplementation((p, c) => {
             encryptedLegacy = c as string;
        });
        await saveConfig(legacyData as any);
        vi.mocked(fs.writeFileSync).mockImplementation(originalWrite as any);

        // Reset cache because saveConfig polluted it with legacy data structure
        resetConfigCache();

        mockFS = { 'tokens.enc': encryptedLegacy };
        delete mockFS['config.enc'];

        const config = await loadConfig();

        const accounts = Object.values(config.accounts);
        const acc = accounts.find(a => a.alias === 'test@example.com');
        expect(acc).toBeDefined();
        expect(acc?.tokens).toEqual({ access_token: 'legacy' });
        expect(acc?.isLegacy).toBe(true);
    });

    it('should migrate legacy env vars (Google Service Account)', async () => {
        process.env.GOOGLE_APPLICATION_CREDENTIALS = '/path/to/key.json';
        process.env.GOOGLE_CLIENT_EMAIL = 'sa@test.com';

        const config = await loadConfig();

        expect(config.accounts['legacy_google']).toBeDefined();
        expect(config.accounts['legacy_google'].serviceAccountPath).toBe('/path/to/key.json');
    });

    it('should migrate legacy env vars (Bing)', async () => {
        process.env.BING_API_KEY = 'bing-key';

        const config = await loadConfig();

        expect(config.accounts['legacy_bing']).toBeDefined();
        expect(config.accounts['legacy_bing'].apiKey).toBe('bing-key');
    });

    it('should migrate legacy JSON tokens', async () => {
        mockFS['tokens.json'] = JSON.stringify({
            refresh_token: 'rt',
            expiry_date: 123,
            access_token: 'at'
        });

        const config = await loadConfig();

        expect(config.accounts['legacy_google_oauth']).toBeDefined();
        expect(config.accounts['legacy_google_oauth'].tokens?.refresh_token).toBe('rt');
    });

    it('should update account', async () => {
        await saveConfig(mockConfig);

        const newAccount = { ...mockAccount, alias: 'updated' };
        await updateAccount(newAccount);

        const loaded = await loadConfig();
        expect(loaded.accounts['test_123'].alias).toBe('updated');
    });

    it('should remove account', async () => {
        await saveConfig(mockConfig);

        await removeAccount('test_123');

        const loaded = await loadConfig();
        expect(loaded.accounts['test_123']).toBeUndefined();
    });

    it('should throw error when saveConfig fails', async () => {
        vi.mocked(fs.writeFileSync).mockImplementation(() => {
            throw new Error('Write failed');
        });

        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await expect(saveConfig(mockConfig)).rejects.toThrow('Write failed');
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to save config'), 'Write failed');
    });

    it('should ignore corrupt legacy token file', async () => {
        mockFS['tokens.enc'] = 'corrupt';
        const config = await loadConfig();
        expect(config.accounts).toEqual({});
    });

    it('should ignore corrupt legacy JSON file', async () => {
        mockFS['tokens.json'] = 'corrupt-json';
        const config = await loadConfig();
        expect(config.accounts).toEqual({});
    });

    it('should cache config after loading from disk', async () => {
        await saveConfig(mockConfig);
        resetConfigCache(); // Clear cache to force load from disk

        // First load
        await loadConfig();
        expect(fs.readFileSync).toHaveBeenCalled();

        // Second load
        vi.mocked(fs.readFileSync).mockClear();
        const config = await loadConfig();
        expect(fs.readFileSync).not.toHaveBeenCalled();
        expect(config).toEqual(mockConfig);
    });
});
