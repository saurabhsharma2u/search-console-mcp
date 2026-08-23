import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runLogout } from '../src/setup.js';
import * as googleClient from '../src/google/client.js';
import { ScriptedDriver } from './helpers/scripted-driver.js';

// Mock the google-client module
vi.mock('../src/google/client.js', () => ({
    logout: vi.fn(),
    startLocalFlow: vi.fn(),
    saveTokensForAccount: vi.fn(),
    getUserEmail: vi.fn(),
    DEFAULT_CLIENT_ID: 'mock-id',
    DEFAULT_CLIENT_SECRET: 'mock-secret'
}));

// Mock googleapis
vi.mock('googleapis', () => ({
    google: {
        auth: {
            OAuth2: class {
                setCredentials() { }
            }
        },
        searchconsole: vi.fn().mockReturnValue({
            sites: {
                list: vi.fn().mockResolvedValue({
                    data: { siteEntry: [{ siteUrl: 'https://test.com/' }] }
                })
            }
        })
    }
}));

// Mock the config module
vi.mock('../src/common/auth/config.js', () => ({
    assertServiceAccountKeyReadable: vi.fn(),
    isServiceAccountKeyMissing: vi.fn(() => false),
    loadConfig: vi.fn().mockResolvedValue({ accounts: {} }),
    updateAccount: vi.fn().mockResolvedValue(undefined),
    saveConfig: vi.fn().mockResolvedValue(undefined),
    removeAccount: vi.fn().mockResolvedValue(undefined),
}));

// Mock console.log/error to keep test output clean
const consoleSpy = {
    log: vi.spyOn(console, 'log').mockImplementation(() => { }),
    error: vi.spyOn(console, 'error').mockImplementation(() => { })
};

describe('CLI Commands', () => {
    let driver: ScriptedDriver;
    let promptsModule: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        // Reset process.argv
        process.argv = ['node', 'script'];

        promptsModule = await import('../src/utils/prompts.js');
        driver = new ScriptedDriver();
        promptsModule.setPromptDriver(driver);
    });

    describe('runLogout', () => {
        it('should logout with provided account ID', async () => {
            // Simulate CLI args: npx search-console-mcp logout google_id
            process.argv = ['node', 'script', 'logout', 'google_id'];
            await runLogout();
            expect(googleClient.logout).toHaveBeenCalledWith('google_id');
        });

        it('should handle logout errors gracefully', async () => {
            vi.mocked(googleClient.logout).mockRejectedValue(new Error('Keychain error'));
            await runLogout();
            expect(consoleSpy.error).toHaveBeenCalledWith(expect.stringContaining('Logout failed: Keychain error'));
        });
    });

    describe('login', () => {
        // Mock process.exit
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
            throw new Error(`Process.exit(${code})`);
        });

        it('should execute full login flow successfully', async () => {
            // Mock successfully 
            vi.mocked(googleClient.startLocalFlow).mockResolvedValue({ access_token: 'fake-token' });
            vi.mocked(googleClient.getUserEmail).mockResolvedValue('test@example.com');
            driver.confirmResponses = [false, false]; // indexing scope, star ask

            // Import login dynamically
            const { login } = await import('../src/setup.js');

            try {
                await login();
            } catch (e) {
                // Ignore rl.close error if any, or process.exit
            }

            expect(googleClient.startLocalFlow).toHaveBeenCalled();
            expect(googleClient.getUserEmail).toHaveBeenCalledWith(expect.objectContaining({ access_token: 'fake-token' }));
            expect(googleClient.saveTokensForAccount).toHaveBeenCalledWith(
                expect.objectContaining({ alias: 'test@example.com' }),
                expect.objectContaining({ access_token: 'fake-token' })
            );
            expect(consoleSpy.error).toHaveBeenCalledWith(expect.stringContaining('Successfully added account test@example.com!'));
        });

        it('should handle login failure', async () => {
            vi.mocked(googleClient.startLocalFlow).mockRejectedValue(new Error('Auth rejected'));
            driver.confirmResponses = [false]; // indexing scope prompt precedes auth

            const { login } = await import('../src/setup.js');

            await expect(login()).rejects.toThrow('Auth rejected');

            expect(consoleSpy.error).toHaveBeenCalledWith(expect.stringContaining('Authentication failed: Auth rejected'));
        });
    });
});
