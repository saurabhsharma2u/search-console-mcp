import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPurgeStoredTokens } = vi.hoisted(() => ({
    mockPurgeStoredTokens: vi.fn(),
}));

vi.mock('../src/common/auth/config.js', async () => {
    const actual = await vi.importActual('../src/common/auth/config.js');
    return {
        ...actual as any,
        loadConfig: vi.fn(),
        removeAccount: vi.fn(),
        updateAccount: vi.fn(),
    };
});

vi.mock('../src/google/client.js', () => ({
    purgeStoredTokens: mockPurgeStoredTokens,
}));

import { loadConfig, removeAccount } from '../src/common/auth/config.js';
import { purgeStoredTokens } from '../src/google/client.js';
import { main } from '../src/accounts.js';

describe('accounts CLI: remove', () => {
    let logSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => { });
    });

    it('purges stored tokens before removing the account entry', async () => {
        const account = { id: 'adsense_1', engine: 'adsense', alias: 'Blog' };
        vi.mocked(loadConfig).mockResolvedValue({ accounts: { adsense_1: account } } as any);

        await main(['remove', '--account=Blog']);

        expect(purgeStoredTokens).toHaveBeenCalledWith(expect.objectContaining({ id: 'adsense_1' }));
        expect(removeAccount).toHaveBeenCalledWith('adsense_1');
        const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
        expect(output).toContain('"success": true');
    });

    it('reports unknown accounts without purging anything', async () => {
        vi.mocked(loadConfig).mockResolvedValue({ accounts: {} } as any);

        await main(['remove', '--account=ghost']);

        expect(purgeStoredTokens).not.toHaveBeenCalled();
        expect(removeAccount).not.toHaveBeenCalled();
        const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
        expect(output).toContain('Account not found');
    });

    it('purges tokens before dropping the config entry', async () => {
        const account = { id: 'bing_1', engine: 'bing', alias: 'Agency', apiKey: 'k' };
        vi.mocked(loadConfig).mockResolvedValue({ accounts: { bing_1: account } } as any);

        await main(['remove', '--account=bing_1']);

        expect(removeAccount).toHaveBeenCalledWith('bing_1');
        const purgeOrder = mockPurgeStoredTokens.mock.invocationCallOrder[0];
        const removeOrder = vi.mocked(removeAccount).mock.invocationCallOrder[0];
        expect(purgeOrder).toBeLessThan(removeOrder);
    });
});
