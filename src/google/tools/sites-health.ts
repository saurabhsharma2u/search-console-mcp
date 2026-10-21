import * as sites from './sites.js';
import * as sitemaps from './sitemaps.js';
import * as analytics from './analytics.js';
import { limitConcurrency } from '../../common/concurrency.js';
import { resolveSitePropertyOrFallback } from '../../common/auth/resolver.js';

/**
 * Health status for a single site property.
 */
export interface SiteHealthReport {
    /** The site URL. */
    siteUrl: string;
    /** Overall status: healthy, warning, or critical. */
    status: 'healthy' | 'warning' | 'critical';
    /** Permission level in Search Console. */
    permissionLevel: string;
    /** Performance comparison: this week vs last week. */
    performance: {
        current: analytics.PerformanceSummary;
        previous: analytics.PerformanceSummary;
        changes: {
            clicks: number;
            clicksPercent: number;
            impressions: number;
            impressionsPercent: number;
            ctr: number;
            ctrPercent: number;
            position: number;
            positionPercent: number;
        };
    };
    /** Sitemap health summary. */
    sitemaps: {
        total: number;
        withErrors: number;
        withWarnings: number;
        details: Array<{
            path: string;
            type: string | undefined;
            isPending: boolean;
            hasErrors: boolean;
            lastDownloaded: string | undefined;
        }>;
    };
    /** Detected anomalies in the last 14 days. */
    anomalies: analytics.AnomalyItem[];
    /** Human-readable list of issues found. */
    issues: string[];
}

/**
 * Run a health check on a single site, returning a structured report.
 *
 * @param siteUrl - The site URL to check.
 * @param existingSiteInfo - Optional. Pre-fetched site info to avoid redundant calls.
 * @returns A health report for the site.
 */
async function checkSite(rawSiteUrl: string, existingSiteInfo?: Awaited<ReturnType<typeof sites.getSite>>): Promise<SiteHealthReport> {
    const siteUrl = await resolveSitePropertyOrFallback(rawSiteUrl, 'google');
    const issues: string[] = [];

    // Run all checks in parallel
    const [siteInfo, sitemapList, comparison, anomalies] = await Promise.all([
        existingSiteInfo ? Promise.resolve(existingSiteInfo) : sites.getSite(siteUrl).catch(() => null),
        sitemaps.listSitemaps(siteUrl).catch(() => []),
        getWeekOverWeekComparison(siteUrl),
        analytics.detectAnomalies(siteUrl, { days: 14, threshold: 2.5 }).catch(() => []),
    ]);

    const permissionLevel = siteInfo?.permissionLevel ?? 'unknown';

    // --- Analyze performance ---
    const { period1, period2, changes } = comparison;

    if (changes.clicksPercent <= -30) {
        issues.push(`Critical traffic drop: clicks down ${Math.abs(changes.clicksPercent).toFixed(1)}% week-over-week`);
    } else if (changes.clicksPercent <= -15) {
        issues.push(`Traffic declining: clicks down ${Math.abs(changes.clicksPercent).toFixed(1)}% week-over-week`);
    }

    if (changes.impressionsPercent <= -30) {
        issues.push(`Critical visibility drop: impressions down ${Math.abs(changes.impressionsPercent).toFixed(1)}% week-over-week`);
    } else if (changes.impressionsPercent <= -15) {
        issues.push(`Visibility declining: impressions down ${Math.abs(changes.impressionsPercent).toFixed(1)}% week-over-week`);
    }

    if (changes.position > 3) {
        issues.push(`Average position worsened by ${changes.position.toFixed(1)} positions`);
    }

    if (period1.clicks === 0 && period1.impressions === 0) {
        issues.push('No traffic data for the current period — site may not be receiving any search traffic');
    }

    // --- Analyze sitemaps ---
    let sitemapsWithErrors = 0;
    let sitemapsWithWarnings = 0;
    const sitemapDetails = sitemapList.map(sm => {
        const hasErrors = (Number(sm.errors) || 0) > 0;
        const isPending = sm.isPending ?? false;
        if (hasErrors) sitemapsWithErrors++;
        if ((Number(sm.warnings) || 0) > 0) sitemapsWithWarnings++;
        return {
            path: sm.path ?? 'unknown',
            type: sm.type ?? undefined,
            isPending,
            hasErrors,
            lastDownloaded: sm.lastDownloaded ?? undefined,
        };
    });

    if (sitemapList.length === 0) {
        issues.push('No sitemaps submitted — consider submitting a sitemap for better crawling');
    }
    if (sitemapsWithErrors > 0) {
        issues.push(`${sitemapsWithErrors} sitemap(s) have errors`);
    }
    if (sitemapsWithWarnings > 0) {
        issues.push(`${sitemapsWithWarnings} sitemap(s) have warnings`);
    }

    // --- Analyze anomalies ---
    const drops = anomalies.filter(a => a.type === 'drop');
    if (drops.length > 0) {
        issues.push(`${drops.length} traffic anomaly drop(s) detected in the last 14 days`);
    }

    // --- Determine overall status ---
    let status: SiteHealthReport['status'] = 'healthy';
    if (issues.some(i => i.startsWith('Critical') || i.includes('No traffic data'))) {
        status = 'critical';
    } else if (issues.length > 0) {
        status = 'warning';
    }

    return {
        siteUrl,
        status,
        permissionLevel,
        performance: {
            current: period1,
            previous: period2,
            changes,
        },
        sitemaps: {
            total: sitemapList.length,
            withErrors: sitemapsWithErrors,
            withWarnings: sitemapsWithWarnings,
            details: sitemapDetails,
        },
        anomalies,
        issues,
    };
}

/**
 * Get a week-over-week performance comparison for a site.
 */
async function getWeekOverWeekComparison(siteUrl: string): Promise<analytics.PeriodComparison> {
    const DATA_DELAY_DAYS = 3;
    const nowMs = Date.now();
    const DAY_MS = 86_400_000;

    const p1EndMs = nowMs - DATA_DELAY_DAYS * DAY_MS;
    const p1StartMs = p1EndMs - 7 * DAY_MS;
    const p2EndMs = p1StartMs - DAY_MS;
    const p2StartMs = p2EndMs - 7 * DAY_MS;

    const fmt = (ms: number) => new Date(ms).toISOString().split('T')[0];

    return analytics.comparePeriods(
        siteUrl,
        fmt(p1StartMs),
        fmt(p1EndMs),
        fmt(p2StartMs),
        fmt(p2EndMs),
    );
}

/**
 * Run a health check on one or all verified sites.
 *
 * @param siteUrl - Optional. If provided, check only this site. If omitted, check all verified sites.
 * @returns An array of health reports.
 */
export async function healthCheck(siteUrl?: string): Promise<SiteHealthReport[]> {
    if (siteUrl) {
        const report = await checkSite(siteUrl);
        return [report];
    }

    const allSites = await sites.listSites();
    if (allSites.length === 0) {
        return [];
    }

    const reports = await limitConcurrency(allSites, 5, site => checkSite(site.siteUrl!, site));

    // Sort: critical first, then warning, then healthy
    const order = { critical: 0, warning: 1, healthy: 2 };
    return reports.sort((a, b) => order[a.status] - order[b.status]);
}

