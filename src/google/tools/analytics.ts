import { getSearchConsoleClient } from '../client.js';
import { searchconsole_v1 } from 'googleapis';
import { logger } from '../../utils/logger.js';
import { resolveSiteProperty } from '../../common/auth/resolver.js';

const CACHE_TTL_MS = 60 * 1000; // 60 seconds
const MAX_CACHE_SIZE = 100;

type CacheValue =
  | { data: searchconsole_v1.Schema$ApiDataRow[]; timestamp: number }
  | Promise<searchconsole_v1.Schema$ApiDataRow[]>;

const analyticsCache = new Map<string, CacheValue>();

export function clearAnalyticsCache() {
  analyticsCache.clear();
}

function generateCacheKey(options: AnalyticsOptions): string {
  const clone = { ...options };
  if (clone.filters) {
    clone.filters = [...clone.filters].sort((a, b) =>
      (a.dimension + a.operator + a.expression).localeCompare(b.dimension + b.operator + b.expression)
    );
  }

  // Stable cache key: JSON.stringify with a key replacer drops nested objects,
  // so top-level keys are sorted manually instead.
  const sorted: any = {};
  Object.keys(clone).sort().forEach(key => {
    sorted[key] = (clone as any)[key];
  });
  return JSON.stringify(sorted);
}

/**
 * Options for querying Google Search Console analytics data.
 */
export interface AnalyticsOptions {
  /** The URL of the property (site or domain) in GSC. */
  siteUrl: string;
  /** Start date in YYYY-MM-DD format. */
  startDate: string;
  /** End date in YYYY-MM-DD format. */
  endDate: string;
  /** Dimensions to group data by (e.g., 'query', 'page', 'device', 'country', 'date'). */
  dimensions?: string[];
  /** Search type: 'web', 'image', 'video', 'news', 'discover', or 'googleNews'. Defaults to 'web'. */
  type?: string;
  /** Optional filters to refine the query. */
  filters?: Array<{
    dimension: string;
    operator: string;
    expression: string;
  }>;
  /** Whether to aggregate data by property or by page. Defaults to 'auto'. */
  aggregationType?: 'auto' | 'byProperty' | 'byPage';
  /** Data state: 'final' (stable data only) or 'all' (includes fresh, volatile data). Defaults to 'final'. */
  dataState?: 'final' | 'all';
  /** Maximum number of rows to return. Max 25,000. */
  limit?: number;
  /** Zero-based index of the first row to return. */
  startRow?: number;
  /** Optional account ID for multi-account resolution. */
  accountId?: string;
}

/**
 * Aggregate performance metrics for a specific site and period.
 */
export interface PerformanceSummary {
  /** Total clicks received from Google Search. */
  clicks: number;
  /** Total times the site appeared in search results. */
  impressions: number;
  /** Average click-through rate (clicks / impressions). */
  ctr: number;
  /** Average ranking position in search results. */
  position: number;
  /** The start date of the reporting period. */
  startDate: string;
  /** The end date of the reporting period. */
  endDate: string;
}

/**
 * Result of comparing performance between two date ranges.
 */
export interface PeriodComparison {
  /** Metrics for the primary (current) period. */
  period1: PerformanceSummary;
  /** Metrics for the comparison (past) period. */
  period2: PerformanceSummary;
  /** Absolute and percentage changes between the two periods. */
  changes: {
    /** Change in absolute clicks. */
    clicks: number;
    /** Percentage change in clicks. */
    clicksPercent: number;
    /** Change in absolute impressions. */
    impressions: number;
    /** Percentage change in impressions. */
    impressionsPercent: number;
    /** Change in absolute CTR. */
    ctr: number;
    /** Percentage change in CTR. */
    ctrPercent: number;
    /** Change in absolute average position. */
    position: number;
    /** Percentage change in average position. */
    positionPercent: number;
  };
}

/**
 * A simplified representation of a search dimension (query, page, etc.) and its metrics.
 */
export interface TopItem {
  /** The value of the dimension (e.g., the query string or page URL). */
  key: string;
  /** Total clicks. */
  clicks: number;
  /** Total impressions. */
  impressions: number;
  /** Average click-through rate. */
  ctr: number;
  /** Average ranking position. */
  position: number;
}

