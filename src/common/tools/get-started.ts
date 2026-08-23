import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatError } from "../errors.js";
import { getEnabledPlatforms } from "../platforms.js";

export const getStartedToolName = "get_started";
export const getStartedToolDescription = "Start here. Returns a complete map of this server's capabilities, active platforms, and recommended workflows. Call this once at the beginning of any session.";

export const getStartedToolSchema = {};

export async function getStartedHandler() {
    try {
        const { isGoogleEnabled, isBingEnabled, isGA4Enabled } = await getEnabledPlatforms();

        const activePlatforms: Record<string, string> = {};
        if (isGoogleEnabled) activePlatforms["google"] = "Google Search Console (Search Analytics, Sitemaps, Inspection)";
        if (isBingEnabled) activePlatforms["bing"] = "Bing Webmaster Tools (Search Performance, Sitemaps, Crawl Issues)";
        if (isGA4Enabled) activePlatforms["ga4"] = "Google Analytics 4 (Traffic Sources, Realtime, Page Performance, Behavior)";

        const intentGroups = [
            {
                name: "Diagnose Traffic Problems",
                tools: [
                    ...(isGoogleEnabled ? [
                        {
                            name: "analytics_anomalies",
                            purpose: "Identify unusual daily spikes or drops in traffic.",
                            prefer_over: "analytics_trends (for sudden changes vs gradual shifts)",
                            next_tool: "analytics_drop_attribution"
                        },
                        {
                            name: "analytics_drop_attribution",
                            purpose: "Analyze a significant traffic drop to identify cause (mobile/desktop or algo update).",
                            prefer_over: "analytics_anomalies (when a drop is already confirmed)",
                            next_tool: "analytics_compare_periods"
                        },
                        {
                            name: "analytics_trends",
                            purpose: "Detect gradual rising or declining trends for queries or pages.",
                            prefer_over: "analytics_anomalies (for long-term shifts)",
                            next_tool: "analytics_query"
                        }
                    ] : []),
                    ...(isBingEnabled ? [
                        {
                            name: "bing_analytics_detect_anomalies",
                            purpose: "Detect performance anomalies in Bing traffic.",
                            prefer_over: "bing_analytics_compare_periods",
                            next_tool: "bing_analytics_drop_attribution"
                        },
                        {
                            name: "bing_analytics_drop_attribution",
                            purpose: "Identify the likely cause of a Bing traffic drop.",
                            prefer_over: "bing_analytics_detect_anomalies",
                            next_tool: "bing_analytics_compare_periods"
                        }
                    ] : [])
                ]
            },
            {
                name: "Find Quick Wins",
                tools: [
                    ...(isGoogleEnabled ? [
                        {
                            name: "seo_striking_distance",
                            purpose: "Find keywords ranking in positions 8-15 (high potential).",
                            prefer_over: "seo_low_hanging_fruit (specifically targets Page 1/2 boundary)",
                            next_tool: "inspection_inspect"
                        },
                        {
                            name: "seo_low_hanging_fruit",
                            purpose: "Find keywords with high impressions but low rankings (positions 5-20).",
                            prefer_over: "seo_striking_distance (broader range)",
                            next_tool: "inspection_inspect"
                        },
                        {
                            name: "seo_quick_wins",
                            purpose: "Find pages with queries ranking on page 2 that could be pushed to page 1.",
                            prefer_over: "seo_striking_distance (focuses on pages, not just keywords)",
                            next_tool: "pagespeed_analyze"
                        }
                    ] : []),
                    ...(isBingEnabled ? [
                        {
                            name: "bing_opportunity_finder",
                            purpose: "Find high-potential 'low-hanging fruit' keywords in Bing.",
                            prefer_over: "bing_striking_distance",
                            next_tool: "bing_url_info"
                        },
                        {
                            name: "bing_striking_distance",
                            purpose: "Find keywords ranking positions 8-15 on Bing.",
                            prefer_over: "bing_opportunity_finder",
                            next_tool: "bing_url_info"
                        }
                    ] : [])
                ]
            },
            {
                name: "Understand a Specific Page",
                tools: [
                    ...(isGoogleEnabled ? [
                        {
                            name: "inspection_inspect",
                            purpose: "Check index status, crawl info, and mobile usability.",
                            prefer_over: "pagespeed_analyze (for indexing issues)",
                            next_tool: "pagespeed_analyze"
                        },
                        {
                            name: "pagespeed_analyze",
                            purpose: "Run PageSpeed Insights (Lighthouse) analysis.",
                            prefer_over: "inspection_inspect (for performance issues)",
                            next_tool: "schema_validate"
                        },
                        {
                            name: "schema_validate",
                            purpose: "Validate Schema.org structured data.",
                            prefer_over: "inspection_inspect (specifically for rich results)",
                            next_tool: null
                        }
                    ] : []),
                    ...(isBingEnabled ? [
                        {
                            name: "bing_url_info",
                            purpose: "Get detailed indexing and crawl information for a URL in Bing.",
                            prefer_over: "bing_analytics_page_query",
                            next_tool: null
                        }
                    ] : []),
                    ...(isGA4Enabled ? [
                        {
                            name: "analytics_page_performance",
                            purpose: "Get detailed GA4 metrics (sessions, engagement) for a specific path.",
                            prefer_over: "analytics_query",
                            next_tool: "analytics_pagespeed_correlation"
                        },
                        {
                            name: "analytics_pagespeed_correlation",
                            purpose: "Correlate GA4 engagement with PageSpeed scores.",
                            prefer_over: null,
                            next_tool: null
                        }
                    ] : [])
                ]
            },
            {
                name: "Fix Technical Issues",
                tools: [
                    ...(isGoogleEnabled ? [
                        {
                            name: "seo_cannibalization",
                            purpose: "Detect multiple pages competing for the same query.",
                            prefer_over: "analytics_query",
                            next_tool: "inspection_inspect"
                        },
                        {
                            name: "seo_lost_queries",
                            purpose: "Identify queries that lost all traffic compared to previous period.",
                            prefer_over: "analytics_compare_periods",
                            next_tool: "inspection_inspect"
                        },
                        {
                            name: "sitemaps_list",
                            purpose: "List sitemaps and their status.",
                            prefer_over: "inspection_inspect (for site-wide issues)",
                            next_tool: "sitemaps_submit"
                        }
                    ] : []),
                    ...(isBingEnabled ? [
                        {
                            name: "bing_crawl_issues",
                            purpose: "Get crawl issues detected by Bing.",
                            prefer_over: "bing_url_info (for site-wide issues)",
                            next_tool: "bing_url_submit"
                        }
                    ] : [])
                ]
            },
            {
                name: "Compare Platforms",
                tools: [
                    ...(isGoogleEnabled && isBingEnabled ? [
                        {
                            name: "compare_engines",
                            purpose: "Compare performance data between Google and Bing for a dimension.",
                            prefer_over: "analytics_compare_periods",
                            next_tool: "analytics_top_queries"
                        }
                    ] : []),
                    ...(isGoogleEnabled && isGA4Enabled ? [
                        {
                            name: "page_analysis",
                            purpose: "Compare GSC search data with GA4 on-site behavior data.",
                            prefer_over: null,
                            next_tool: "opportunity_matrix"
                        },
                        {
                            name: "traffic_health_check",
                            purpose: "Diagnose tracking issues by comparing GSC clicks vs GA4 organic sessions.",
                            prefer_over: null,
                            next_tool: null
                        }
                    ] : []),
                    ...(isGoogleEnabled && isBingEnabled && isGA4Enabled ? [
                        {
                            name: "opportunity_matrix",
                            purpose: "Prioritize SEO tasks by combining signals from GSC, GA4, and Bing.",
                            prefer_over: null,
                            next_tool: null
                        },
                        {
                            name: "brand_analysis",
                            purpose: "Analyze Brand vs Non-Brand performance across all 3 platforms.",
                            prefer_over: null,
                            next_tool: null
                        }
                    ] : [])
                ]
            },
            {
                name: "Raw Data Access",
                tools: [
                    ...(isGoogleEnabled ? [
                        {
                            name: "analytics_query",
                            purpose: "Query raw Google Search Console data with full control.",
                            prefer_over: "analytics_performance_summary",
                            next_tool: null
                        },
                        {
                            name: "analytics_time_series",
                            purpose: "Get advanced time series data including rolling averages and forecasting.",
                            prefer_over: "analytics_query (for trend analysis)",
                            next_tool: null
                        }
                    ] : []),
                    ...(isBingEnabled ? [
                        {
                            name: "bing_analytics_query",
                            purpose: "Get query performance stats from Bing.",
                            prefer_over: "bing_analytics_page",
                            next_tool: null
                        },
                        {
                            name: "bing_analytics_time_series",
                            purpose: "Advanced time series analysis for Bing performance data.",
                            prefer_over: "bing_analytics_query",
                            next_tool: null
                        }
                    ] : []),
                    ...(isGA4Enabled ? [
                        {
                            name: "analytics_realtime",
                            purpose: "Get realtime active users from GA4.",
                            prefer_over: null,
                            next_tool: null
                        },
                        {
                            name: "analytics_user_behavior",
                            purpose: "Get breakdown by device, country, and engagement from GA4.",
                            prefer_over: null,
                            next_tool: null
                        }
                    ] : [])
                ]
            },
            {
                name: "Account Management",
                tools: [
                    {
                        name: "sites_list",
                        purpose: "List all verified sites across all authorized accounts.",
                        prefer_over: null,
                        next_tool: "sites_health_check"
                    },
                    ...(isGoogleEnabled || isBingEnabled ? [
                        {
                            name: "accounts_list",
                            purpose: "List all authorized Google and Bing accounts.",
                            prefer_over: null,
                            next_tool: null
                        }
                    ] : [])
                ]
            }
        ].filter(group => group.tools.length > 0);

        const recommendedStartingPoints = {
            "traffic_drop_investigation": "investigate_traffic_drop prompt or analytics_anomalies tool",
            "finding_content_opportunities": "find_quick_wins prompt or seo_low_hanging_fruit tool",
            "full_site_audit": "full_site_audit prompt or sites_health_check tool",
            "ga4_performance_audit": "ga4_traffic_audit prompt",
            "executive_summary": "executive_summary prompt"
        };

        const workflowChains = [
            {
                name: "Diagnose Traffic Drop",
                trigger: "User asks why traffic dropped",
                steps: [
                    "investigate_traffic_drop (Prompt) - Orchestrates anomaly detection and drop attribution",
                    "traffic_health_check - (GA4+GSC) Cross-check GSC clicks vs GA4 sessions",
                    "analytics_compare_periods - Validates the drop with period-over-period data",
                    "inspection_inspect - Checks if affected pages are indexed correctly"
                ]
            },
            {
                name: "Find Quick Wins",
                trigger: "User asks for easy growth opportunities",
                steps: [
                    "find_quick_wins (Prompt) - Finds striking distance keywords",
                    "page_analysis - (GA4+GSC) Find pages with high GSC impressions but low engagement",
                    "pagespeed_analyze - Checks if speed is holding these pages back",
                    "inspection_inspect - Verifies technical health"
                ]
            },
            {
                name: "Content Optimization",
                trigger: "User wants to improve content performance",
                steps: [
                    "content_opportunity_report (Prompt) - Identifies low CTR and cannibalization issues",
                    "analytics_content_performance - Check which content groups are most engaging",
                    "seo_cannibalization - Deep dive into competing pages",
                    "seo_low_ctr_opportunities - Finds title/meta optimization targets"
                ]
            },
            {
                name: "GA4 Traffic Deep Dive",
                trigger: "User wants to understand GA4 metrics",
                steps: [
                    "ga4_traffic_audit (Prompt) - Full acquisition and conversion audit",
                    "analytics_realtime - Check currently active users",
                    "analytics_user_behavior - Break down users by device and country"
                ]
            }
        ];

        return {
            content: [{
                type: "text" as const,
                text: JSON.stringify({
                    server_summary: "This server provides comprehensive access to Google Search Console and Bing Webmaster Tools data, offering capabilities for analytics, URL inspection, sitemap management, and advanced SEO insights.",
                    active_platforms: activePlatforms,
                    intent_groups: intentGroups,
                    recommended_starting_points: recommendedStartingPoints,
                    workflow_chains: workflowChains,
                    primitive_tools_note: "Tools starting with 'seo_primitive_' are low-level building blocks (atoms) used by opinionated tools. Use them only when you need to construct custom logic not covered by the main tools. For example, 'seo_primitive_ranking_bucket' is used by 'seo_striking_distance'."
                }, null, 2)
            }]
        };
    } catch (error) {
        return formatError(error);
    }
}
