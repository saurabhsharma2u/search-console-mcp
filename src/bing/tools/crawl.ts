import { getBingClient, BingCrawlIssue, BingCrawlStats } from '../client.js';
import { resolveSitePropertyOrFallback } from '../../common/auth/resolver.js';

/**
 * Get crawl issues for a site.
 */
export async function getCrawlIssues(siteUrl: string): Promise<BingCrawlIssue[]> {
    const targetSiteUrl = await resolveSitePropertyOrFallback(siteUrl, 'bing');
    const client = await getBingClient(siteUrl);
    return client.getCrawlIssues(targetSiteUrl);
}

/**
 * Get crawl statistics for a site.
 */
export async function getCrawlStats(siteUrl: string): Promise<BingCrawlStats[]> {
    const targetSiteUrl = await resolveSitePropertyOrFallback(siteUrl, 'bing');
    const client = await getBingClient(siteUrl);
    return client.getCrawlStats(targetSiteUrl);
}