/**
 * Result containing a list of top-performing items for a period.
 */
export interface TopItemsResult {
  /** The list of top items. */
  items: TopItem[];
  /** The start date of the analysis period. */
  startDate: string;
  /** The end date of the analysis period. */
  endDate: string;
  /** The total number of rows returned from the API. */
  totalRows: number;
}

/**
 * Executes a raw query against the Google Search Console Search Analytics API.
 * This is a low-level function used by many other tools in the project.
 *
 * @param options - The query parameters including dates, dimensions, and filters.
 * @returns A promise resolving to an array of data rows from GSC.
 */
export async function queryAnalytics(options: AnalyticsOptions): Promise<searchconsole_v1.Schema$ApiDataRow[]> {
  const cacheKey = generateCacheKey(options);
  const now = Date.now();
  const cached = analyticsCache.get(cacheKey);

  if (cached) {
    if ('then' in cached) {
      logger.debug(`Cache hit (pending) for ${options.siteUrl}`);
      return cached;
    }
    if (now - cached.timestamp < CACHE_TTL_MS) {
      logger.debug(`Cache hit (fresh) for ${options.siteUrl}`);
      // LRU: Refresh key position
      analyticsCache.delete(cacheKey);
      analyticsCache.set(cacheKey, cached);
      return cached.data;
    }
    analyticsCache.delete(cacheKey);
  }

  const fetchPromise = (async () => {
    try {
      const { siteUrl: targetSiteUrl } = await resolveSiteProperty(options.siteUrl, 'google').catch(() => ({ siteUrl: options.siteUrl }));
      const client = await getSearchConsoleClient(options.siteUrl, options.accountId);

      const resolvedEndDate = options.endDate && options.endDate.trim().length > 0 ? options.endDate : (() => {
        const d = new Date();
        d.setDate(d.getDate() - 3);
        return d.toISOString().split('T')[0];
      })();

      const resolvedStartDate = options.startDate && options.startDate.trim().length > 0 ? options.startDate : (() => {
        const d = new Date(resolvedEndDate);
        d.setDate(d.getDate() - 28);
        return d.toISOString().split('T')[0];
      })();

      const requestBody: searchconsole_v1.Schema$SearchAnalyticsQueryRequest = {
        startDate: resolvedStartDate,
        endDate: resolvedEndDate,
        dimensions: (options.dimensions && options.dimensions.length > 0) ? options.dimensions : undefined,
        type: options.type || 'web',
        aggregationType: options.aggregationType || 'auto',
        dataState: options.dataState || 'final',

        rowLimit: Math.min(options.limit || 1000, 25000),
      };

      // Add pagination support
      if (options.startRow !== undefined && options.startRow > 0) {
        requestBody.startRow = options.startRow;
      }

      if (options.filters && options.filters.length > 0) {
        // Separate dimensionFilterGroups per filter so they are joined by AND
        // (multiple filters on the same dimension inside one group would join by OR)
        requestBody.dimensionFilterGroups = options.filters.map(f => ({
          filters: [{
            dimension: f.dimension,
            operator: f.operator,
            expression: f.expression
          }]
        }));
      }

      logger.debug(`Fetching analytics for ${targetSiteUrl}`, {
        startDate: options.startDate,
        endDate: options.endDate,
        dimensions: options.dimensions,
        filters: options.filters?.length || 0
      });

      const res = await client.searchanalytics.query({
        siteUrl: targetSiteUrl,
        requestBody
      });

      const rows = res.data.rows || [];
      logger.debug(`Received ${rows.length} rows for ${options.siteUrl}`);

      analyticsCache.set(cacheKey, {
        data: rows,
        timestamp: Date.now()
      });

      // Simple LRU-like eviction: remove oldest if over limit
      if (analyticsCache.size > MAX_CACHE_SIZE) {
        const firstKey = analyticsCache.keys().next().value;
        if (firstKey) analyticsCache.delete(firstKey);
      }

      return rows;
    } catch (error) {
      logger.error(`Error fetching analytics for ${options.siteUrl}:`, (error as Error).message);
      analyticsCache.delete(cacheKey);
      throw error;
    }
  })();

  analyticsCache.set(cacheKey, fetchPromise);
  return fetchPromise;
}

