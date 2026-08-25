import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getSearchConsoleClient, startLocalFlow, initiateDeviceFlow, pollForTokens, loadTokensForAccount } from '../src/google/client.js';
import * as configModule from '../src/common/auth/config.js';
import * as resolverModule from '../src/common/auth/resolver.js';

// Mock dependencies
vi.mock('../src/common/auth/config.js', () => ({
    assertServiceAccountKeyReadable: vi.fn(),
    isServiceAccountKeyMissing: vi.fn(() => false),
    loadConfig: vi.fn(),
    updateAccount: vi.fn(),
    saveTokensForAccount: vi.fn(),
}));

vi.mock('../src/common/auth/resolver.js', () => ({
    resolveAccount: vi.fn(),
}));

const mockSearchConsole = vi.fn();

const { MockOAuth2, MockGoogleAuth, MockJWT, mockOAuth2Client } = vi.hoisted(() => {
    const mockOAuth2Client = {
        setCredentials: vi.fn(),
        refreshAccessToken: vi.fn(),
        generateAuthUrl: vi.fn().mockReturnValue('http://auth-url'),
        getToken: vi.fn(),
    };
    return {
        MockOAuth2: vi.fn(function() { return mockOAuth2Client; }),
        MockGoogleAuth: vi.fn(function() { return { getClient: vi.fn() }; }),
        MockJWT: vi.fn(function() { return { authorize: vi.fn() }; }),
        mockOAuth2Client
    };
});

vi.mock('googleapis', () => ({
    google: {
        auth: {
            OAuth2: MockOAuth2,
            GoogleAuth: MockGoogleAuth,
            JWT: MockJWT,
        },
        searchconsole: vi.fn(() => mockSearchConsole),
        oauth2: vi.fn().mockReturnValue({ userinfo: { get: vi.fn() } })
    }
}));

vi.mock('@napi-rs/keyring', () => ({
    Entry: vi.fn().mockImplementation(() => ({
        getPassword: vi.fn().mockResolvedValue(null),
        setPassword: vi.fn(),
        deletePassword: vi.fn(),
    })),
}));

vi.mock('open', () => ({
    default: vi.fn(),
}));

const mockCreateServer = vi.fn();
vi.mock('http', () => ({
    createServer: mockCreateServer,
}));

const mockFetch = vi.fn();
global.fetch = mockFetch as any;

