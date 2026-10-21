import { describe, it, expect, vi, beforeEach } from 'vitest';
import { publishNotification, getNotificationStatus, batchPublishNotifications } from '../src/google/tools/indexing.js';

// Mock the Google client
vi.mock('../src/google/client.js', () => ({
    getIndexingClient: vi.fn().mockResolvedValue({
        getAccessToken: vi.fn().mockResolvedValue({ token: 'mock-token' })
    }),
    resolveIndexingAccount: vi.fn().mockResolvedValue({ id: 'account-1' })
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Google Indexing API', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('publishNotification', () => {
        it('should publish a URL_UPDATED notification', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    urlNotificationMetadata: {
                        url: 'https://example.com/page',
                        latestUpdate: {
                            url: 'https://example.com/page',
                            type: 'URL_UPDATED',
                            notifyTime: '2026-06-07T10:00:00Z'
                        }
                    }
                })
            });

            const result = await publishNotification(
                'https://example.com',
                'https://example.com/page',
                'URL_UPDATED'
            );

            expect(result.url).toBe('https://example.com/page');
            expect(result.type).toBe('URL_UPDATED');
            expect(result.notifyTime).toBe('2026-06-07T10:00:00Z');

            expect(mockFetch).toHaveBeenCalledWith(
                'https://indexing.googleapis.com/v3/urlNotifications:publish',
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({
                        'Authorization': 'Bearer mock-token',
                        'Content-Type': 'application/json'
                    }),
                    body: JSON.stringify({
                        url: 'https://example.com/page',
                        type: 'URL_UPDATED'
                    })
                })
            );
        });

        it('should publish a URL_DELETED notification', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    urlNotificationMetadata: {
                        url: 'https://example.com/expired-job',
                        latestRemove: {
                            url: 'https://example.com/expired-job',
                            type: 'URL_DELETED',
                            notifyTime: '2026-06-07T10:00:00Z'
                        }
                    }
                })
            });

            const result = await publishNotification(
                'https://example.com',
                'https://example.com/expired-job',
                'URL_DELETED'
            );

            expect(result.url).toBe('https://example.com/expired-job');
            expect(result.type).toBe('URL_DELETED');
        });

        it('should throw on API error', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 403,
                text: async () => 'Forbidden: insufficient permissions'
            });

            await expect(
                publishNotification('https://example.com', 'https://example.com/page', 'URL_UPDATED')
            ).rejects.toThrow('Google Indexing API error: 403');
        });
    });

    describe('getNotificationStatus', () => {
        it('should return notification metadata for a URL', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    url: 'https://example.com/page',
                    latestUpdate: {
                        url: 'https://example.com/page',
                        type: 'URL_UPDATED',
                        notifyTime: '2026-06-07T09:00:00Z'
                    },
                    latestRemove: null
                })
            });

            const result = await getNotificationStatus(
                'https://example.com',
                'https://example.com/page'
            );

            expect(result.url).toBe('https://example.com/page');
            expect(result.latestUpdate).toBeDefined();
            expect(result.latestUpdate?.type).toBe('URL_UPDATED');

            // Verify the URL was passed as a query param
            const calledUrl = mockFetch.mock.calls[0][0] as string;
            expect(calledUrl).toContain('url=');
            expect(calledUrl).toContain('example.com');
        });

        it('should throw on API error', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 404,
                text: async () => 'Not found'
            });

            await expect(
                getNotificationStatus('https://example.com', 'https://example.com/page')
            ).rejects.toThrow('Google Indexing API error: 404');
        });
    });

    describe('batchPublishNotifications', () => {
        it('should publish multiple URLs concurrently', async () => {
            const urls = [
                'https://example.com/page-1',
                'https://example.com/page-2',
                'https://example.com/page-3'
            ];

            // Each call to publishNotification triggers a fetch
            for (const url of urls) {
                mockFetch.mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({
                        urlNotificationMetadata: {
                            url,
                            latestUpdate: {
                                url,
                                type: 'URL_UPDATED',
                                notifyTime: '2026-06-07T10:00:00Z'
                            }
                        }
                    })
                });
            }

            const results = await batchPublishNotifications(
                'https://example.com',
                urls,
                'URL_UPDATED'
            );

            expect(results).toHaveLength(3);
            expect(results.every(r => r.result !== undefined)).toBe(true);
            expect(results.every(r => r.error === undefined)).toBe(true);
            expect(mockFetch).toHaveBeenCalledTimes(3);
        });

        it('should reuse single indexing client token for the entire batch', async () => {
            const getIndexingClientMock = (await import('../src/google/client.js')).getIndexingClient;
            vi.mocked(getIndexingClientMock).mockClear();

            const urls = ['https://example.com/p1', 'https://example.com/p2', 'https://example.com/p3'];
            mockFetch.mockResolvedValue({
                ok: true,
                json: async () => ({ urlNotificationMetadata: { url: 'https://example.com/p1' } })
            });

            await batchPublishNotifications('https://example.com', urls, 'URL_UPDATED');

            // Verified optimization: getIndexingClient called 1 time for the batch (not 4 times)
            expect(getIndexingClientMock).toHaveBeenCalledTimes(1);
        });

        it('should return empty array for empty input', async () => {
            const results = await batchPublishNotifications(
                'https://example.com',
                [],
                'URL_UPDATED'
            );
            expect(results).toEqual([]);
        });

        it('should reject batches over 200 URLs', async () => {
            const urls = Array.from({ length: 201 }, (_, i) => `https://example.com/page-${i}`);

            await expect(
                batchPublishNotifications('https://example.com', urls, 'URL_UPDATED')
            ).rejects.toThrow('Batch limited to 200 URLs');
        });

        it('should handle partial failures gracefully', async () => {
            // First URL succeeds
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    urlNotificationMetadata: {
                        url: 'https://example.com/page-1',
                        latestUpdate: {
                            url: 'https://example.com/page-1',
                            type: 'URL_UPDATED',
                            notifyTime: '2026-06-07T10:00:00Z'
                        }
                    }
                })
            });

            // Second URL fails
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 429,
                text: async () => 'Rate limit exceeded'
            });

            const results = await batchPublishNotifications(
                'https://example.com',
                ['https://example.com/page-1', 'https://example.com/page-2'],
                'URL_UPDATED'
            );

            expect(results).toHaveLength(2);
            expect(results[0].result).toBeDefined();
            expect(results[0].error).toBeUndefined();
            expect(results[1].error).toContain('429');
            expect(results[1].result).toBeUndefined();
        });
    });
});