/**
 * Get aggregate performance metrics for the last N days.
 * Accounts for the standard 2-3 day GSC data delay automatically.
 *
 * @param siteUrl - The URL of the site to summarize.
 * @param days - Lookback period in days. Defaults to 28.
 * @returns Combined metrics for the requested period.
 */
export async function getPerformanceSummary(siteUrl: string, days: number = 28): Promise<PerformanceSummary> {
  const DATA_DELAY_DAYS = 1; // Use 1 day delay with 'all' dataState (fresh data)

  const endDate = new Date();
  endDate.setDate(endDate.getDate() - DATA_DELAY_DAYS);

  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days);

  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];

  const rows = await queryAnalytics({
    siteUrl,
    startDate: startDateStr,
    endDate: endDateStr,
    dataState: 'all',
    limit: 1
  });

  if (rows.length > 0) {
    return {
      clicks: rows[0].clicks ?? 0,
      impressions: rows[0].impressions ?? 0,
      ctr: rows[0].ctr ?? 0,
      position: rows[0].position ?? 0,
      startDate: startDateStr,
      endDate: endDateStr
    };
  }

  return {
    clicks: 0,
    impressions: 0,
    ctr: 0,
    position: 0,
    startDate: startDateStr,
    endDate: endDateStr
  };
}

/**
 * Compare performance metrics between two distinct date periods (e.g., Week-over-Week).
 *
 * @param siteUrl - The URL of the site to analyze.
 * @param period1Start - Start of the current period.
 * @param period1End - End of the current period.
 * @param period2Start - Start of the comparison period.
 * @param period2End - End of the comparison period.
 * @returns A comparison object containing metrics for both periods and the calculated deltas.
 */
export async function comparePeriods(
  siteUrl: string,
  period1Start: string,
  period1End: string,
  period2Start: string,
  period2End: string
): Promise<PeriodComparison> {
  const [period1Rows, period2Rows] = await Promise.all([
    queryAnalytics({ siteUrl, startDate: period1Start, endDate: period1End, limit: 1 }),
    queryAnalytics({ siteUrl, startDate: period2Start, endDate: period2End, limit: 1 })
  ]);

  const period1: PerformanceSummary = {
    clicks: period1Rows[0]?.clicks ?? 0,
    impressions: period1Rows[0]?.impressions ?? 0,
    ctr: period1Rows[0]?.ctr ?? 0,
    position: period1Rows[0]?.position ?? 0,
    startDate: period1Start,
    endDate: period1End
  };

  const period2: PerformanceSummary = {
    clicks: period2Rows[0]?.clicks ?? 0,
    impressions: period2Rows[0]?.impressions ?? 0,
    ctr: period2Rows[0]?.ctr ?? 0,
    position: period2Rows[0]?.position ?? 0,
    startDate: period2Start,
    endDate: period2End
  };

  const calcChange = (current: number, previous: number) => current - previous;
  const calcPercent = (current: number, previous: number) =>
    previous === 0 ? (current > 0 ? 100 : 0) : ((current - previous) / previous) * 100;

  return {
    period1,
    period2,
    changes: {
      clicks: calcChange(period1.clicks, period2.clicks),
      clicksPercent: calcPercent(period1.clicks, period2.clicks),
      impressions: calcChange(period1.impressions, period2.impressions),
      impressionsPercent: calcPercent(period1.impressions, period2.impressions),
      ctr: calcChange(period1.ctr, period2.ctr),
      ctrPercent: calcPercent(period1.ctr, period2.ctr),
      position: calcChange(period1.position, period2.position),
      positionPercent: calcPercent(period1.position, period2.position)
    }
  };
}

/**
 * Get the top-performing search queries for a site.
 *
 * @param siteUrl - The URL of the site to analyze.
 * @param options - Configuration including day range, limits, and optional filters.
 * @returns A list of queries sorted by the requested metric.
 */
