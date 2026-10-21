import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the Google client pieces used by the reauth helper, keeping real
// constants overridden with deterministic test values.
vi.mock('../src/google/client.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...(actual as any),
        startLocalFlow: vi.fn().mockResolvedValue({ refresh_token: 'r2', expiry_date: 1 }),
        saveTokensForAccount: vi.fn(),
        invalidateScopedClients: vi.fn(),
        SCOPES: ['https://www.googleapis.com/auth/webmasters.readonly', 'https://www.googleapis.com/auth/userinfo.email'],
        DEFAULT_CLIENT_ID: 'cid',
        DEFAULT_CLIENT_SECRET: 'secret',
    };
});

// Mock config so loadConfig/updateAccount run without encryption/env deps
let storedAccounts: Record<string, any> = {};

vi.mock('../src/common/auth/config.js', () => ({
    loadConfig: vi.fn(() => Promise.resolve({ accounts: storedAccounts })),
    updateAccount: vi.fn((account: any) => {
        storedAccounts[account.id] = account;
        return Promise.resolve();
    }),
}));

import { prompts, setPromptDriver } from '../src/utils/prompts.js';
import { startLocalFlow, saveTokensForAccount, invalidateScopedClients } from '../src/google/client.js';
import { offerScopeReauth, upgradeAccountScopes } from '../src/common/auth/scope-reauth.js';
import { MissingScopeError } from '../src/common/auth/scope-error.js';

beforeEach(() => {
    vi.clearAllMocks();
    storedAccounts = {
        google_42: { id: 'google_42', engine: 'google', alias: 'me@example.com' },
    };
});

afterEach(() => setPromptDriver(null));

function scopeErr(capability: 'gsc_write' | 'indexing') {
    return new MissingScopeError(capability, 'google_42');
}

function withTTY<T>(fn: () => Promise<T>): Promise<T> {
    const original = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    return fn().finally(() => {
        if (original) Object.defineProperty(process.stdout, 'isTTY', original);
        else delete (process.stdout as any).isTTY;
    });
}

describe('offerScopeReauth (issue #113)', () => {
    it('declines gracefully in non-interactive mode without prompting browsers into being', async () => {
        // NonInteractiveDriver confirm -> initial value (false default from caller)
        const authorized = await offerScopeReauth(scopeErr('gsc_write'));
        expect(authorized).toBe(false);
        expect(startLocalFlow).not.toHaveBeenCalled();
    });

    it('refuses to re-auth when the error has no account id (env-based SA path)', async () => {
        const err = new MissingScopeError('gsc_write'); // no accountId
        const authorized = await offerScopeReauth(err);
        expect(authorized).toBe(false);
        expect(startLocalFlow).not.toHaveBeenCalled();
    });

    it('upgrades scopes inline when the user confirms, persisting tokens with the new grant', async () => {
        setPromptDriver({
            select: vi.fn(),
            multiselect: vi.fn(),
            text: vi.fn(),
            confirm: vi.fn().mockResolvedValue(true),
        } as any);

        // Google returns the granted scope list on consent — including scopes
        // granted under the old prompt, plus the newly requested one.
        (startLocalFlow as any).mockResolvedValue({
            refresh_token: 'r2',
            expiry_date: 1,
            scope: 'https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/webmasters',
        });

        const authorized = await withTTY(() => offerScopeReauth(scopeErr('gsc_write')));

        expect(authorized).toBe(true);
        expect(startLocalFlow).toHaveBeenCalledWith('cid', 'secret', [
            'https://www.googleapis.com/auth/webmasters.readonly',
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/webmasters',
        ]);
        // tokens (with the scope string) saved to the account that errored
        expect(saveTokensForAccount).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'google_42' }),
            expect.objectContaining({ scope: expect.stringContaining('webmasters') })
        );
        expect(invalidateScopedClients).toHaveBeenCalledWith('google_42');
    });
});

describe('upgradeAccountScopes', () => {
    it('throws an actionable error for unknown accounts', async () => {
        await expect(upgradeAccountScopes('google_missing', 'gsc_write'))
            .rejects.toThrow(/setup --engine=google/);
    });
});
