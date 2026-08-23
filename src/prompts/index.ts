import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getEnabledPlatforms } from "../common/platforms.js";

/**
 * Helper to build a numbered step list. Automatically increments
 * the step counter so optional/conditional steps don't break numbering.
 */
class StepBuilder {
    private steps: string[] = [];
    private counter = 1;

    add(text: string): void {
        this.steps.push(`${this.counter}. ${text}`);
        this.counter++;
    }

    /** Add a final synthesis instruction (unnumbered). */
    synthesize(text: string): void {
        this.steps.push(`\nFinally: ${text}`);
    }

    toString(): string {
        return this.steps.join("\n");
    }

    get length(): number {
        return this.steps.length;
    }
}

/**
 * Escape user-supplied brand terms for safe interpolation into regex strings.
 * Strips characters that could break regex parsing.
 */
function sanitizeBrandTerms(terms: string): string {
    // Split on commas, trim, remove any regex-special chars except alphanumeric/space/hyphen
    return terms
        .split(",")
        .map(t => t.trim().replace(/[^a-zA-Z0-9\s\-]/g, ""))
        .filter(Boolean)
        .join("|");
}

export function registerPrompts(server: McpServer) {

    // ────────────────────────────────────────────────────────────────
    // 1. Investigate Traffic Drop
    // ────────────────────────────────────────────────────────────────
    server.prompt(
        "investigate_traffic_drop",
        {
            site_url: z.string().optional().describe("The URL of the site (optional, defaults to env/context)"),
            period: z.string().optional().describe("Period to analyze (default: 'last 28 days')")
        },
        async ({ site_url, period = "last 28 days" }) => {
            const { isGoogleEnabled, isBingEnabled, isGA4Enabled } = await getEnabledPlatforms();
            const steps = new StepBuilder();

            if (isGoogleEnabled) {
                steps.add("Run 'analytics_anomalies' to confirm a drop exists and find the exact date it started.");
                steps.add("Run 'analytics_time_series' to visualize the trend and check for seasonality.");
                steps.add("Run 'analytics_drop_attribution' to identify whether the loss is concentrated on mobile or desktop.");
                steps.add("Fetch the top affected pages by comparing two date ranges around the drop date (use 'analytics_compare_periods').");
                steps.add("For the top 3 affected pages, run 'inspection_inspect' to check indexing status.");
            }
            if (isBingEnabled) {
                steps.add("Run 'bing_analytics_detect_anomalies' to check for traffic anomalies on Bing.");
                steps.add("Run 'bing_analytics_drop_attribution' to identify the cause of any Bing traffic drop.");
            }
            if (isGA4Enabled) {
                steps.add("Run 'analytics_realtime' to see if current traffic is flowing.");
                steps.add("Run 'analytics_user_behavior' to check if the drop is specific to a country or device category.");
                if (isGoogleEnabled) {
                    steps.add("Run 'traffic_health_check' to compare GSC clicks vs GA4 organic sessions (diagnose tracking issues).");
                }
            }
            steps.synthesize("Synthesize findings into: when it started, what pages/devices are affected, likely cause, and 3 recommended actions.");

            return {
                messages: [{
                    role: "user",
                    content: {
                        type: "text",
                        text: `Investigate a traffic drop for ${site_url || "the active site"} over the ${period}.\n\nWorkflow:\n${steps}`
                    }
                }]
            };
        }
    );

    // ────────────────────────────────────────────────────────────────
    // 2. Find Quick Wins
    // ────────────────────────────────────────────────────────────────
    server.prompt(
        "find_quick_wins",
        {
            site_url: z.string().optional().describe("The URL of the site"),
            min_impressions: z.number().optional().describe("Minimum impressions threshold (default: 1000)"),
            date_range: z.string().optional().describe("Date range to analyze (default: 'last 90 days')")
        },
        async ({ site_url, min_impressions = 1000, date_range = "last 90 days" }) => {
            const { isGoogleEnabled, isBingEnabled, isGA4Enabled } = await getEnabledPlatforms();
            const steps = new StepBuilder();

            if (isGoogleEnabled) {
                steps.add(`Run 'seo_striking_distance' with minImpressions=${min_impressions} to get candidates in positions 8-15.`);
                steps.add(`Run 'seo_low_hanging_fruit' with minImpressions=${min_impressions} to get candidates in positions 5-20.`);
                steps.add("For the top 5 candidates, run 'pagespeed_analyze' to check performance.");
            }
            if (isBingEnabled) {
                steps.add(`Run 'bing_striking_distance' to find Bing keywords in positions 8-15.`);
                steps.add(`Run 'bing_opportunity_finder' to find high-potential keywords on Bing.`);
            }
            if (isGA4Enabled && isGoogleEnabled) {
                steps.add("Run 'page_analysis' to find pages with good GSC potential but poor GA4 engagement.");
                steps.add("Run 'analytics_pagespeed_correlation' to see if speed improvements would boost engagement on top pages.");
            }
            steps.synthesize("Output a ranked action list: page URL, current position, impressions, what to fix, expected impact.");

            return {
                messages: [{
                    role: "user",
                    content: {
                        type: "text",
                        text: `Find quick win SEO opportunities for ${site_url || "the active site"} (${date_range}, minimum ${min_impressions} impressions).\n\nWorkflow:\n${steps}`
                    }
                }]
            };
        }
    );

    // ────────────────────────────────────────────────────────────────
    // 3. Full Site Audit
    // ────────────────────────────────────────────────────────────────
    server.prompt(
        "full_site_audit",
        {
            site_url: z.string().optional().describe("The URL of the site"),
            brand_terms: z.string().optional().describe("Comma-separated brand terms (e.g. 'nike,air max')"),
            date_range: z.string().optional().describe("Date range to analyze (default: 'last 90 days')")
        },
        async ({ site_url, brand_terms, date_range = "last 90 days" }) => {
            const { isGoogleEnabled, isBingEnabled, isGA4Enabled } = await getEnabledPlatforms();
            const steps = new StepBuilder();

            if (isGoogleEnabled) {
                steps.add("Run 'sites_list' to confirm the property is accessible.");
                if (brand_terms) {
                    const sanitized = sanitizeBrandTerms(brand_terms);
                    steps.add(`Run 'seo_brand_vs_nonbrand' with regex '(${sanitized})' to see the brand vs non-brand split.`);
                }
                steps.add("Run 'seo_cannibalization' to flag any competing pages.");
                steps.add("Run 'seo_lost_queries' to flag any queries that dropped to zero traffic.");
                steps.add("Run 'seo_low_ctr_opportunities' to find pages ranking well but not getting clicked.");
                steps.add("List all sitemaps ('sitemaps_list') and flag any with errors.");
            }
            if (isBingEnabled) {
                steps.add("Run 'bing_sites_health' to get overall Bing site health status.");
                steps.add("Run 'bing_crawl_issues' to identify crawl problems on Bing.");
                steps.add("Run 'bing_seo_recommendations' to get Bing-specific optimization suggestions.");
            }
            if (isGA4Enabled) {
                steps.add("Run 'analytics_user_behavior' to get an overview of audience health.");
                steps.add("Run 'analytics_traffic_sources' to check the mix of traffic (Organic vs Direct/Social).");
                steps.add("Run 'analytics_conversion_funnel' to flag any drops in user conversion.");
                if (isGoogleEnabled && isBingEnabled) {
                    steps.add("Run 'opportunity_matrix' to get a prioritized list of tasks across all platforms.");
                }
            }
            steps.synthesize("Synthesize into an executive summary: overall health score, top 3 wins, top 3 risks, recommended priority order.");

            return {
                messages: [{
                    role: "user",
                    content: {
                        type: "text",
                        text: `Perform a full site audit for ${site_url || "the active site"} (${date_range}).\n\nWorkflow:\n${steps}`
                    }
                }]
            };
        }
    );

    // ────────────────────────────────────────────────────────────────
    // 4. Analyze Page
    // ────────────────────────────────────────────────────────────────
    server.prompt(
        "analyze_page",
        {
            page_url: z.string().describe("The page URL to analyze"),
            date_range: z.string().optional().describe("Date range to analyze (default: 'last 28 days')")
        },
        async ({ page_url, date_range = "last 28 days" }) => {
            const { isGoogleEnabled, isBingEnabled, isGA4Enabled } = await getEnabledPlatforms();
            const steps = new StepBuilder();

            if (isGoogleEnabled) {
                steps.add("Run 'inspection_inspect' for indexing status and mobile usability.");
                steps.add("Run 'analytics_query' filtered to this page (and query dimension) for clicks, impressions, CTR, position.");
                steps.add("Run 'analytics_trends' for this page to see if it is rising or falling.");
                steps.add("Run 'pagespeed_analyze' for performance audit.");
                steps.add("Run 'schema_validate' to check structured data.");
            }
            if (isBingEnabled) {
                steps.add("Run 'bing_url_info' to get Bing indexing and crawl information for this page.");
                steps.add("Run 'bing_analytics_page_query' to get Bing search performance data for this page.");
            }
            if (isGA4Enabled) {
                steps.add("Run 'analytics_page_performance' for this specific page path to see engagement and session metrics.");
            }
            steps.synthesize("Is this page healthy? What is its biggest limiting factor right now (rankings, CTR, speed, or indexing)?");

            return {
                messages: [{
                    role: "user",
                    content: {
                        type: "text",
                        text: `Deep-dive analysis for page: ${page_url} (${date_range}).\n\nWorkflow:\n${steps}`
                    }
                }]
            };
        }
    );

    // ────────────────────────────────────────────────────────────────
    // 5. Platform Comparison
    // ────────────────────────────────────────────────────────────────
    server.prompt(
        "platform_comparison",
        {
            site_url: z.string().optional().describe("The URL of the site"),
            date_range: z.string().optional().describe("Date range (default: 'last 28 days')")
        },
        async ({ site_url, date_range = "last 28 days" }) => {
            const { isGoogleEnabled, isBingEnabled, isGA4Enabled } = await getEnabledPlatforms();
            const steps = new StepBuilder();

            if (isGoogleEnabled && isBingEnabled) {
                steps.add("Run 'compare_engines' with dimension='query' to get the full side-by-side ranking table.");
                steps.add("Identify the top 10 queries where Bing rank is significantly better than Google rank.");
                steps.add("Identify the top 10 queries where Google rank is significantly better than Bing rank.");
                if (isGA4Enabled) {
                    steps.add("Run 'brand_analysis' with brand terms to compare brand strength across GSC, Bing, and GA4 Organic.");
                } else {
                    steps.add("Run brand analysis across both platforms (using 'seo_brand_vs_nonbrand' for Google).");
                }
                steps.synthesize("Which platform needs more attention, what the cross-platform opportunity is worth, and 3 specific actions.");
            } else {
                steps.synthesize("Note: This workflow requires both Google and Bing to be enabled. Please configure both platforms and try again.");
            }

            return {
                messages: [{
                    role: "user",
                    content: {
                        type: "text",
                        text: `Compare Google and Bing performance for ${site_url || "the active site"} (${date_range}).\n\nWorkflow:\n${steps}`
                    }
                }]
            };
        }
    );

    // ────────────────────────────────────────────────────────────────
    // 6. Content Opportunity Report
    // ────────────────────────────────────────────────────────────────
    server.prompt(
        "content_opportunity_report",
        {
            site_url: z.string().optional().describe("The URL of the site"),
            date_range: z.string().optional().describe("Date range (default: 'last 90 days')")
        },
        async ({ site_url, date_range = "last 90 days" }) => {
            const { isGoogleEnabled, isBingEnabled, isGA4Enabled } = await getEnabledPlatforms();
            const steps = new StepBuilder();

            if (isGoogleEnabled) {
                steps.add("Run 'seo_low_ctr_opportunities' — good rankings but poor CTR means the title/meta needs work.");
                steps.add("Run 'seo_cannibalization' — check if competing pages dilute authority.");
                steps.add("Run 'seo_lost_queries' — topics you used to rank for but no longer do represent content decay.");
            }
            if (isBingEnabled) {
                steps.add("Run 'bing_low_ctr_opportunities' to find Bing queries with good rankings but poor click-through rates.");
            }
            if (isGA4Enabled) {
                steps.add("Run 'analytics_content_performance' to identify content groups that are over or under-performing in engagement.");
            }
            steps.synthesize('Synthesize into three buckets: "optimize existing" (low CTR fixes), "consolidate" (cannibalization fixes), "revive or create" (lost queries + content gaps).');

            return {
                messages: [{
                    role: "user",
                    content: {
                        type: "text",
                        text: `Generate a content opportunity report for ${site_url || "the active site"} (${date_range}).\n\nWorkflow:\n${steps}`
                    }
                }]
            };
        }
    );

    // ────────────────────────────────────────────────────────────────
    // 7. Executive Summary
    // ────────────────────────────────────────────────────────────────
    server.prompt(
        "executive_summary",
        {
            site_url: z.string().optional().describe("The URL of the site"),
            brand_terms: z.string().optional().describe("Brand terms for segmentation (e.g. 'nike,air max')"),
            date_range: z.string().optional().describe("Date range (default: 'last 28 days')"),
            compare_to: z.string().optional().describe("Comparison period (default: 'previous period')")
        },
        async ({ site_url, brand_terms, date_range = "last 28 days", compare_to = "previous period" }) => {
            const { isGoogleEnabled, isBingEnabled, isGA4Enabled } = await getEnabledPlatforms();
            const steps = new StepBuilder();

            if (isGoogleEnabled) {
                steps.add(`Run 'analytics_compare_periods' (current ${date_range} vs ${compare_to}) to get the top-level trend.`);
                if (brand_terms) {
                    const sanitized = sanitizeBrandTerms(brand_terms);
                    steps.add(`Run 'seo_brand_vs_nonbrand' with regex '(${sanitized})' — brand-heavy traffic is a risk indicator.`);
                }
                steps.add("Run 'analytics_anomalies' to surface any spikes or drops worth flagging.");
            }
            if (isBingEnabled) {
                steps.add(`Run 'bing_analytics_compare_periods' (current ${date_range} vs ${compare_to}) for Bing trend data.`);
                steps.add("Run 'bing_analytics_detect_anomalies' to check for Bing traffic anomalies.");
            }
            if (isGA4Enabled) {
                steps.add("Run 'analytics_user_behavior' to check engagement metrics (engagement rate, sessions per user) compared to baseline.");
                steps.add("Run 'analytics_traffic_sources' to flag any significant shifts in acquisition channels.");
            }
            steps.synthesize("Synthesize into: one-paragraph performance narrative, three bullet wins, three bullet risks, five recommended actions ranked by impact, one key metric to watch next month.");

            return {
                messages: [{
                    role: "user",
                    content: {
                        type: "text",
                        text: `Generate an executive SEO summary for ${site_url || "the active site"} (${date_range}, compared to ${compare_to}).\n\nWorkflow:\n${steps}`
                    }
                }]
            };
        }
    );

    // ────────────────────────────────────────────────────────────────
    // 8. GA4 Acquisition & Conversion
    // ────────────────────────────────────────────────────────────────
    server.prompt(
        "ga4_traffic_audit",
        {
            property_id: z.string().describe("GA4 Property ID"),
            date_range: z.string().optional().describe("Date range (default: 'last 28 days')")
        },
        ({ property_id, date_range = "last 28 days" }) => {
            const steps = new StepBuilder();
            steps.add("Run 'analytics_traffic_sources' to identify top acquisition channels.");
            steps.add("Run 'analytics_organic_landing_pages' to see which pages are driving organic traffic.");
            steps.add("Run 'analytics_conversion_funnel' to see if top traffic sources are converting.");
            steps.add("Run 'analytics_user_behavior' to check engagement quality across devices.");
            steps.synthesize("Which traffic channel is most valuable, where is the highest drop-off in the funnel, and 3 recommendations to improve ROI.");

            return {
                messages: [{
                    role: "user",
                    content: {
                        type: "text",
                        text: `Perform a GA4 traffic and acquisition audit for property ${property_id} (${date_range}).\n\nWorkflow:\n${steps}`
                    }
                }]
            };
        }
    );

    // ────────────────────────────────────────────────────────────────
    // 9. AdSense Earnings Review
    // ────────────────────────────────────────────────────────────────
    server.prompt(
        "adsense_earnings_review",
        {
            date_range: z.string().optional().describe("Date range to analyze (default: 'last 28 days')")
        },
        async ({ date_range = "last 28 days" }) => {
            const { isAdSenseEnabled } = await getEnabledPlatforms();
            const steps = new StepBuilder();

            if (isAdSenseEnabled) {
                steps.add(`Run 'adsense_report' with startDate/endDate covering the ${date_range} and dimension DATE to get the daily earnings trend.`);
                steps.add("Run 'adsense_report' broken down by DOMAIN_NAME to see which properties earn the most.");
                steps.add("Run 'adsense_payments_alerts' to check outstanding balance and any account alerts.");
                steps.synthesize("Summarize: total earnings for the period, best and worst days, which domain drives revenue, current unpaid balance, and any policy alerts that need attention.");
            } else {
                steps.synthesize("Note: No AdSense account is configured. Run 'search-console-mcp setup --engine=adsense' first.");
            }

            return {
                messages: [{
                    role: "user",
                    content: {
                        type: "text",
                        text: `Review my Google AdSense earnings performance (${date_range}).\n\nWorkflow:\n${steps}`
                    }
                }]
            };
        }
    );

    // ────────────────────────────────────────────────────────────────
    // 10. AdSense Monetization Audit
    // ────────────────────────────────────────────────────────────────
    server.prompt(
        "adsense_monetization_audit",
        {
            date_range: z.string().optional().describe("Date range to analyze (default: 'last 30 days')")
        },
        async ({ date_range = "last 30 days" }) => {
            const { isAdSenseEnabled } = await getEnabledPlatforms();
            const steps = new StepBuilder();

            if (isAdSenseEnabled) {
                steps.add(`Run 'adsense_report' for the ${date_range} broken down by AD_UNIT_NAME, ordered by ESTIMATED_EARNINGS descending, to find top-earning ad units.`);
                steps.add("Run 'adsense_report' broken down by PLATFORM_TYPE_NAME to compare mobile vs desktop monetization.");
                steps.add("Run 'adsense_report' broken down by COUNTRY_NAME to see geography-based RPM differences.");
                steps.add("Identify ad units with high impressions but low CTR or low PAGE_VIEWS_RPM — these are optimization candidates.");
                steps.add("Run 'adsense_payments_alerts' to surface policy issues that could suppress earnings.");
                steps.synthesize("Deliver an action list ranked by revenue impact: which ad units to reposition/test, which platforms or geographies are under-monetized, and any compliance risks.");
            } else {
                steps.synthesize("Note: No AdSense account is configured. Run 'search-console-mcp setup --engine=adsense' first.");
            }

            return {
                messages: [{
                    role: "user",
                    content: {
                        type: "text",
                        text: `Audit my AdSense monetization efficiency and find revenue opportunities (${date_range}).\n\nWorkflow:\n${steps}`
                    }
                }]
            };
        }
    );

    // ────────────────────────────────────────────────────────────────
    // 11. v2.0 Fluent MCP Prompts (MCP 2026-07-28 Spec)
    // ────────────────────────────────────────────────────────────────
    server.prompt(
        "seo_traffic_detective",
        {
            siteUrl: z.string().optional().describe("Target property URL (e.g., https://example.com)"),
            days: z.string().optional().describe("Number of days to analyze (default: 30)")
        },
        ({ siteUrl = "the active site", days = "30" }) => ({
            messages: [{
                role: "user",
                content: {
                    type: "text",
                    text: `Investigate traffic drops for site "${siteUrl}" over the past ${days} days.\n\n` +
                        `Please perform the following steps:\n` +
                        `1. Call 'site_health_check' for "${siteUrl}" to check overall status.\n` +
                        `2. Call 'analytics_query' to fetch daily time-series performance.\n` +
                        `3. Check if any traffic drop correlates with known search algorithm updates.\n` +
                        `4. Identify top affected landing pages and queries and summarize key findings.`
                }
            }]
        })
    );

    server.prompt(
        "seo_striking_distance",
        {
            siteUrl: z.string().optional().describe("Target property URL (e.g., https://example.com)"),
            minImpressions: z.string().optional().describe("Minimum impressions threshold (default: 500)")
        },
        ({ siteUrl = "the active site", minImpressions = "500" }) => ({
            messages: [{
                role: "user",
                content: {
                    type: "text",
                    text: `Find "striking distance" keyword opportunities for site "${siteUrl}".\n\n` +
                        `Target queries ranking in positions 8 through 15 with at least ${minImpressions} impressions.\n` +
                        `1. Call 'seo_audit' with action='striking_distance' for "${siteUrl}".\n` +
                        `2. Identify top 5 high-potential queries for quick CTR and ranking gains.\n` +
                        `3. Recommend specific title tag and content optimization improvements for target pages.`
                }
            }]
        })
    );

    server.prompt(
        "seo_cannibalization_audit",
        {
            siteUrl: z.string().optional().describe("Target property URL (e.g., https://example.com)")
        },
        ({ siteUrl = "the active site" }) => ({
            messages: [{
                role: "user",
                content: {
                    type: "text",
                    text: `Run a keyword cannibalization audit for site "${siteUrl}".\n\n` +
                        `1. Call 'seo_audit' with action='cannibalization' for "${siteUrl}".\n` +
                        `2. List all search queries where two or more URLs are splitting search impressions.\n` +
                        `3. Provide clear canonicalization or content consolidation recommendations.`
                }
            }]
        })
    );

    server.prompt(
        "seo_compare_google_bing",
        {
            siteUrl: z.string().optional().describe("Target property URL (e.g., https://example.com)"),
            days: z.string().optional().describe("Comparison window in days (default: 30)")
        },
        ({ siteUrl = "the active site", days = "30" }) => ({
            messages: [{
                role: "user",
                content: {
                    type: "text",
                    text: `Compare search performance for site "${siteUrl}" across Google Search Console and Bing Webmaster Tools for the last ${days} days.\n\n` +
                        `1. Call 'analytics_query' with engine='all' for site "${siteUrl}".\n` +
                        `2. Compare total clicks, impressions, and average position on Google vs Bing.\n` +
                        `3. Highlight queries that perform significantly better on Bing than Google.`
                }
            }]
        })
    );
}

export const registerMcpPrompts = registerPrompts;
