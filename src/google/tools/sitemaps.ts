import { getSearchConsoleClient } from '../client.js';
import { searchconsole_v1 } from 'googleapis';
import { runGoogleApiCall } from '../upstream.js';

/**
 * List all sitemaps submitted for a specific site.
 *
 * @param siteUrl - The URL of the site to query.
 * @returns A list of sitemap metadata objects.
 */
export async function listSitemaps(siteUrl: string): Promise<searchconsole_v1.Schema$WmxSitemap[]> {
  const client = await getSearchConsoleClient(siteUrl);
  const res = await runGoogleApiCall('sitemaps.list', (requestOptions) =>
    client.sitemaps.list({ siteUrl }, requestOptions)
  );
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
  const client = await getSearchConsoleClient(siteUrl);
  await runGoogleApiCall('sitemaps.submit', (requestOptions) =>
    client.sitemaps.submit({ siteUrl, feedpath }, requestOptions)
  );
  return `Successfully submitted sitemap: ${feedpath} for ${siteUrl}`;
}

/**
 * Delete a sitemap from Google Search Console.
 *
 * @param siteUrl - The URL of the site.
 * @param feedpath - The full URL path of the sitemap to delete.
 * @returns A success message.
 */
export async function deleteSitemap(siteUrl: string, feedpath: string): Promise<string> {
  const client = await getSearchConsoleClient(siteUrl);
  await runGoogleApiCall('sitemaps.delete', (requestOptions) =>
    client.sitemaps.delete({ siteUrl, feedpath }, requestOptions)
  );
  return `Successfully deleted sitemap: ${feedpath} from ${siteUrl}`;
}

/**
 * Get detailed information about a specific sitemap.
 *
 * @param siteUrl - The URL of the site.
 * @param feedpath - The full URL path of the sitemap.
 * @returns Sitemap details including status and item counts.
 */
export async function getSitemap(siteUrl: string, feedpath: string): Promise<searchconsole_v1.Schema$WmxSitemap> {
  const client = await getSearchConsoleClient(siteUrl);
  const res = await runGoogleApiCall('sitemaps.get', (requestOptions) =>
    client.sitemaps.get({ siteUrl, feedpath }, requestOptions)
  );
  return res.data;
}
