import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import { ScriptedDriver } from './helpers/scripted-driver.js';

// Define mocks hoisted
const { mockGClient, mockGoogleAuth, mockOAuth2, mockRl, MockBingClient } = vi.hoisted(() => {
    const mockGClient = {
        sites: {
            list: vi.fn().mockResolvedValue({ data: { siteEntry: [] } }),
            get: vi.fn().mockResolvedValue({ data: { siteUrl: 'https://site.com' } })
        }
    };

    const mockGoogleAuth = vi.fn(function () {
        return { getClient: vi.fn().mockResolvedValue({}) };
    });

    const mockOAuth2 = vi.fn(function () {
        return { setCredentials: vi.fn() };
    });

    const MockBingClient = vi.fn(function () {
        return { getSiteList: vi.fn().mockResolvedValue([]) };
    });

    const mockRl = {
        question: vi.fn(),
        close: vi.fn(),
        output: process.stdout,
        input: process.stdin
    };

    return { mockGClient, mockGoogleAuth, mockOAuth2, mockRl, MockBingClient };
});

// Mock dependencies
vi.mock('fs', () => ({
    existsSync: vi.fn(),
    statSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    chmodSync: vi.fn(),
}));

vi.mock('readline', () => ({
    createInterface: vi.fn(() => mockRl)
}));

vi.mock('../src/common/auth/config.js', () => ({
    assertServiceAccountKeyReadable: vi.fn(),
    isServiceAccountKeyMissing: vi.fn(() => false),
    loadConfig: vi.fn(),
    updateAccount: vi.fn(),
    saveConfig: vi.fn(),
    saveTokensForAccount: vi.fn(),
}));

vi.mock('../src/google/client.js', () => ({
    startLocalFlow: vi.fn(),
    getUserEmail: vi.fn(),
    getSearchConsoleClient: vi.fn(),
    logout: vi.fn(),
    saveTokensForAccount: vi.fn(),
    DEFAULT_CLIENT_ID: 'mock-id',
    DEFAULT_CLIENT_SECRET: 'mock-secret'
}));

vi.mock('../src/bing/client.js', () => ({
    getBingClient: vi.fn(),
    BingClient: MockBingClient
}));

vi.mock('googleapis', () => ({
    google: {
        auth: {
            GoogleAuth: mockGoogleAuth,
            OAuth2: mockOAuth2
        },
        searchconsole: vi.fn().mockReturnValue(mockGClient)
    }
}));

// Mock execSync
vi.mock('child_process', () => ({
    execSync: vi.fn()
}));

