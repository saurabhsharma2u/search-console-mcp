import { queryAnalytics } from './analytics.js';
import { safeTestBatch } from '../../common/utils/regex.js';

type AnalyticsRows = Awaited<ReturnType<typeof queryAnalytics>>;

/**
 * Insight: A single SEO recommendation or finding
 */
/**
 * A single SEO recommendation or finding.
 */
export interface SEOInsight {
    /** The type of insight (opportunity, warning, or success). */
    type: 'opportunity' | 'warning' | 'success';
    /** The thematic area of the insight (e.g., 'Rankings', 'Content'). */
    category: string;
    /** A concise title summarizing the finding. */
    title: string;
    /** A detailed explanation of the insight and its significance. */
    description: string;
    /** The urgency level of addressing this insight. */
    priority: 'high' | 'medium' | 'low';
    /** Optional raw data supporting the insight. */
    data?: Record<string, unknown>;
}

/**
 * Low-hanging fruit: Keywords with high impressions but low position (potential quick wins)
 */
/**
 * Keywords with high impressions but low ranking position, representing potential quick wins.
 */
export interface LowHangingFruit {
    /** The search query string. */
    query: string;
    /** Total impressions for the period. */
    impressions: number;
    /** Total clicks for the period. */
    clicks: number;
    /** Average click-through rate. */
    ctr: number;
    /** Average ranking position. */
    position: number;
    /** Estimated additional clicks if position moved to top 3. */
    potentialClicks: number;
}

/**
 * Cannibalization: Multiple pages competing for the same query
 */
/**
 * A detected keyword cannibalization issue where multiple pages compete for same query.
 */
export interface CannibalizationIssue {
    /** The search query with multiple ranking pages. */
    query: string;
    /** The details of the pages competing for this query. */
    pages: Array<{
        page: string;
        clicks: number;
        impressions: number;
        position: number;
        ctr: number;
    }>;
    /** Combined clicks across all competing pages. */
    totalClicks: number;
    /** Combined impressions across all competing pages. */
    totalImpressions: number;
    /** A score (0-1) representing how severely the traffic is split. */
    clickShareConflict: number;
}

/**
 * Quick Win: Page close to page 1 that needs a push
 */
/**
 * A page and query pair that is close to significant traffic increases.
 */
export interface QuickWin {
    /** The URL of the page. */
    page: string;
    /** The search query. */
    query: string;
    /** Current average ranking position. */
    position: number;
    /** Total impressions. */
    impressions: number;
    /** Estimated gain if moved to top positions. */
    potentialClicks: number;
}

/**
 * Low CTR Opportunity: High ranking, high impressions, low CTR
 */
/**
 * A high-ranking query that is underperforming in terms of clicks.
 */
export interface LowCTROpportunity {
    /** The search query string. */
    query: string;
    /** The landing page. */
    page: string;
    /** Current average position. */
    position: number;
    /** Total impressions. */
    impressions: number;
    /** Total clicks. */
    clicks: number;
    /** Current click-through rate. */
    ctr: number;
    /** The target CTR based on the ranking position. */
    benchmarkCtr: number;
}

/**
 * Striking Distance: Keywords ranking 8-15
 */
/**
 * A keyword currently ranking just off the main visibility areas.
 */
export interface StrikingDistanceQuery {
    /** The search query string. */
    query: string;
    /** The landing page. */
    page: string;
    /** Current average position. */
    position: number;
    /** Total impressions. */
    impressions: number;
    /** Total clicks. */
    clicks: number;
}

/**
 * Lost Query: Lost all traffic compared to previous period
 */
/**
 * A query that has significantly declined in performance compared to the baseline.
 */
