import { getBingClient, BingUrlInfo } from '../client.js';
import { limitConcurrency } from '../../common/concurrency.js';
import { resolveSitePropertyOrFallback, resolveFullWebUrl } from '../../common/auth/resolver.js';

/**
 * Get detailed indexing and crawl information for a URL.
 */
export async function getUrlInfo(siteUrl: string, url: string): Promise<BingUrlInfo> {
    const targetSiteUrl = await resolveSitePropertyOrFallback(siteUrl, 'bing');
    const fullUrl = resolveFullWebUrl(url);
    const client = await getBingClient(siteUrl);
    return client.getUrlInfo(targetSiteUrl, fullUrl);
}

/**
 * Inspect multiple URLs for a site in batch (Bing).
 *
 * @param siteUrl - The URL of the site as defined in Bing Webmaster Tools.
 * @param inspectionUrls - The list of URLs to inspect.
 * @returns An array of results, each containing the URL and its inspection result or error.
 */
export async function inspectBatch(
  siteUrl: string,
  inspectionUrls: string[]
): Promise<Array<{ url: string; result?: BingUrlInfo; error?: string }>> {
  return limitConcurrency(inspectionUrls, 5, async (url) => {
    try {
      const result = await getUrlInfo(siteUrl, url);
      return { url, result };
    } catch (error) {
      return { url, error: (error as Error).message };
    }
  });
}