export async function getTopQueries(
  siteUrl: string,
  options: {
    days?: number;
    limit?: number;
    sortBy?: 'clicks' | 'impressions';
    filters?: AnalyticsOptions['filters'];
  } = {}
): Promise<TopItemsResult> {
  const DATA_DELAY_DAYS = 3;
  const days = options.days ?? 28;
  const limit = options.limit ?? 10;

  const endDate = new Date();
  endDate.setDate(endDate.getDate() - DATA_DELAY_DAYS);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days);

  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];

  const rows = await queryAnalytics({
    siteUrl,
    startDate: startDateStr,
    endDate: endDateStr,
    dimensions: ['query'],
    limit,
    filters: options.filters
  });

  // Sort by clicks or impressions
  const sortKey = options.sortBy ?? 'clicks';
  const sortedRows = [...rows].sort((a, b) => (b[sortKey] ?? 0) - (a[sortKey] ?? 0));

  return {
    items: sortedRows.map(row => ({
      key: row.keys?.[0] ?? '',
      clicks: row.clicks ?? 0,
      impressions: row.impressions ?? 0,
      ctr: row.ctr ?? 0,
      position: row.position ?? 0
    })),
    startDate: startDateStr,
    endDate: endDateStr,
    totalRows: sortedRows.length
  };
}

/**
 * Get the top-performing pages for a site.
 *
 * @param siteUrl - The URL of the site to analyze.
 * @param options - Configuration including day range, limits, and optional filters.
 * @returns A list of pages sorted by the requested metric.
 */
export async function getTopPages(
  siteUrl: string,
  options: {
    days?: number;
    limit?: number;
    sortBy?: 'clicks' | 'impressions';
    filters?: AnalyticsOptions['filters'];
  } = {}
): Promise<TopItemsResult> {
  const DATA_DELAY_DAYS = 3;
  const days = options.days ?? 28;
  const limit = options.limit ?? 10;

  const endDate = new Date();
  endDate.setDate(endDate.getDate() - DATA_DELAY_DAYS);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days);

  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];

  const rows = await queryAnalytics({
    siteUrl,
    startDate: startDateStr,
    endDate: endDateStr,
    dimensions: ['page'],
    limit,
    filters: options.filters
  });

  // Sort by clicks or impressions
  const sortKey = options.sortBy ?? 'clicks';
  const sortedRows = [...rows].sort((a, b) => (b[sortKey] ?? 0) - (a[sortKey] ?? 0));

  return {
    items: sortedRows.map(row => ({
      key: row.keys?.[0] ?? '',
      clicks: row.clicks ?? 0,
      impressions: row.impressions ?? 0,
      ctr: row.ctr ?? 0,
      position: row.position ?? 0
    })),
    startDate: startDateStr,
    endDate: endDateStr,
    totalRows: sortedRows.length
  };
}

/**
 * Get performance metrics segmented by country.
 *
 * @param siteUrl - The URL of the site to analyze.
 * @param options - Configuration including day range and sort order.
 * @returns A list of countries with their search performance metrics.
 */
export async function getPerformanceByCountry(
  siteUrl: string,
  options: {
    days?: number;
    limit?: number;
    sortBy?: 'clicks' | 'impressions';
  } = {}
): Promise<TopItemsResult> {
  const DATA_DELAY_DAYS = 3;
  const days = options.days ?? 28;
  const limit = options.limit ?? 250; // Higher default limit for countries

  const endDate = new Date();
  endDate.setDate(endDate.getDate() - DATA_DELAY_DAYS);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days);

  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];

  const rows = await queryAnalytics({
    siteUrl,
    startDate: startDateStr,
    endDate: endDateStr,
    dimensions: ['country'],
    limit
  });

  const sortKey = options.sortBy ?? 'clicks';
  const sortedRows = [...rows].sort((a, b) => (b[sortKey] ?? 0) - (a[sortKey] ?? 0));

  return {
    items: sortedRows.map(row => ({
      key: row.keys?.[0] ?? '',
      clicks: row.clicks ?? 0,
      impressions: row.impressions ?? 0,
      ctr: row.ctr ?? 0,
      position: row.position ?? 0
    })),
    startDate: startDateStr,
    endDate: endDateStr,
    totalRows: sortedRows.length
  };
}

/**
 * Get performance metrics segmented by search appearance (e.g., 'AMP article', 'Review snippet').
 *
 * @param siteUrl - The URL of the site to analyze.
 * @param options - Configuration including day range and sort order.
 * @returns A list of search appearance types with their metrics.
 */