export interface LostQuery {
    /** The search query. */
    query: string;
    /** The landing page. */
    page: string;
    /** Clicks in the previous period. */
    previousClicks: number;
    /** Impressions in the previous period. */
    previousImpressions: number;
    /** Position in the previous period. */
    previousPosition: number;
    /** Clicks in the current period. */
    currentClicks: number;
    /** Impressions in the current period. */
    currentImpressions: number;
    /** Position in the current period. */
    currentPosition: number;
    /** Total clicks lost. */
    lostClicks: number;
}

/**
 * Brand vs Non-Brand Analysis
 */
/**
 * Performance metrics segmented by brand vs. non-brand search queries.
 */
export interface BrandVsNonBrandMetrics {
    /** The segment type. */
    segment: 'Brand' | 'Non-Brand';
    /** Total clicks for the segment. */
    clicks: number;
    /** Total impressions for the segment. */
    impressions: number;
    /** Average CTR for the segment. */
    ctr: number;
    /** Average position for the segment. */
    position: number;
    /** Unique number of queries in this segment. */
    queryCount: number;
}

function aggregateQueryPageToQuery(rows: AnalyticsRows): AnalyticsRows {
    const map = new Map<string, { query: string; clicks: number; impressions: number; position: number }>();
    for (const row of rows) {
        const query = row.keys?.[0] || '';
        let entry = map.get(query);
        if (!entry) {
            entry = { query, clicks: 0, impressions: 0, position: 0 };
            map.set(query, entry);
        }
        entry.clicks += row.clicks || 0;
        entry.impressions += row.impressions || 0;
        // Weighted position sum
        entry.position += (row.position || 0) * (row.impressions || 0);
    }

    const result: AnalyticsRows = [];
    for (const stats of map.values()) {
        result.push({
            keys: [stats.query],
            clicks: stats.clicks,
            impressions: stats.impressions,
            ctr: stats.impressions ? stats.clicks / stats.impressions : 0,
            position: stats.impressions ? stats.position / stats.impressions : 0
        });
    }
    return result;
}

/**
 * Find "low-hanging fruit" keywords: high impressions, low CTR, and positions in striking distance.
 *
 * @param siteUrl - The URL of the site to analyze.
 * @param options - Configuration including lookback period and volume thresholds.
 * @returns A list of potential growth keywords.
 */
export async function findLowHangingFruit(
    siteUrl: string,
    options: { days?: number; minImpressions?: number; limit?: number } = {},
    rows?: AnalyticsRows
): Promise<LowHangingFruit[]> {
    const { days = 28, minImpressions = 100, limit = 50 } = options;

    let analyticsRows: AnalyticsRows;

    if (rows) {
        analyticsRows = aggregateQueryPageToQuery(rows);
    } else {
        const endDate = new Date();
        endDate.setDate(endDate.getDate() - 3); // Account for GSC data delay
        const startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - days);

        analyticsRows = await queryAnalytics({
            siteUrl,
            startDate: startDate.toISOString().split('T')[0],
            endDate: endDate.toISOString().split('T')[0],
            dimensions: ['query'],
            limit: 5000
        });
    }

    // Filter for low-hanging fruit: position 5-20, high impressions, low CTR
    const candidates = analyticsRows
        .filter(row => {
            const position = row.position ?? 100;
            const impressions = row.impressions ?? 0;
            return position >= 5 && position <= 20 && impressions >= minImpressions;
        })
        .map(row => {
            const position = row.position ?? 10;
            const impressions = row.impressions ?? 0;
            const clicks = row.clicks ?? 0;
            const ctr = row.ctr ?? 0;

            // Estimate potential clicks if moved to top 3
            // Average CTR for position 1-3 is ~15-25%, we use 15% conservatively
            const potentialClicks = Math.round(impressions * 0.15) - clicks;

            return {
                query: row.keys?.[0] ?? '',
                impressions,
                clicks,
                ctr,
                position,
                potentialClicks: Math.max(0, potentialClicks)
            };
        })
        .sort((a, b) => b.potentialClicks - a.potentialClicks)
        .slice(0, limit);

    return candidates;
}

