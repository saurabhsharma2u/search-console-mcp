import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the auth resolver used by tool modules
vi.mock('../src/common/auth/resolver.js', () => ({
    resolveSiteProperty: vi.fn().mockResolvedValue({ siteUrl: 'https://example.com' }),
}));

// Mock the Google client module: capture which scoped entrypoint each
// handler uses, and replay a Google insufficient-scope failure on demand.
const mocks = vi.hoisted(() => {
    const err = new Error('Request had insufficient authentication scopes.');
    return {
        getWriteSession: vi.fn(),
        getSearchConsoleClient: vi.fn(),
        resolveIndexingAccount: vi.fn(),
        getIndexingClient: vi.fn(),
        failWith: err,
    };
});

vi.mock('../src/google/client.js', () => ({
    getWriteSession: mocks.getWriteSession,
    getSearchConsoleClient: mocks.getSearchConsoleClient,
    resolveIndexingAccount: mocks.resolveIndexingAccount,
    getIndexingClient: mocks.getIndexingClient,
    invalidateScopedClients: vi.fn(),
}));

import { submitSitemap, deleteSitemap, listSitemaps } from '../src/google/tools/sitemaps.js';
import { addSite, deleteSite, listSites } from '../src/google/tools/sites.js';
import { MissingScopeError } from '../src/common/auth/scope-error.js';

beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWriteSession.mockReset();
    mocks.failWith = new Error('Request had insufficient authentication scopes.');
});

describe('mutation tools use the write-scoped client (issue #113)', () => {
    it('sitemaps_submit routes through getWriteSession and surfaces scope errors', async () => {
        const submit = vi.fn().mockRejectedValue(new Error('Request had insufficient authentication scopes.'));
        mocks.getWriteSession.mockResolvedValue({ client: { sitemaps: { submit } }, accountId: 'google_42' });

        await expect(submitSitemap('https://example.com', 'https://example.com/sitemap.xml'))
            .rejects.toBeInstanceOf(MissingScopeError);

        expect(mocks.getWriteSession).toHaveBeenCalledWith('https://example.com');
        expect(submit).toHaveBeenCalledWith({
            siteUrl: 'https://example.com',
            feedpath: 'https://example.com/sitemap.xml',
        });
        const caught = await submitSitemap('https://example.com', 'x.xml').catch((e) => e);
        expect((caught as MissingScopeError).accountId).toBe('google_42');
    });

    it('rejects non-scope errors untouched', async () => {
        const submit = vi.fn().mockRejectedValue(new Error('Property not found'));
        mocks.getWriteSession.mockResolvedValue({ client: { sitemaps: { submit } }, accountId: 'google_42' });

        await expect(submitSitemap('https://example.com', 'x.xml')).rejects.toThrow('Property not found');
    });

    it('sitemaps_delete and sites add/delete follow the same pattern', async () => {
        const del = vi.fn().mockResolvedValue(undefined);
        mocks.getWriteSession.mockResolvedValue({ client: { sitemaps: { delete: del }, sites: { add: vi.fn(), delete: vi.fn() } }, accountId: 'a' });

        await deleteSitemap('https://example.com', 's.xml');
        expect(del).toHaveBeenCalled();
    });

    it('successful mutations return the success message', async () => {
        const submit = vi.fn().mockResolvedValue(undefined);
        mocks.getWriteSession.mockResolvedValue({ client: { sitemaps: { submit } }, accountId: 'google_9' });

        const message = await submitSitemap('https://example.com', 'sitemap.xml');
        expect(message).toContain('Successfully submitted sitemap');
    });

    it('read tools stay on the read-only client', async () => {
        mocks.getSearchConsoleClient.mockResolvedValue({
            sitemaps: { list: vi.fn().mockResolvedValue({ data: { sitemap: [] } }) },
            sites: { list: vi.fn().mockResolvedValue({ data: { siteEntry: [] } }) },
        });

        await listSitemaps('https://example.com');
        await listSites();
        expect(mocks.getSearchConsoleClient).toHaveBeenCalled();
        expect(mocks.getWriteSession).not.toHaveBeenCalled();
    });
});
