import { queryAnalytics, AnalyticsOptions } from "../../../google/tools/analytics.js";
import { getBingClient, BingQueryStats, BingPageStats } from "../../../bing/client.js";
import { parseMicrosoftDate } from "../../utils/dates.js";
import { resolveSiteProperty } from "../../auth/resolver.js";
import { CompareEnginesOptions } from "./types.js";
import { searchconsole_v1 } from "googleapis";

export async function fetchGoogleData(options: CompareEnginesOptions): Promise<searchconsole_v1.Schema$ApiDataRow[]> {
  const { siteUrl: resolvedSiteUrl } = await resolveSiteProperty(options.siteUrl, 'google').catch(() => ({ siteUrl: options.siteUrl }));
  const analyticsOptions: AnalyticsOptions = {
    siteUrl: resolvedSiteUrl,
    startDate: options.startDate,
    endDate: options.endDate,
    dimensions: [options.dimension],
    limit: options.limit,
    startRow: options.offset
  };

  try {
    return await queryAnalytics(analyticsOptions);
  } catch (error: any) {
    // If site is not verified or other expected API error, return empty instead of crashing the whole comparison
    const errMsg = error.message || '';
    if (errMsg.includes('403') || errMsg.includes('forbidden') || errMsg.includes('permission')) {
      console.warn(`CompareEngines: Google access denied for ${options.siteUrl}. Using empty data.`);
      return [];
    }
    throw error;
  }
}

export async function fetchBingData(options: CompareEnginesOptions): Promise<BingQueryStats[] | BingPageStats[]> {
  const { siteUrl: resolvedSiteUrl } = await resolveSiteProperty(options.siteUrl, 'bing').catch(() => ({ siteUrl: options.siteUrl }));
  const client = await getBingClient(resolvedSiteUrl);
  let rawData: (BingQueryStats | BingPageStats)[] = [];

  // 1. Fetch Data
  try {
    if (options.dimension === "query") {
      rawData = await client.getQueryStats(resolvedSiteUrl);
    } else if (options.dimension === "page") {
      rawData = await client.getPageStats(resolvedSiteUrl);
    } else {
      console.warn(`BingAdapter: Dimension '${options.dimension}' is not fully supported.`);
      return [];
    }
  } catch (error: any) {
    const errMsg = error.message || '';
    if (errMsg.includes('403') || errMsg.includes('forbidden') || errMsg.includes('Authentication') || errMsg.includes('404')) {
      console.warn(`CompareEngines: Bing access denied/not found for ${options.siteUrl}. Using empty data.`);
      return [];
    }
    throw error;
  }

  // 2. Filter by Date
  const start = new Date(options.startDate);
  const end = new Date(options.endDate);

  const filtered = rawData.filter(row => {
    const rowDate = parseMicrosoftDate(row.Date);
    return rowDate >= start && rowDate <= end;
  });

  // 3. Aggregate by Key
  const aggregated = new Map<string, {
    clicks: number;
    impressions: number;
    weightedPos: number;
    count: number;
    key: string;
  }>();

  for (const row of filtered) {
    // Bing's API returns the URL in the 'Query' field for page stats
    const key = row.Query;

    if (!aggregated.has(key)) {
      aggregated.set(key, { clicks: 0, impressions: 0, weightedPos: 0, count: 0, key });
    }

    const entry = aggregated.get(key)!;
    entry.clicks += row.Clicks;
    entry.impressions += row.Impressions;
    entry.weightedPos += (row.AvgPosition * row.Impressions);
    entry.count++;
  }

  // 4. Convert back to array
  const result: (BingQueryStats | BingPageStats)[] = Array.from(aggregated.values()).map(entry => {
    const avgPos = entry.impressions > 0 ? entry.weightedPos / entry.impressions : 0;
    // CTR as ratio 0-1, consistent with GSC (Bing does not return a normalized CTR)
    const ctr = entry.impressions > 0 ? (entry.clicks / entry.impressions) : 0;

    return {
      Query: entry.key,
      Clicks: entry.clicks,
      Impressions: entry.impressions,
      CTR: ctr,
      AvgPosition: avgPos,
      Date: options.startDate // Dummy date
    };
  });

  // 5. Sort by Clicks (desc) to match GSC default
  result.sort((a, b) => b.Clicks - a.Clicks);

  // 6. Pagination
  const limit = options.limit || 1000;
  const offset = options.offset || 0;

  return result.slice(offset, offset + limit);
}