/**
 * Detect keyword cannibalization where multiple pages compete for the same query.
 *
 * @param siteUrl - The URL of the site to analyze.
 * @param options - Configuration including lookback period and volume thresholds.
 * @returns A list of queries with split traffic between multiple URLs.
 */
export async function detectCannibalization(
    siteUrl: string,
    options: { days?: number; minImpressions?: number; limit?: number } = {},
    rows?: AnalyticsRows
): Promise<CannibalizationIssue[]> {
    const { days = 28, minImpressions = 50, limit = 30 } = options;

    let analyticsRows: AnalyticsRows;

    if (rows) {
        analyticsRows = rows;
    } else {
        const endDate = new Date();
        endDate.setDate(endDate.getDate() - 3);
        const startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - days);

        analyticsRows = await queryAnalytics({
            siteUrl,
            startDate: startDate.toISOString().split('T')[0],
            endDate: endDate.toISOString().split('T')[0],
            dimensions: ['query', 'page'],
            limit: 10000
        });
    }

    // Group by query
    const queryMap = new Map<string, Array<{
        page: string;
        clicks: number;
        impressions: number;
        position: number;
        ctr: number;
    }>>();

    for (const row of analyticsRows) {
        const query = row.keys?.[0] ?? '';
        const page = row.keys?.[1] ?? '';
        const impressions = row.impressions ?? 0;

        if (impressions < minImpressions || (row.position ?? 100) > 20) continue;

        if (!queryMap.has(query)) {
            queryMap.set(query, []);
        }

        queryMap.get(query)!.push({
            page,
            clicks: row.clicks ?? 0,
            impressions,
            position: row.position ?? 0,
            ctr: row.ctr ?? 0
        });
    }

    // Find queries with multiple pages
    const cannibalization: CannibalizationIssue[] = [];

    for (const [query, pages] of queryMap) {
        if (pages.length >= 2) {
            // Sort by clicks (highest first)
            pages.sort((a, b) => b.clicks - a.clicks);

            const totalClicks = pages.reduce((sum, p) => sum + p.clicks, 0);

            // Calculate conflict score (0 = one page dominates, 1 = perfectly even split)
            // Simplified Herfindahl-Hirschman Index approach
            const shares = pages.map(p => totalClicks > 0 ? p.clicks / totalClicks : 0);
            const hhi = shares.reduce((sum, s) => sum + s * s, 0);
            const conflictScore = 1 - hhi;

            // Only report if there is actual conflict (not just 1 click vs 1000)
            if (conflictScore > 0.1 || pages[1].impressions > (pages[0].impressions * 0.2)) {
                cannibalization.push({
                    query,
                    pages,
                    totalClicks,
                    totalImpressions: pages.reduce((sum, p) => sum + p.impressions, 0),
                    clickShareConflict: parseFloat(conflictScore.toFixed(2))
                });
            }
        }
    }

    // Sort by conflict severity (impact)
    return cannibalization
        .sort((a, b) => (b.totalClicks * b.clickShareConflict) - (a.totalClicks * a.clickShareConflict))
        .slice(0, limit);
}

/**
 * Identify queries where the site ranks well but converts poorly into clicks.
 *
 * @param siteUrl - The URL of the site to analyze.
 * @param options - Configuration including lookback period and volume thresholds.
 * @returns Queries that rank on page 1 but have below-benchmark CTR.
 */
