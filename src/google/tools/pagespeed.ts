import { google, pagespeedonline_v5 } from 'googleapis';
import { existsSync, readFileSync } from 'node:fs';

const pagespeed = google.pagespeedonline('v5');
let cachedApiKey: string | undefined;

/**
 * Summary of PageSpeed Insights analysis results, including scores and CWV.
 */
export interface PageSpeedResult {
    /** The analyzed URL. */
    url: string;
    /** The strategy used (mobile or desktop). */
    strategy: 'mobile' | 'desktop';
    /** Lighthouse Performance score (0-100). */
    performanceScore: number;
    /** Lighthouse Accessibility score (0-100). */
    accessibilityScore: number;
    /** Lighthouse Best Practices score (0-100). */
    bestPracticesScore: number;
    /** Lighthouse SEO score (0-100). */
    seoScore: number;
    /** Core Web Vitals and other key lab metrics. */
    coreWebVitals: {
        largestContentfulPaint: number | null;
        firstInputDelay: number | null;
        cumulativeLayoutShift: number | null;
        firstContentfulPaint: number | null;
        timeToInteractive: number | null;
        totalBlockingTime: number | null;
    };
    /** Historical field data from real-world user experience (CrUX). */
    loadingExperience: {
        overallCategory: string | null;
        metrics: Record<string, {
            percentile: number;
            category: string;
        }>;
    } | null;
}

/**
 * Run a full PageSpeed Insights analysis on a URL.
 *
 * @param url - The URL to analyze.
 * @param strategy - Whether to test for 'mobile' or 'desktop'. Defaults to 'mobile'.
 * @returns Performance, accessibility, and SEO scores along with field/lab metrics.
 */
export async function analyzePageSpeed(
    url: string,
    strategy: 'mobile' | 'desktop' = 'mobile'
): Promise<PageSpeedResult> {
    const res = await pagespeed.pagespeedapi.runpagespeed({
        url,
        strategy,
        category: ['performance', 'accessibility', 'best-practices', 'seo'],
        key: getPageSpeedApiKey()
    });

    const data = res.data;
    const lighthouse = data.lighthouseResult;
    const categories = lighthouse?.categories;
    const audits = lighthouse?.audits;

    // Extract Core Web Vitals from audits
    const coreWebVitals = {
        largestContentfulPaint: audits?.['largest-contentful-paint']?.numericValue ?? null,
        firstInputDelay: audits?.['max-potential-fid']?.numericValue ?? null,
        cumulativeLayoutShift: audits?.['cumulative-layout-shift']?.numericValue ?? null,
        firstContentfulPaint: audits?.['first-contentful-paint']?.numericValue ?? null,
        timeToInteractive: audits?.['interactive']?.numericValue ?? null,
        totalBlockingTime: audits?.['total-blocking-time']?.numericValue ?? null,
    };

    // Extract Loading Experience (real-world CrUX data)
    const loadingExp = data.loadingExperience;
    const loadingExperience = loadingExp ? {
        overallCategory: loadingExp.overall_category ?? null,
        metrics: Object.fromEntries(
            Object.entries(loadingExp.metrics || {}).map(([key, value]) => [
                key,
                {
                    percentile: (value as pagespeedonline_v5.Schema$UserPageLoadMetricV5).percentile ?? 0,
                    category: (value as pagespeedonline_v5.Schema$UserPageLoadMetricV5).category ?? 'NONE'
                }
            ])
        )
    } : null;

    return {
        url,
        strategy,
        performanceScore: (categories?.performance?.score ?? 0) * 100,
        accessibilityScore: (categories?.accessibility?.score ?? 0) * 100,
        bestPracticesScore: (categories?.['best-practices']?.score ?? 0) * 100,
        seoScore: (categories?.seo?.score ?? 0) * 100,
        coreWebVitals,
        loadingExperience
    };
}

function getPageSpeedApiKey(): string | undefined {
    if (cachedApiKey !== undefined) return cachedApiKey || undefined;

    const direct = process.env.PAGESPEED_API_KEY || process.env.GOOGLE_WEB_VITALS_API_KEY;
    if (direct?.trim()) {
        cachedApiKey = direct.trim();
        return cachedApiKey;
    }

    const filePath = process.env.PAGESPEED_API_KEY_FILE
        || process.env.CRUX_API_KEY_FILE
        || process.env.GOOGLE_WEB_VITALS_API_KEY_FILE;

    if (filePath && existsSync(filePath)) {
        cachedApiKey = readFileSync(filePath, 'utf8').trim();
        return cachedApiKey || undefined;
    }

    cachedApiKey = '';
    return undefined;
}

/**
 * Get a comparative Core Web Vitals summary for both mobile and desktop.
 *
 * @param url - The URL to analyze.
 * @returns Results for both mobile and desktop strategies.
 */
export async function getCoreWebVitals(url: string): Promise<{
    mobile: PageSpeedResult;
    desktop: PageSpeedResult;
}> {
    const [mobile, desktop] = await Promise.all([
        analyzePageSpeed(url, 'mobile'),
        analyzePageSpeed(url, 'desktop')
    ]);

    return { mobile, desktop };
}