describe('Google Client', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFetch.mockReset();
        delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
        delete process.env.GOOGLE_CLIENT_EMAIL;
        delete process.env.GOOGLE_PRIVATE_KEY;
    });

    describe('getSearchConsoleClient', () => {
        it('should resolve account by ID and return client with tokens', async () => {
            const accountId = 'google_123';
            const tokens = { access_token: 'valid', expiry_date: Date.now() + 10000 };
            vi.mocked(configModule.loadConfig).mockResolvedValue({
                accounts: {
                    [accountId]: {
                        id: accountId,
                        engine: 'google',
                        alias: 'test',
                        tokens
                    }
                }
            });

            const client = await getSearchConsoleClient(undefined, accountId);
            expect(client).toBe(mockSearchConsole);
            expect(mockOAuth2Client.setCredentials).toHaveBeenCalledWith(tokens);
        });

        it('should throw if account ID not found', async () => {
            vi.mocked(configModule.loadConfig).mockResolvedValue({ accounts: {} });
            await expect(getSearchConsoleClient(undefined, 'non-existent')).rejects.toThrow('Account non-existent not found');
        });

        it('should return cached client', async () => {
            const accountId = 'google_cached';
            vi.mocked(configModule.loadConfig).mockResolvedValue({
                accounts: {
                    [accountId]: { id: accountId, engine: 'google', alias: 'cached', tokens: { access_token: 't' } }
                }
            });

            const client1 = await getSearchConsoleClient(undefined, accountId);
            const client2 = await getSearchConsoleClient(undefined, accountId);

            expect(client1).toBe(client2);
            expect(MockOAuth2).toHaveBeenCalledTimes(1);
        });

        it('should handle token usage failure and proceed', async () => {
            const accountId = 'google_broken_token';
            vi.mocked(configModule.loadConfig).mockResolvedValue({
                accounts: {
                    [accountId]: { id: accountId, engine: 'google', alias: 'broken', tokens: { access_token: 't' } }
                }
            });

            mockOAuth2Client.setCredentials.mockImplementationOnce(() => {
                throw new Error('Token invalid');
            });

            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            await expect(getSearchConsoleClient(undefined, accountId)).rejects.toThrow('Authentication required');
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to use tokens'), 'Token invalid');
        });

        it('should refresh tokens if expired', async () => {
            const accountId = 'google_expired';
            const tokens = { access_token: 'expired', expiry_date: Date.now() - 10000, refresh_token: 'refresh' };
            vi.mocked(configModule.loadConfig).mockResolvedValue({
                accounts: {
                    [accountId]: {
                        id: accountId,
                        engine: 'google',
                        alias: 'test',
                        tokens
                    }
                }
            });

            mockOAuth2Client.refreshAccessToken.mockResolvedValue({ credentials: { access_token: 'new' } });

            await getSearchConsoleClient(undefined, accountId);
            expect(mockOAuth2Client.refreshAccessToken).toHaveBeenCalled();
            expect(configModule.updateAccount).toHaveBeenCalled();
        });

        it('should use service account path if present', async () => {
            const accountId = 'google_sa';
            vi.mocked(configModule.loadConfig).mockResolvedValue({
                accounts: {
                    [accountId]: {
                        id: accountId,
                        engine: 'google',
                        alias: 'sa',
                        serviceAccountPath: '/path/to/sa.json'
                    }
                }
            });

            await getSearchConsoleClient(undefined, accountId);
            expect(MockGoogleAuth).toHaveBeenCalledWith(expect.objectContaining({
                keyFilename: '/path/to/sa.json'
            }));
        });

        it('should fallback to env vars if no account specified', async () => {
            process.env.GOOGLE_APPLICATION_CREDENTIALS = '/env/sa.json';

            vi.mocked(resolverModule.resolveAccount).mockResolvedValue({
                id: 'legacy_google',
                engine: 'google',
                alias: 'legacy',
            });

            await getSearchConsoleClient();
            expect(MockGoogleAuth).toHaveBeenCalled();
        });

        it('should fallback to JWT env vars if no account specified', async () => {
            process.env.GOOGLE_CLIENT_EMAIL = 'email@test.com';
            process.env.GOOGLE_PRIVATE_KEY = 'private-key';

            vi.mocked(resolverModule.resolveAccount).mockResolvedValue({
                id: 'legacy_jwt',
                engine: 'google',
                alias: 'legacy'
            });

            await getSearchConsoleClient();
            expect(MockJWT).toHaveBeenCalledWith(expect.objectContaining({
                email: 'email@test.com'
            }));
        });

        it('should call resolveAccount with siteUrl', async () => {
            const siteUrl = 'https://example.com';
            vi.mocked(resolverModule.resolveAccount).mockResolvedValue({
                id: 'google_123',
                engine: 'google',
                alias: 'test',
                tokens: { access_token: 'valid', expiry_date: Date.now() + 10000 }
            });
            vi.mocked(configModule.loadConfig).mockResolvedValue({ accounts: {} });

            await getSearchConsoleClient(siteUrl);

            expect(resolverModule.resolveAccount).toHaveBeenCalledWith(siteUrl, 'google');
        });

        it('should throw if authentication fails/missing', async () => {
            vi.mocked(resolverModule.resolveAccount).mockResolvedValue({
                id: 'none',
                engine: 'google',
                alias: 'none'
            });

            await expect(getSearchConsoleClient()).rejects.toThrow('Authentication required');
        });
    });

    describe('initiateDeviceFlow', () => {
        it('should make POST request and return device code', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: async () => ({ device_code: '123', user_code: '456' })
            });

            const result = await initiateDeviceFlow('client-id');
            expect(result).toEqual({ device_code: '123', user_code: '456' });
            expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('device/code'), expect.objectContaining({ method: 'POST' }));
        });

        it('should handle error', async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                text: async () => 'Error'
            });

            await expect(initiateDeviceFlow('client-id')).rejects.toThrow('Failed to initiate device flow');
        });
    });

    describe('pollForTokens', () => {
        it('should throw as it is deprecated', async () => {
            await expect(pollForTokens('id', 'secret', 'code', 1)).rejects.toThrow('Device Flow is not supported');
        });
    });

    describe('startLocalFlow', () => {
        beforeEach(() => {
            // Keep canOpenBrowser deterministic regardless of host env.
            // Linux CI runners have no DISPLAY, which would silently route
            // startLocalFlow into its headless branch.
            delete process.env.CI;
            delete process.env.NO_BROWSER;
            process.env.DISPLAY = ':0';
        });

        afterEach(() => {
            delete process.env.DISPLAY;
        });

        it('should start server and resolve on callback', async () => {
            const { default: open } = await import('open');

            let requestHandler: any;
            const mockServer: any = {
                close: vi.fn(),
                on: vi.fn(),
            };
            mockServer.listen = vi.fn().mockReturnValue(mockServer);

            mockCreateServer.mockImplementation((handler: any) => {
                requestHandler = handler;
                return mockServer;
            });

            mockOAuth2Client.getToken.mockResolvedValue({ tokens: { access_token: 'token' } });

            const promise = startLocalFlow('id', 'secret');

            await new Promise(resolve => setTimeout(resolve, 0));
            expect(requestHandler).toBeDefined();

            const req = { url: '/oauth2callback?code=auth_code', headers: { host: 'localhost:3000' } };
            const res = { writeHead: vi.fn(), end: vi.fn() };

            await requestHandler(req, res);

            const tokens = await promise;
            expect(tokens).toEqual({ access_token: 'token' });
            expect(mockServer.close).toHaveBeenCalled();
            expect(open).toHaveBeenCalled();
        });

        it('should not open a browser in headless mode but still resolve on callback', async () => {
            const { default: open } = await import('open');
            const errorSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            process.env.NO_BROWSER = '1';

            try {
                let requestHandler: any;
                const mockServer: any = { close: vi.fn(), on: vi.fn() };
                mockServer.listen = vi.fn().mockReturnValue(mockServer);

                mockCreateServer.mockImplementation((handler: any) => {
                    requestHandler = handler;
                    return mockServer;
                });
                mockOAuth2Client.getToken.mockResolvedValue({ tokens: { access_token: 'token' } });

                const promise = startLocalFlow('id', 'secret');
                await new Promise(resolve => setTimeout(resolve, 0));

                expect(open).not.toHaveBeenCalled();
                const logged = errorSpy.mock.calls.map(c => c.join(' ')).join('\n');
                expect(logged).toContain('No browser available');
                expect(logged).toContain('ssh -L 3000:localhost:3000');

                await requestHandler(
                    { url: '/oauth2callback?code=auth_code', headers: { host: 'localhost:3000' } },
                    { writeHead: vi.fn(), end: vi.fn() }
                );
                await expect(promise).resolves.toEqual({ access_token: 'token' });
            } finally {
                delete process.env.NO_BROWSER;
                errorSpy.mockRestore();
            }
        });

        it('should handle error in callback', async () => {
            let requestHandler: any;
            const mockServer: any = {
                close: vi.fn(),
                on: vi.fn(),
            };
            mockServer.listen = vi.fn().mockReturnValue(mockServer);

            mockCreateServer.mockImplementation((handler: any) => {
                requestHandler = handler;
                return mockServer;
            });

            mockOAuth2Client.getToken.mockRejectedValue(new Error('Auth failed'));

            const promise = startLocalFlow('id', 'secret');

            await new Promise(resolve => setTimeout(resolve, 0));
            expect(requestHandler).toBeDefined();

            const req = { url: '/oauth2callback?code=auth_code', headers: { host: 'localhost:3000' } };
            const res = { writeHead: vi.fn(), end: vi.fn() };

            await requestHandler(req, res);

            await expect(promise).rejects.toThrow('Auth failed');
            expect(res.writeHead).toHaveBeenCalledWith(500);
        });
    });
});