export async function findLowCTROpportunities(
    siteUrl: string,
    options: { days?: number; minImpressions?: number; limit?: number } = {}
): Promise<LowCTROpportunity[]> {
    const { days = 28, minImpressions = 500, limit = 50 } = options;

    const endDate = new Date();
    endDate.setDate(endDate.getDate() - 3);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - days);

    const rows = await queryAnalytics({
        siteUrl,
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
        dimensions: ['query', 'page'],
        limit: 5000
    });

    // Approximate benchmarks for CTR by position (Web)
    const benchmarks: Record<number, number> = {
        1: 0.30, 2: 0.15, 3: 0.10, 4: 0.06, 5: 0.04,
        6: 0.03, 7: 0.02, 8: 0.015, 9: 0.01, 10: 0.01
    };

    return rows
        .filter(r => (r.impressions ?? 0) > minImpressions && (r.position ?? 100) <= 10)
        .map(r => {
            const pos = Math.round(r.position ?? 10);
            const benchmark = benchmarks[pos] || 0.01;
            const actualCtr = r.ctr ?? 0;

            return {
                query: r.keys?.[0] ?? '',
                page: r.keys?.[1] ?? '',
                position: r.position ?? 0,
                impressions: r.impressions ?? 0,
                clicks: r.clicks ?? 0,
                ctr: actualCtr,
                benchmarkCtr: benchmark
            };
        })
        .filter(item => item.ctr < (item.benchmarkCtr * 0.6)) // Only return if < 60% of benchmark
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, limit);
}

/**
 * Find keywords ranking just off page 1 (positions 8-15).
 *
 * @param siteUrl - The URL of the site to analyze.
 * @param options - Configuration including lookback period and results limit.
 * @returns A list of keywords nearly ranking in high-visibility areas.
 */
export async function findStrikingDistance(
    siteUrl: string,
    options: { days?: number; limit?: number } = {}
): Promise<StrikingDistanceQuery[]> {
    const { days = 28, limit = 50 } = options;

    const endDate = new Date();
    endDate.setDate(endDate.getDate() - 3);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - days);

    const rows = await queryAnalytics({
        siteUrl,
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
        dimensions: ['query', 'page'],
        limit: 5000
    });

    return rows
        .filter(r => {
            const pos = r.position ?? 0;
            return pos >= 8 && pos <= 15;
        })
        .map(r => ({
            query: r.keys?.[0] ?? '',
            page: r.keys?.[1] ?? '',
            position: r.position ?? 0,
            impressions: r.impressions ?? 0,
            clicks: r.clicks ?? 0
        }))
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, limit);
}

/**
 * Identify queries that have lost significant visibility or clicks compared to the previous period.
 *
 * @param siteUrl - The URL of the site to analyze.
 * @param options - Configuration including comparison window and results limit.
 * @returns A list of previously successful keywords that have declined.
 */
export async function findLostQueries(
    siteUrl: string,
    options: { days?: number; limit?: number } = {}
): Promise<LostQuery[]> {
    const { days = 28, limit = 50 } = options;

    // Calculate two periods
    const endDate = new Date();
    endDate.setDate(endDate.getDate() - 3);
    const midDate = new Date(endDate);
    midDate.setDate(midDate.getDate() - days);
    const startDate = new Date(midDate);
    startDate.setDate(startDate.getDate() - days);

    const [current, previous] = await Promise.all([
        queryAnalytics({
            siteUrl,
            startDate: midDate.toISOString().split('T')[0],
            endDate: endDate.toISOString().split('T')[0],
            dimensions: ['query', 'page'],
            limit: 5000
        }),
        queryAnalytics({
            siteUrl,
            startDate: startDate.toISOString().split('T')[0],
            endDate: midDate.toISOString().split('T')[0],
            dimensions: ['query', 'page'],
            limit: 5000
        })
    ]);

    // Map current period for quick lookup
    const currentMap = new Set(current.map(r => `${r.keys?.[0]}|${r.keys?.[1]}`));

    // Find queries present in previous but NOT in current (or very low traffic)
    // "lost" includes queries whose clicks dropped to near zero
    const currentClicksMap = new Map(current.map(r => [`${r.keys?.[0]}|${r.keys?.[1]}`, r.clicks ?? 0]));

    const lostQueries: LostQuery[] = [];

    for (const prev of previous) {
        const key = `${prev.keys?.[0]}|${prev.keys?.[1]}`;
        const prevClicks = prev.clicks ?? 0;

        if (prevClicks < 5) continue; // Ignore low volume noise

        const currClicks = currentClicksMap.get(key) ?? 0;

        // Definition of lost: >80% drop or zero
        if (currClicks === 0 || (currClicks / prevClicks) < 0.2) {
            lostQueries.push({
                query: prev.keys?.[0] ?? '',
                page: prev.keys?.[1] ?? '',
                previousClicks: prevClicks,
                previousImpressions: prev.impressions ?? 0,
                previousPosition: prev.position ?? 0,
                currentClicks: currClicks,
                currentImpressions: 0, // missing from the current period; treated as 0
                currentPosition: 0,
                lostClicks: prevClicks - currClicks
            });
        }
    }

    return lostQueries
        .sort((a, b) => b.lostClicks - a.lostClicks)
        .slice(0, limit);
}