export async function getPerformanceBySearchAppearance(
  siteUrl: string,
  options: {
    days?: number;
    limit?: number;
    sortBy?: 'clicks' | 'impressions';
  } = {}
): Promise<TopItemsResult> {
  const DATA_DELAY_DAYS = 3;
  const days = options.days ?? 28;
  const limit = options.limit ?? 50;

  const endDate = new Date();
  endDate.setDate(endDate.getDate() - DATA_DELAY_DAYS);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days);

  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];

  const rows = await queryAnalytics({
    siteUrl,
    startDate: startDateStr,
    endDate: endDateStr,
    dimensions: ['searchAppearance'],
    limit
  });

  const sortKey = options.sortBy ?? 'clicks';
  const sortedRows = [...rows].sort((a, b) => (b[sortKey] ?? 0) - (a[sortKey] ?? 0));

  return {
    items: sortedRows.map(row => ({
      key: row.keys?.[0] ?? '',
      clicks: row.clicks ?? 0,
      impressions: row.impressions ?? 0,
      ctr: row.ctr ?? 0,
      position: row.position ?? 0
    })),
    startDate: startDateStr,
    endDate: endDateStr,
    totalRows: sortedRows.length
  };
}

/**
 * Represents a significant change in performance for a specific item.
 */
export interface TrendItem {
  /** The item identifier (e.g., the query or page). */
  key: string;
  /** The specific metric being tracked. */
  metric: 'clicks' | 'impressions' | 'ctr' | 'position';
  /** The absolute change between periods. */
  change: number;
  /** The percentage change between periods. */
  changePercent: number;
  /** Whether the metric is rising or declining. */
  trend: 'rising' | 'declining';
  /** The value in the most recent period. */
  currentValue: number;
  /** The value in the preceding period. */
  previousValue: number;
}

/**
 * Represents a data point that deviates significantly from the expected value.
 */
export interface AnomalyItem {
  /** The date of the anomaly. */
  date: string;
  /** The metric where the anomaly was detected. */
  metric: 'clicks' | 'impressions' | 'ctr' | 'position';
  /** The actual recorded value. */
  value: number;
  /** The expected value based on the historical baseline. */
  expectedValue: number;
  /** The percentage deviation from the expected value. */
  deviation: number;
  /** Whether the anomaly is a spike (increase) or a drop (decrease). */
  type: 'spike' | 'drop';
}

/**
 * Detect significant rising or declining trends in queries or pages.
 * Compares two consecutive equal periods to identify momentum.
 *
 * @param siteUrl - The URL of the site to analyze.
 * @param options - Configuration including dimension, day range, and sensitivity thresholds.
 * @returns A list of trending items.
 */
export async function detectTrends(
  siteUrl: string,
  options: {
    dimension?: 'query' | 'page';
    days?: number;
    threshold?: number;
    minClicks?: number;
    limit?: number;
  } = {}
): Promise<TrendItem[]> {
  const DATA_DELAY_DAYS = 3;
  const days = options.days ?? 28;
  const threshold = options.threshold ?? 10;
  const minClicks = options.minClicks ?? 100;
  const dimension = options.dimension ?? 'query';
  const limit = options.limit ?? 20;

  // Split the period into two halves
  const midPoint = Math.floor(days / 2);

  // Calculate periods ensuring no overlap
  const currentEndDate = new Date();
  currentEndDate.setDate(currentEndDate.getDate() - DATA_DELAY_DAYS);

  const currentStartDate = new Date(currentEndDate);
  currentStartDate.setDate(currentStartDate.getDate() - midPoint + 1);

  const previousEndDate = new Date(currentStartDate);
  previousEndDate.setDate(previousEndDate.getDate() - 1);

  const previousStartDate = new Date(previousEndDate);
  previousStartDate.setDate(previousStartDate.getDate() - midPoint + 1);


  const [currentPeriod, previousPeriod] = await Promise.all([
    queryAnalytics({
      siteUrl,
      startDate: currentStartDate.toISOString().split('T')[0],
      endDate: currentEndDate.toISOString().split('T')[0],
      dimensions: [dimension],
      limit: 5000 // Get enough data to find trends
    }),
    queryAnalytics({
      siteUrl,
      startDate: previousStartDate.toISOString().split('T')[0],
      endDate: previousEndDate.toISOString().split('T')[0],
      dimensions: [dimension],
      limit: 5000
    })
  ]);

  const trends: TrendItem[] = [];
  const prevMap = new Map(previousPeriod.map(r => [r.keys?.[0], r]));

  for (const curr of currentPeriod) {
    const key = curr.keys?.[0];
    if (!key) continue;

    const prev = prevMap.get(key);

    // Only analyze if significant volume
    if ((curr.clicks ?? 0) < minClicks && (prev?.clicks ?? 0) < minClicks) continue;

    const currClicks = curr.clicks ?? 0;
    const prevClicks = prev?.clicks ?? 0;

    if (prevClicks > 0) {
      const change = currClicks - prevClicks;
      const percent = (change / prevClicks) * 100;

      if (Math.abs(percent) >= threshold) {
        trends.push({
          key,
          metric: 'clicks',
          change,
          changePercent: parseFloat(percent.toFixed(2)),
          trend: percent > 0 ? 'rising' : 'declining',
          currentValue: currClicks,
          previousValue: prevClicks
        });
      }
    } else if (currClicks >= minClicks) {
      // New trending item (infinity % increase)
      trends.push({
        key,
        metric: 'clicks',
        change: currClicks,
        changePercent: 100, // Treat new items as 100% rising for simplicity
        trend: 'rising',
        currentValue: currClicks,
        previousValue: 0
      });
    }
  }

  return trends
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, limit);
}

