import * as bingSites from './sites.js';
import * as bingSitemaps from './sitemaps.js';
import * as bingAnalytics from './analytics.js';
import * as bingCrawl from './crawl.js';
import { limitConcurrency } from '../../common/concurrency.js';

/**
 * Health status for a single Bing site property.
 */
export interface BingSiteHealthReport {
    siteUrl: string;
    status: 'healthy' | 'warning' | 'critical';
    performance: {
        current: bingAnalytics.PerformanceSummary;
        previous: bingAnalytics.PerformanceSummary;
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
    sitemaps: {
        total: number;
        details: Array<{
            path: string;
            status: string;
            lastSubmitted: string;
        }>;
    };
    crawl: {
        issues: number;
        recentStats: any[];
    };
    anomalies: any[];
    issues: string[];
}

/**
 * Run a health check on a single Bing site.
 */
async function checkSite(siteUrl: string): Promise<BingSiteHealthReport> {
    const issues: string[] = [];

    const [sitemapList, comparison, anomalies, crawlIssues, crawlStats] = await Promise.all([
        bingSitemaps.listSitemaps(siteUrl).catch(() => []),
        getWeekOverWeekComparison(siteUrl),
        bingAnalytics.detectAnomalies(siteUrl, { days: 14, threshold: 2.5 }).catch(() => []),
        bingCrawl.getCrawlIssues(siteUrl).catch(() => []),
        bingCrawl.getCrawlStats(siteUrl).catch(() => []),
    ]);

    const { period1, period2, changes } = comparison;

    // --- Performance Analysis ---
    if (changes.clicksPercent <= -30) {
        issues.push(`Critical traffic drop: clicks down ${Math.abs(changes.clicksPercent).toFixed(1)}% week-over-week`);
    } else if (changes.clicksPercent <= -15) {
        issues.push(`Traffic declining: clicks down ${Math.abs(changes.clicksPercent).toFixed(1)}% week-over-week`);
    }

    if (period1.clicks === 0 && period1.impressions === 0) {
        issues.push('No traffic data for the current period');
    }

    // --- Sitemap Analysis ---
    const sitemapDetails = sitemapList.map((sm: any) => ({
        path: sm.Path || 'unknown',
        status: sm.Status || 'unknown',
        lastSubmitted: sm.Submitted || 'unknown'
    }));

    if (sitemapList.length === 0) {
        issues.push('No sitemaps submitted to Bing');
    }

    // --- Crawl Analysis ---
    if (crawlIssues.length > 0) {
        issues.push(`${crawlIssues.length} crawl issues detected by Bing`);
    }

    const latestCrawl = crawlStats[0];
    if (latestCrawl && latestCrawl.CrawlErrors > 0) {
        issues.push(`Crawl errors detected in recent Bing stats: ${latestCrawl.CrawlErrors}`);
    }

    // --- Anomaly Analysis ---
    if (anomalies.length > 0) {
        issues.push(`${anomalies.length} traffic anomaly drop(s) detected in the last 14 days`);
    }

    // --- Overall Status ---
    let status: BingSiteHealthReport['status'] = 'healthy';
    if (issues.some(i => i.startsWith('Critical') || i.includes('No traffic data'))) {
        status = 'critical';
    } else if (issues.length > 0) {
        status = 'warning';
    }

    return {
        siteUrl,
        status,
        performance: {
            current: period1,
            previous: period2,
            changes,
        },
        sitemaps: {
            total: sitemapList.length,
            details: sitemapDetails,
        },
        crawl: {
            issues: crawlIssues.length,
            recentStats: crawlStats.slice(0, 5),
        },
        anomalies,
        issues,
    };
}

/**
 * Get week-over-week comparison using Bing data.
 */
async function getWeekOverWeekComparison(siteUrl: string): Promise<bingAnalytics.PeriodComparison> {
    const DATA_DELAY_DAYS = 3;
    const now = new Date();

    const period1End = new Date(now);
    period1End.setDate(period1End.getDate() - DATA_DELAY_DAYS);
    const period1Start = new Date(period1End);
    period1Start.setDate(period1Start.getDate() - 7);

    const period2End = new Date(period1Start);
    period2End.setDate(period2End.getDate() - 1);
    const period2Start = new Date(period2End);
    period2Start.setDate(period2Start.getDate() - 7);

    const fmt = (d: Date) => d.toISOString().split('T')[0];

    return bingAnalytics.comparePeriods(
        siteUrl,
        fmt(period1Start),
        fmt(period1End),
        fmt(period2Start),
        fmt(period2End),
    );
}

/**
 * Run a health check on one or all Bing sites.
 */
export async function healthCheck(siteUrl?: string): Promise<BingSiteHealthReport[]> {
    if (siteUrl) {
        const report = await checkSite(siteUrl);
        return [report];
    }

    const allSites = await bingSites.listSites();
    if (allSites.length === 0) {
        return [];
    }

    const reports = await limitConcurrency(allSites, 5, (site: any) => checkSite(site.Url));

    const order: Record<string, number> = { critical: 0, warning: 1, healthy: 2 };
    return reports.sort((a, b) => (order[a.status] || 0) - (order[b.status] || 0));
}