/**
 * Segment search performance into Brand and Non-Brand categories.
 *
 * @param siteUrl - The URL of the site to analyze.
 * @param brandRegexString - A regex pattern to identify brand queries.
 * @param options - Configuration including the lookback period.
 * @returns Comparative metrics for brand vs. non-brand traffic segments.
 */
export async function analyzeBrandVsNonBrand(
    siteUrl: string,
    brandRegexString: string,
    options: { days?: number } = {}
): Promise<BrandVsNonBrandMetrics[]> {
    const { days = 28 } = options;

    const endDate = new Date();
    endDate.setDate(endDate.getDate() - 3);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - days);

    const rows = await queryAnalytics({
        siteUrl,
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
        dimensions: ['query'],
        limit: 10000
    });

    const queries = rows.map(row => row.keys?.[0] ?? '');
    const isBrandResults = safeTestBatch(brandRegexString, 'i', queries);

    const brandStats = { clicks: 0, impressions: 0, ctr: 0, position: 0, queryCount: 0, weightedPos: 0 };
    const nonBrandStats = { clicks: 0, impressions: 0, ctr: 0, position: 0, queryCount: 0, weightedPos: 0 };

    rows.forEach((row, index) => {
        const isBrand = isBrandResults[index];
        const stats = isBrand ? brandStats : nonBrandStats;

        stats.clicks += row.clicks ?? 0;
        stats.impressions += row.impressions ?? 0;
        stats.weightedPos += (row.position ?? 0) * (row.impressions ?? 0);
        stats.queryCount++;
    });

    const calc = (stats: typeof brandStats, segment: 'Brand' | 'Non-Brand'): BrandVsNonBrandMetrics => ({
        segment,
        clicks: stats.clicks,
        impressions: stats.impressions,
        ctr: stats.impressions > 0 ? (stats.clicks / stats.impressions) : 0,
        position: stats.impressions > 0 ? (stats.weightedPos / stats.impressions) : 0,
        queryCount: stats.queryCount
    });

    return [
        calc(brandStats, 'Brand'),
        calc(nonBrandStats, 'Non-Brand')
    ];
}

/**
 * Find pages that are on the verge of ranking on the first page.
 *
 * @param siteUrl - The URL of the site to analyze.
 * @param options - Configuration including lookback period and volume thresholds.
 * @returns A list of "quick win" pages and their queries.
 */
