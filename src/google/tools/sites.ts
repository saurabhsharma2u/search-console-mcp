import { getSearchConsoleClient } from '../client.js';
import type { searchconsole_v1 } from 'googleapis';

/**
 * List all sites verified in the specified Google account.
 *
 * @param accountId - Optional. The account to list sites for.
 * @returns A list of verified site properties.
 */
export async function listSites(accountId?: string): Promise<searchconsole_v1.Schema$WmxSite[]> {
  const client = await getSearchConsoleClient(undefined, accountId);
  const res = await client.sites.list();
  return res.data.siteEntry || [];
}

/**
 * Add a new site property to Search Console.
 *
 * @param siteUrl - The URL of the site to add.
 * @returns A success message.
 */
export async function addSite(siteUrl: string): Promise<string> {
  const client = await getSearchConsoleClient(siteUrl);
  await client.sites.add({ siteUrl });
  return `Successfully added site: ${siteUrl}`;
}

/**
 * Remove a site property from Search Console.
 *
 * @param siteUrl - The URL of the site to remove.
 * @returns A success message.
 */
export async function deleteSite(siteUrl: string): Promise<string> {
  const client = await getSearchConsoleClient(siteUrl);
  await client.sites.delete({ siteUrl });
  return `Successfully deleted site: ${siteUrl}`;
}

/**
 * Get metadata for a specific verified site.
 *
 * @param siteUrl - The URL of the site.
 * @returns Site metadata including verification status.
 */
export async function getSite(siteUrl: string): Promise<searchconsole_v1.Schema$WmxSite> {
  const client = await getSearchConsoleClient(siteUrl);
  const res = await client.sites.get({ siteUrl });
  return res.data;
}