describe('Setup Full', () => {
    let setupModule: any;
    let configModule: any;
    let googleClient: any;
    let promptsModule: any;
    let driver: ScriptedDriver;
    const originalEnv = { ...process.env };
    const originalArgv = process.argv;

    beforeEach(async () => {
        vi.resetModules();
        vi.clearAllMocks();
        delete process.env.BING_API_KEY;

        mockGClient.sites.list.mockResolvedValue({ data: { siteEntry: [] } });

        setupModule = await import('../src/setup.js');
        configModule = await import('../src/common/auth/config.js');
        googleClient = await import('../src/google/client.js');
        promptsModule = await import('../src/utils/prompts.js');

        vi.mocked(configModule.loadConfig).mockResolvedValue({ accounts: {} });

        driver = new ScriptedDriver();
        promptsModule.setPromptDriver(driver);

        vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('Process.exit'); }) as any);
    });

    afterEach(() => {
        process.argv = originalArgv;
        process.env = { ...originalEnv };
        vi.restoreAllMocks();
    });

    describe('validateKeyFile', () => {
        it('should return null if file not found', () => {
            vi.mocked(fs.existsSync).mockReturnValue(false);
            const result = setupModule.validateKeyFile('missing.json');
            expect(result).toBeNull();
        });

        it('should return null if not a file', () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.statSync).mockReturnValue({ isFile: () => false } as any);
            const result = setupModule.validateKeyFile('dir');
            expect(result).toBeNull();
        });

        it('should return null if not .json', () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true } as any);
            const result = setupModule.validateKeyFile('file.txt');
            expect(result).toBeNull();
        });

        it('should return null if invalid JSON', () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true } as any);
            vi.mocked(fs.readFileSync).mockReturnValue('invalid');
            const result = setupModule.validateKeyFile('file.json');
            expect(result).toBeNull();
        });

        it('should return null if missing fields', () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true } as any);
            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ type: 'service_account' }));
            const result = setupModule.validateKeyFile('file.json');
            expect(result).toBeNull();
        });

        it('should return null if invalid type', () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true } as any);
            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
                type: 'user',
                project_id: 'p',
                private_key_id: 'k',
                private_key: 'pk',
                client_email: 'e',
                client_id: 'c',
                auth_uri: 'a',
                token_uri: 't'
            }));
            const result = setupModule.validateKeyFile('file.json');
            expect(result).toBeNull();
        });

        it('should return key if valid', () => {
            const validKey = {
                type: 'service_account',
                project_id: 'p',
                private_key_id: 'k',
                private_key: 'pk',
                client_email: 'e',
                client_id: 'c',
                auth_uri: 'a',
                token_uri: 't'
            };
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true } as any);
            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(validKey));
            const result = setupModule.validateKeyFile('file.json');
            expect(result).toEqual(validKey);
        });
    });

    describe('testConnection', () => {
        it('should return true on success', async () => {
            const result = await setupModule.testConnection('key.json');
            expect(result).toBe(true);
        });
    });

    describe('Interactive Flows', () => {
        it('should handle Bing setup flow', async () => {
            process.argv = ['node', 'setup.ts', '--engine=bing'];
            driver.textResponses = ['my-api-key'];
            driver.confirmResponses = [false]; // star ask

            await setupModule.main();

            expect(configModule.updateAccount).toHaveBeenCalledWith(expect.objectContaining({
                engine: 'bing',
                apiKey: 'my-api-key'
            }));
        });

        it('should handle Google Login flow', async () => {
            process.argv = ['node', 'setup.ts', '--engine=google'];
            driver.selectResponses = ['oauth'];
            driver.confirmResponses = [false, false]; // indexing scope, star ask
            driver.textResponses = ['my-google'];

            vi.mocked(googleClient.startLocalFlow).mockResolvedValue({ access_token: 'token' });
            vi.mocked(googleClient.getUserEmail).mockResolvedValue('user@test.com');

            mockGClient.sites.list.mockResolvedValue({
                data: { siteEntry: [{ siteUrl: 'https://site.com' }] }
            });

            await setupModule.main();

            expect(configModule.updateAccount).toHaveBeenCalledWith(expect.objectContaining({
                engine: 'google',
                alias: 'my-google'
            }));
            // Verify default scopes were used
            expect(googleClient.startLocalFlow).toHaveBeenCalledWith(
                expect.any(String),
                expect.any(String),
                expect.not.arrayContaining(['https://www.googleapis.com/auth/indexing'])
            );
        });

        it('should handle Google Login flow with Indexing scope', async () => {
            process.argv = ['node', 'setup.ts', '--engine=google'];
            driver.selectResponses = ['oauth'];
            driver.confirmResponses = [true, false]; // indexing scope, star ask
            driver.textResponses = ['my-google-indexing'];

            vi.mocked(googleClient.startLocalFlow).mockResolvedValue({ access_token: 'token' });
            vi.mocked(googleClient.getUserEmail).mockResolvedValue('user@test.com');

            mockGClient.sites.list.mockResolvedValue({
                data: { siteEntry: [{ siteUrl: 'https://site.com' }] }
            });

            await setupModule.main();

            expect(configModule.updateAccount).toHaveBeenCalledWith(expect.objectContaining({
                engine: 'google',
                alias: 'my-google-indexing'
            }));
            // Verify indexing scope was passed
            expect(googleClient.startLocalFlow).toHaveBeenCalledWith(
                expect.any(String),
                expect.any(String),
                expect.arrayContaining(['https://www.googleapis.com/auth/indexing'])
            );
        });

        it('should handle Google Service Account flow', async () => {
            process.argv = ['node', 'setup.ts', '--engine=google'];
            driver.selectResponses = ['sa']; // auth method
            driver.textResponses = ['key.json', '', 'sa-alias']; // key path, continue, alias
            driver.confirmResponses = [false]; // star ask

            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true } as any);
            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
                type: 'service_account',
                project_id: 'p',
                private_key_id: 'pkid',
                client_id: 'cid',
                auth_uri: 'https://auth',
                token_uri: 'https://token',
                client_email: 'sa@test.com',
                private_key: 'pk'
            }));

            await setupModule.main();

            expect(configModule.updateAccount).toHaveBeenCalledWith(expect.objectContaining({
                engine: 'google',
                alias: 'sa-alias',
                serviceAccountPath: expect.stringContaining('key.json')
            }));
        });

        it('should handle PageSpeed setup flow', async () => {
            process.argv = ['node', 'setup.ts', '--engine=pagespeed'];
            driver.textResponses = ['my-pagespeed-key'];

            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue('PAGESPEED_API_KEY=old-key');

            await setupModule.main();

            expect(fs.writeFileSync).toHaveBeenCalledWith(
                expect.stringContaining('.env'),
                expect.stringContaining('PAGESPEED_API_KEY=my-pagespeed-key'),
                { encoding: 'utf8', mode: 0o600 }
            );
            expect(fs.chmodSync).toHaveBeenCalledWith(expect.stringContaining('.env'), 0o600);
        });

        it('should handle main menu exit', async () => {
            process.argv = ['node', 'setup.ts'];
            driver.selectResponses = ['__exit'];

            await setupModule.main();

            expect(driver.received.some(r => r.startsWith('select:'))).toBe(true);
        });

        it('should error on unknown --engine flag', async () => {
            process.argv = ['node', 'setup.ts', '--engine=adsens'];

            await expect(setupModule.main()).rejects.toThrow('Process.exit');
        });
    });
});
