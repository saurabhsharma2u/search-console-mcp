import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BingClient, getBingClient } from '../src/bing/client.js';
import * as configModule from '../src/common/auth/config.js';
import * as resolverModule from '../src/common/auth/resolver.js';

// Mock dependencies
vi.mock('../src/common/auth/config.js', () => ({
    assertServiceAccountKeyReadable: vi.fn(),
    isServiceAccountKeyMissing: vi.fn(() => false),
    loadConfig: vi.fn(),
}));

vi.mock('../src/common/auth/resolver.js', () => ({
    resolveAccount: vi.fn(),
}));

const fetchMock = vi.fn();
global.fetch = fetchMock as any;

describe('Bing Client', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        fetchMock.mockReset();
    });

    describe('BingClient Class', () => {
        const apiKey = 'test-api-key';
        const client = new BingClient(apiKey);
        const siteUrl = 'https://example.com';

        it('should make GET request correctly', async () => {
            fetchMock.mockResolvedValue({
                ok: true,
                json: async () => ({ d: 'success' }),
            });

            const result = await client.getSiteList();

            expect(result).toBe('success');
            expect(fetchMock).toHaveBeenCalledWith(
                expect.stringContaining('GetUserSites?apikey=test-api-key'),
                expect.objectContaining({ method: 'GET' })
            );
        });

        it('should make POST request correctly', async () => {
            fetchMock.mockResolvedValue({
                ok: true,
                json: async () => ({ d: null }),
            });

            await client.addSite(siteUrl);

            expect(fetchMock).toHaveBeenCalledWith(
                expect.stringContaining('AddSite?apikey=test-api-key'),
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({ siteUrl })
                })
            );
        });

        it('should handle API errors', async () => {
            fetchMock.mockResolvedValue({
                ok: false,
                status: 500,
                text: async () => 'Internal Server Error',
            });

            await expect(client.getSiteList()).rejects.toThrow('Bing API error (GetUserSites): 500 Internal Server Error');
        });

        it('should return data directly if "d" property is missing', async () => {
            fetchMock.mockResolvedValue({
                ok: true,
                json: async () => ({ some: 'data' }),
            });

            const result = await client.getSiteList();
            expect(result).toEqual({ some: 'data' });
        });

        // Method-specific tests to ensure they call the right endpoint with right params
        it('should call removeSite', async () => {
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({ d: null }) });
            await client.removeSite(siteUrl);
            expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('RemoveSite'), expect.anything());
        });

        it('should call getQueryStats', async () => {
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({ d: [] }) });
            await client.getQueryStats(siteUrl);
            expect(fetchMock).toHaveBeenCalledWith(
                expect.stringContaining(`GetQueryStats?apikey=${apiKey}&siteUrl=${encodeURIComponent(siteUrl)}`),
                expect.anything()
            );
        });

        it('should call getPageStats', async () => {
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({ d: [] }) });
            await client.getPageStats(siteUrl);
            expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('GetPageStats'), expect.anything());
        });

        it('should call getPageQueryStats', async () => {
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({ d: [] }) });
            await client.getPageQueryStats(siteUrl, 'page1');
            expect(fetchMock).toHaveBeenCalledWith(
                expect.stringContaining(`GetPageQueryStats?apikey=${apiKey}&siteUrl=${encodeURIComponent(siteUrl)}&page=page1`),
                expect.anything()
            );
        });

        it('should call submitSitemap', async () => {
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({ d: null }) });
            await client.submitSitemap(siteUrl, 'feedUrl');
            expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('SubmitFeed'), expect.anything());
        });

        it('should call deleteSitemap', async () => {
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({ d: null }) });
            await client.deleteSitemap(siteUrl, 'feedUrl');
            expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('RemoveFeed'), expect.anything());
        });

        it('should call getFeeds', async () => {
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({ d: [] }) });
            await client.getFeeds(siteUrl);
            expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('GetFeeds'), expect.anything());
        });

        it('should call getKeywordStats', async () => {
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({ d: [] }) });
            await client.getKeywordStats('query');
            expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('GetKeywordStats'), expect.anything());
        });

        it('should call getCrawlIssues', async () => {
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({ d: [] }) });
            await client.getCrawlIssues(siteUrl);
            expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('GetCrawlIssues'), expect.anything());
        });

        it('should call getUrlSubmissionQuota', async () => {
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({ d: {} }) });
            await client.getUrlSubmissionQuota(siteUrl);
            expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('GetUrlSubmissionQuota'), expect.anything());
        });

        it('should call submitUrl', async () => {
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({ d: null }) });
            await client.submitUrl(siteUrl, 'url');
            expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('SubmitUrl'), expect.anything());
        });

        it('should call submitUrlBatch', async () => {
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({ d: null }) });
            await client.submitUrlBatch(siteUrl, ['url1']);
            expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('SubmitUrlBatch'), expect.anything());
        });

        it('should call getQueryPageStats', async () => {
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({ d: [] }) });
            await client.getQueryPageStats(siteUrl);
            expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('GetQueryPageStats'), expect.anything());
        });

        it('should call getRankAndTrafficStats', async () => {
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({ d: [] }) });
            await client.getRankAndTrafficStats(siteUrl);
            expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('GetRankAndTrafficStats'), expect.anything());
        });

        it('should call getCrawlStats', async () => {
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({ d: [] }) });
            await client.getCrawlStats(siteUrl);
            expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('GetCrawlStats'), expect.anything());
        });

        it('should call getUrlInfo', async () => {
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({ d: {} }) });
            await client.getUrlInfo(siteUrl, 'url');
            expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('GetUrlInfo'), expect.anything());
        });

        it('should call getLinkCounts', async () => {
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({ d: [] }) });
            await client.getLinkCounts(siteUrl);
            expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('GetLinkCounts'), expect.anything());
        });

        it('should call getRelatedKeywords', async () => {
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({ d: [] }) });
            await client.getRelatedKeywords('query');
            expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('GetRelatedKeywords'), expect.anything());
        });
    });

    describe('getBingClient', () => {
        beforeEach(() => {
            delete process.env.BING_API_KEY;
        });

        it('should resolve account by ID', async () => {
            const accountId = 'bing_123';
            vi.mocked(configModule.loadConfig).mockResolvedValue({
                accounts: {
                    [accountId]: {
                        id: accountId,
                        engine: 'bing',
                        alias: 'test',
                        apiKey: 'api-key-from-config'
                    }
                }
            });

            const client = await getBingClient(undefined, accountId);
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({ d: [] }) });
            await client.getSiteList();
            expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('apikey=api-key-from-config'), expect.anything());
        });

        it('should throw if account ID not found', async () => {
            vi.mocked(configModule.loadConfig).mockResolvedValue({ accounts: {} });
            await expect(getBingClient(undefined, 'non-existent')).rejects.toThrow('Bing account non-existent not found.');
        });

        it('should resolve account by site URL', async () => {
            vi.mocked(resolverModule.resolveAccount).mockResolvedValue({
                id: 'bing_resolved',
                engine: 'bing',
                alias: 'test',
                apiKey: 'api-key-resolved'
            });

            const client = await getBingClient('https://resolved.com');
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({ d: [] }) });
            await client.getSiteList();

            expect(resolverModule.resolveAccount).toHaveBeenCalledWith('https://resolved.com', 'bing');
            expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('apikey=api-key-resolved'), expect.anything());
        });

        it('should fallback to env var if resolution fails', async () => {
            vi.mocked(resolverModule.resolveAccount).mockRejectedValue(new Error('Resolution failed'));
            process.env.BING_API_KEY = 'env-api-key';

            const client = await getBingClient('https://fallback.com');
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({ d: [] }) });
            await client.getSiteList();
            expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('apikey=env-api-key'), expect.anything());
        });

        it('should throw if resolution fails and no env var', async () => {
            vi.mocked(resolverModule.resolveAccount).mockRejectedValue(new Error('Resolution failed'));
            delete process.env.BING_API_KEY;

            await expect(getBingClient('https://fail.com')).rejects.toThrow('Resolution failed');
        });

        it('should throw if resolved account has no API key', async () => {
             vi.mocked(resolverModule.resolveAccount).mockResolvedValue({
                id: 'bing_no_key',
                engine: 'bing',
                alias: 'test'
            });

            await expect(getBingClient('https://no-key.com')).rejects.toThrow('Bing API Key not found');
        });

        it('should return cached client', async () => {
            const accountId = 'bing_cached';
            vi.mocked(configModule.loadConfig).mockResolvedValue({
                accounts: {
                    [accountId]: {
                        id: accountId,
                        engine: 'bing',
                        alias: 'test',
                        apiKey: 'cached-key'
                    }
                }
            });

            const client1 = await getBingClient(undefined, accountId);
            const client2 = await getBingClient(undefined, accountId);
            expect(client1).toBe(client2);
        });
    });
});