export async function findQuickWins(
    siteUrl: string,
    options: { days?: number; minImpressions?: number; limit?: number } = {},
    rows?: AnalyticsRows,
    keyOrder: 'queryFirst' | 'pageFirst' = 'pageFirst'
): Promise<QuickWin[]> {
    const { days = 28, minImpressions = 100, limit = 20 } = options;

    let analyticsRows: AnalyticsRows;

    if (rows) {
        analyticsRows = rows;
    } else {
        const endDate = new Date();
        endDate.setDate(endDate.getDate() - 3);
        const startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - days);

        analyticsRows = await queryAnalytics({
            siteUrl,
            startDate: startDate.toISOString().split('T')[0],
            endDate: endDate.toISOString().split('T')[0],
            dimensions: ['page', 'query'],
            limit: 10000
        });
        keyOrder = 'pageFirst';
    }

    // Simplified logic: Just find page+query pairs in positions 11-20
    const quickWins: QuickWin[] = analyticsRows
        .map(r => {
            const impressions = r.impressions ?? 0;
            const clicks = r.clicks ?? 0;

            // Estimate potential clicks if moved to top 3 (conservative 15% CTR)
            const potentialClicks = Math.round(impressions * 0.15) - clicks;

            const page = keyOrder === 'pageFirst' ? (r.keys?.[0] ?? '') : (r.keys?.[1] ?? '');
            const query = keyOrder === 'pageFirst' ? (r.keys?.[1] ?? '') : (r.keys?.[0] ?? '');

            return {
                page,
                query,
                position: r.position ?? 0,
                impressions,
                potentialClicks: Math.max(0, potentialClicks)
            };
        })
        .filter(q => q.position >= 11 && q.position <= 20 && q.impressions >= minImpressions)
        .sort((a, b) => b.potentialClicks - a.potentialClicks)
        .slice(0, limit);

    return quickWins;
}

/**
 * Generates a set of prioritized SEO recommendations based on multi-dimensional analysis.
 *
 * @param siteUrl - The URL of the site to analyze.
 * @param options - Configuration including the lookback period.
 * @returns A sorted list of SEO insights, opportunities, and warnings.
 */
export async function generateRecommendations(
    siteUrl: string,
    options: { days?: number } = {}
): Promise<SEOInsight[]> {
    const { days = 28 } = options;
    const insights: SEOInsight[] = [];

    // Fetch superset of data once
    const endDate = new Date();
    endDate.setDate(endDate.getDate() - 3);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - days);

    const analyticsRows = await queryAnalytics({
        siteUrl,
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
        dimensions: ['query', 'page'],
        limit: 10000
    });

    // Run analysis tasks using the shared data
    const [lowHangingFruit, cannibalization, quickWins] = await Promise.all([
        findLowHangingFruit(siteUrl, { days, limit: 10 }, analyticsRows),
        detectCannibalization(siteUrl, { days, limit: 10 }, analyticsRows),
        findQuickWins(siteUrl, { days, limit: 10 }, analyticsRows, 'queryFirst')
    ]);

    // Process low-hanging fruit
    if (lowHangingFruit.length > 0) {
        const totalPotential = lowHangingFruit.reduce((sum, l) => sum + l.potentialClicks, 0);
        insights.push({
            type: 'opportunity',
            category: 'Rankings',
            title: `${lowHangingFruit.length} keywords with ranking potential`,
            description: `Found keywords ranking at positions 5-20 with high impressions. Moving these to top 3 could bring ~${totalPotential} additional clicks.`,
            priority: 'high',
            data: { topKeywords: lowHangingFruit.slice(0, 5).map(l => l.query) }
        });
    }

    // Process cannibalization
    if (cannibalization.length > 0) {
        insights.push({
            type: 'warning',
            category: 'Content',
            title: `${cannibalization.length} keyword cannibalization issues`,
            description: `Multiple pages are competing for the same keywords, diluting ranking potential. Consider consolidating content.`,
            priority: 'medium',
            data: { topIssues: cannibalization.slice(0, 3).map(c => c.query) }
        });
    }

    // Process quick wins
    if (quickWins.length > 0) {
        insights.push({
            type: 'opportunity',
            category: 'Quick Wins',
            title: `${quickWins.length} pages close to page 1`,
            description: `These pages have queries ranking on page 2 (positions 11-20). Small improvements could push them to page 1.`,
            priority: 'high',
            data: { pages: Array.from(new Set(quickWins.slice(0, 5).map(q => q.page))) }
        });
    }

    // Sort by priority
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return insights.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
}
