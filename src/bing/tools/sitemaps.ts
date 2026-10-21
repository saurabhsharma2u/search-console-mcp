import { getBingClient } from '../client.js';
import { resolveSitePropertyOrFallback } from '../../common/auth/resolver.js';

/**
 * List sitemaps for a Bing site.
 * 
 * @param siteUrl - The URL of the site.
 * @returns A list of sitemaps.
 */
export async function listSitemaps(siteUrl: string): Promise<any[]> {
    const targetSiteUrl = await resolveSitePropertyOrFallback(siteUrl, 'bing');
    const client = await getBingClient(siteUrl);
    return client.getFeeds(targetSiteUrl);
}

/**
 * Submit a sitemap to Bing Webmaster Tools.
 * 
 * @param siteUrl - The URL of the site.
 * @param sitemapUrl - The URL of the sitemap file.
 */
export async function submitSitemap(siteUrl: string, sitemapUrl: string): Promise<string> {
    const targetSiteUrl = await resolveSitePropertyOrFallback(siteUrl, 'bing');
    const client = await getBingClient(siteUrl);
    await client.submitSitemap(targetSiteUrl, sitemapUrl);
    return `Successfully submitted sitemap: ${sitemapUrl} for site ${targetSiteUrl}`;
}

/**
 * Remove a sitemap from Bing Webmaster Tools.
 * 
 * @param siteUrl - The URL of the site.
 * @param sitemapUrl - The URL of the sitemap to remove.
 */
export async function deleteSitemap(siteUrl: string, sitemapUrl: string): Promise<string> {
    const targetSiteUrl = await resolveSitePropertyOrFallback(siteUrl, 'bing');
    const client = await getBingClient(siteUrl);
    await client.deleteSitemap(targetSiteUrl, sitemapUrl);
    return `Successfully removed sitemap: ${sitemapUrl} for site ${targetSiteUrl}`;
}
