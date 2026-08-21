import { getSearchConsoleClient } from '../client.js';
import type { searchconsole_v1 } from 'googleapis';
import { resolveSiteProperty } from '../../common/auth/resolver.js';

/**
 * List all sitemaps submitted for a specific site.
 *
 * @param siteUrl - The URL of the site to query.
 * @returns A list of sitemap metadata objects.
 */
export async function listSitemaps(siteUrl: string): Promise<searchconsole_v1.Schema$WmxSitemap[]> {
  const { siteUrl: targetSiteUrl } = await resolveSiteProperty(siteUrl, 'google').catch(() => ({ siteUrl }));
  const client = await getSearchConsoleClient(siteUrl);
  const res = await client.sitemaps.list({ siteUrl: targetSiteUrl });
  return res.data.sitemap || [];
}

/**
 * Submit a new sitemap to Google Search Console.
 *
 * @param siteUrl - The URL of the site.
 * @param feedpath - The full URL path of the sitemap to submit.
 * @returns A success message.
 */
export async function submitSitemap(siteUrl: string, feedpath: string): Promise<string> {
  const { siteUrl: targetSiteUrl } = await resolveSiteProperty(siteUrl, 'google').catch(() => ({ siteUrl }));
  const client = await getSearchConsoleClient(siteUrl);
  await client.sitemaps.submit({ siteUrl: targetSiteUrl, feedpath });
  return `Successfully submitted sitemap: ${feedpath} for ${targetSiteUrl}`;
}

/**
 * Delete a sitemap from Google Search Console.
 *
 * @param siteUrl - The URL of the site.
 * @param feedpath - The full URL path of the sitemap to delete.
 * @returns A success message.
 */
export async function deleteSitemap(siteUrl: string, feedpath: string): Promise<string> {
  const { siteUrl: targetSiteUrl } = await resolveSiteProperty(siteUrl, 'google').catch(() => ({ siteUrl }));
  const client = await getSearchConsoleClient(siteUrl);
  await client.sitemaps.delete({ siteUrl: targetSiteUrl, feedpath });
  return `Successfully deleted sitemap: ${feedpath} from ${targetSiteUrl}`;
}

/**
 * Get detailed information about a specific sitemap.
 *
 * @param siteUrl - The URL of the site.
 * @param feedpath - The full URL path of the sitemap.
 * @returns Sitemap details including status and item counts.
 */
export async function getSitemap(siteUrl: string, feedpath: string): Promise<searchconsole_v1.Schema$WmxSitemap> {
  const { siteUrl: targetSiteUrl } = await resolveSiteProperty(siteUrl, 'google').catch(() => ({ siteUrl }));
  const client = await getSearchConsoleClient(siteUrl);
  const res = await client.sitemaps.get({ siteUrl: targetSiteUrl, feedpath });
  return res.data;
}