/**
 * Detect daily anomalies where metrics deviate significantly from a statistical moving average.
 * Uses a Z-score based calculation to identify outliers.
 *
 * @param siteUrl - The URL of the site to analyze.
 * @param options - Configuration including standard day range and deviation threshold.
 * @returns A list of detected spikes or drops.
 */
export async function detectAnomalies(
  siteUrl: string,
  options: {
    days?: number;
    threshold?: number;
  } = {}
): Promise<AnomalyItem[]> {
  const DATA_DELAY_DAYS = 3;
  const days = options.days ?? 30;
  const threshold = options.threshold ?? 1.5; // Default 1.5 std dev

  const endDate = new Date();
  endDate.setDate(endDate.getDate() - DATA_DELAY_DAYS);

  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days); // Look back further for baseline

  // Extract page path if siteUrl contains a subpage path
  let pagePath: string | undefined;
  if (siteUrl.includes('/')) {
    try {
      const cleanUrl = siteUrl.startsWith('http') ? siteUrl : 'https://' + siteUrl.replace(/^sc-domain:/, '');
      const parsed = new URL(cleanUrl);
      if (parsed.pathname && parsed.pathname !== '/') {
        pagePath = parsed.pathname;
      }
    } catch {
      // Ignore URL parsing failure
    }
  }

  const queryFilters = pagePath ? [{ dimension: 'page', operator: 'contains', expression: pagePath }] : undefined;

  const rows = await queryAnalytics({
    siteUrl,
    startDate: startDate.toISOString().split('T')[0],
    endDate: endDate.toISOString().split('T')[0],
    dimensions: ['date'],
    filters: queryFilters
  });

  const anomalies: AnomalyItem[] = [];

  if (rows.length < 5) return [];

  let sum = 0;
  for (let i = 0; i < rows.length; i++) {
    sum += rows[i].clicks ?? 0;
  }
  const avgClicks = sum / rows.length;

  let sumSqDiff = 0;
  for (let i = 0; i < rows.length; i++) {
    const diff = (rows[i].clicks ?? 0) - avgClicks;
    sumSqDiff += diff * diff;
  }
  const stdDev = Math.sqrt(sumSqDiff / rows.length);

  // Heuristic: Flag if > threshold stdDev away
  for (const row of rows) {
    const val = row.clicks ?? 0;
    const date = row.keys?.[0] ?? '';

    // statistical Z-score check
    const zScore = stdDev === 0 ? 0 : (val - avgClicks) / stdDev;

    if (Math.abs(zScore) > threshold) {
      anomalies.push({
        date,
        metric: 'clicks',
        value: val,
        expectedValue: Math.round(avgClicks),
        deviation: parseFloat(((val - avgClicks) / avgClicks * 100).toFixed(2)),
        type: zScore > 0 ? 'spike' : 'drop'
      });
    }
  }

  return anomalies.reverse(); // Most recent first
}
