import { getSearchConsoleClient } from '../client.js';
import type { searchconsole_v1 } from 'googleapis';
import { limitConcurrency } from '../../common/concurrency.js';
import { resolveSiteProperty, resolveFullWebUrl } from '../../common/auth/resolver.js';

/**
 * Inspects a URL for a site to see its current indexing status in Google Search.
 *
 * @param siteUrl - The URL of the site as defined in Search Console.
 * @param inspectionUrl - The specific URL to inspect.
 * @param languageCode - The language used for localized results. Defaults to 'en-US'.
 * @returns Comprehensive indexing and status information for the URL.
 */
export async function inspectUrl(
  siteUrl: string,
  inspectionUrl: string,
  languageCode: string = 'en-US',
  existingClient?: searchconsole_v1.Searchconsole
): Promise<searchconsole_v1.Schema$InspectUrlIndexResponse> {
  const { siteUrl: targetSiteUrl } = await resolveSiteProperty(siteUrl, 'google').catch(() => ({ siteUrl }));
  const fullInspectionUrl = resolveFullWebUrl(inspectionUrl);
  const client = existingClient || await getSearchConsoleClient(siteUrl);
  const res = await client.urlInspection.index.inspect({
    requestBody: {
      inspectionUrl: fullInspectionUrl,
      siteUrl: targetSiteUrl,
      languageCode
    }
  });
  return res.data;
}

/**
 * Inspects multiple URLs for a site in batch.
 *
 * @param siteUrl - The URL of the site as defined in Search Console.
 * @param inspectionUrls - The list of URLs to inspect.
 * @param languageCode - The language used for localized results. Defaults to 'en-US'.
 * @returns An array of results, each containing the URL and its inspection result or error.
 */
export async function inspectBatch(
  siteUrl: string,
  inspectionUrls: string[],
  languageCode: string = 'en-US'
): Promise<Array<{ url: string; result?: searchconsole_v1.Schema$InspectUrlIndexResponse; error?: string }>> {
  let client: searchconsole_v1.Searchconsole | undefined;
  try {
    client = await getSearchConsoleClient(siteUrl);
  } catch {
    // Fallback to per-request resolution if batch client resolution fails
  }

  return limitConcurrency(inspectionUrls, 5, async (url) => {
    try {
      const result = await inspectUrl(siteUrl, url, languageCode, client);
      return { url, result };
    } catch (error) {
      return { url, error: (error as Error).message };
    }
  });
}
