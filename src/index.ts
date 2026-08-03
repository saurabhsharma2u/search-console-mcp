#!/usr/bin/env node
import 'dotenv/config';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as sites from "./google/tools/sites.js";
import * as sitemaps from "./google/tools/sitemaps.js";
import * as analytics from "./google/tools/analytics.js";
import * as inspection from "./google/tools/inspection.js";
import * as googleIndexing from "./google/tools/indexing.js";
import * as pagespeed from "./google/tools/pagespeed.js";
import * as seoInsights from "./google/tools/seo-insights.js";
import * as seoPrimitives from "./common/tools/seo-primitives.js";
import * as schemaValidator from "./common/tools/schema-validator.js";
import * as advancedAnalytics from "./google/tools/advanced-analytics.js";
import * as sitesHealth from "./google/tools/sites-health.js";
import * as bingSites from "./bing/tools/sites.js";
import * as bingSitemaps from "./bing/tools/sitemaps.js";
import * as bingAnalytics from "./bing/tools/analytics.js";
import * as bingKeywords from "./bing/tools/keywords.js";
import * as bingCrawl from "./bing/tools/crawl.js";
import * as bingUrlSubmission from "./bing/tools/url-submission.js";
import * as bingInspection from "./bing/tools/inspection.js";
import * as bingLinks from "./bing/tools/links.js";
import * as bingHealth from "./bing/tools/sites-health.js";
import * as bingSeoInsights from "./bing/tools/seo-insights.js";
import * as indexNow from "./bing/tools/index-now.js";
import * as bingAdvancedAnalytics from "./bing/tools/advanced-analytics.js";
import * as compareEnginesTool from "./common/tools/compare-engines/index.js";
import * as ga4Analytics from "./ga4/tools/analytics.js";
import * as ga4Realtime from "./ga4/tools/realtime.js";
import * as ga4Behavior from "./ga4/tools/behavior.js";
import * as ga4PageSpeed from "./ga4/tools/pagespeed.js";
import * as ga4GscComparator from "./common/tools/compare-engines/ga4-gsc-comparator.js";
import * as ga4GscBingComparator from "./common/tools/compare-engines/ga4-gsc-bing-comparator.js";
import * as ga4Properties from "./ga4/tools/properties.js";
import { loadConfig, removeAccount, updateAccount, AccountConfig } from './common/auth/config.js';
import { resolveAccount, normalizeWebsite } from './common/auth/resolver.js';
import { getSearchConsoleClient } from './google/client.js';
import { startSseServer } from "./transport/http.js";
import { registerMcpResources } from "./resources/index.js";
import { getBingClient } from './bing/client.js';
import { limitConcurrency } from './common/concurrency.js';
import {
  bingApiDocs,
  indexNowDocs,
  dimensionsDocs as bingDimensionsDocs,
  filtersDocs as bingFiltersDocs,
  searchTypesDocs as bingSearchTypesDocs,
  patternsDocs as bingPatternsDocs,
  algorithmUpdatesDocs as bingAlgorithmUpdatesDocs
} from "./bing/docs/index.js";
import { formatError } from "./common/errors.js";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { colors, printBoxHeader, printStatusLine } from './utils/ui.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { getStartedHandler, getStartedToolName, getStartedToolDescription, getStartedToolSchema } from "./common/tools/get-started.js";
import { registerPrompts } from "./prompts/index.js";
import { jsonToCsv } from "./common/utils/csv.js";
import { runDiagnostics } from "./common/diagnostics.js";
import { logger } from "./utils/logger.js";
import { createToolRegistrar, isCliRun, runCli } from "./utils/cli.js";
import * as sitesFluent from "./tools/fluent/sites.js";
import * as sitemapsFluent from "./tools/fluent/sitemaps.js";
import * as analyticsFluent from "./tools/fluent/analytics.js";
import * as inspectionFluent from "./tools/fluent/inspection.js";
import * as indexingFluent from "./tools/fluent/indexing.js";
import * as seoFluent from "./tools/fluent/seo.js";
import * as healthFluent from "./tools/fluent/health.js";
import { executeLegacyFallback, legacyFallbackMap } from "./legacy/fallback-router.js";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load version from package.json
let version = "1.0.0";
try {
  const pkgPath = join(__dirname, '../package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  version = pkg.version;
} catch (e) {
  // Fallback for cases where package.json might not be accessible
}


const server = new McpServer({
  name: "search-console-mcp",
  version: version,
});

registerPrompts(server);
registerMcpResources(server);

const registerTool = createToolRegistrar(server, version);

// Get Started Tool
registerTool(
  getStartedToolName,
  getStartedToolDescription,
  getStartedToolSchema,
  getStartedHandler
);

// --- Fluent Domain Tools (~22 Core Tools) ---

// 1. Sites & Accounts Management
registerTool(
  "sites_list",
  "List verified web properties across Google Search Console, Bing Webmaster Tools, or GA4.",
  { engine: z.enum(["google", "bing", "all"]).optional().describe("Target search engine (default: all)") },
  sitesFluent.sitesListHandler
);

registerTool(
  "sites_manage",
  "Add or delete a web property from Google Search Console or Bing Webmaster Tools.",
  {
    action: z.enum(["add", "delete"]).describe("Action to perform"),
    siteUrl: z.string().describe("The site property URL"),
    engine: z.enum(["google", "bing", "all"]).optional().describe("Target search engine (default: all)")
  },
  sitesFluent.sitesManageHandler
);

registerTool(
  "accounts_manage",
  "Manage Google Search Console service accounts and site permissions.",
  {
    action: z.enum(["list", "add_site", "remove"]).describe("Account action"),
    accountId: z.string().optional().describe("Account ID for add_site or remove"),
    siteUrl: z.string().optional().describe("Site URL to add to account"),
    email: z.string().optional().describe("Optional email filter")
  },
  sitesFluent.accountsManageHandler
);

// 2. Sitemaps Management
registerTool(
  "sitemaps_list",
  "List submitted XML sitemaps and status for a site.",
  {
    siteUrl: z.string().describe("The site property URL"),
    feedUrl: z.string().optional().describe("Optional specific sitemap feed URL"),
    engine: z.enum(["google", "bing", "all"]).optional().describe("Target search engine (default: all)")
  },
  sitemapsFluent.sitemapsListHandler
);

registerTool(
  "sitemaps_submit",
  "Submit a new XML sitemap to Google Search Console and/or Bing Webmaster Tools.",
  {
    siteUrl: z.string().describe("The site property URL"),
    feedUrl: z.string().describe("The XML sitemap feed URL to submit"),
    engine: z.enum(["google", "bing", "all"]).optional().describe("Target search engine (default: all)")
  },
  sitemapsFluent.sitemapsSubmitHandler
);

registerTool(
  "sitemaps_delete",
  "Delete a sitemap from Google Search Console or Bing Webmaster Tools.",
  {
    siteUrl: z.string().describe("The site property URL"),
    feedUrl: z.string().describe("The sitemap feed URL to delete"),
    engine: z.enum(["google", "bing", "all"]).optional().describe("Target search engine (default: all)")
  },
  sitemapsFluent.sitemapsDeleteHandler
);

// 3. Unified Search Analytics
registerTool(
  "analytics_query",
  "Unified search performance query replacing single-dimension tools. Supports queries, pages, countries, devices, and search appearances.",
  {
    siteUrl: z.string().describe("The site property URL"),
    startDate: z.string().optional().describe("Start date YYYY-MM-DD"),
    endDate: z.string().optional().describe("End date YYYY-MM-DD"),
    dimensions: z.array(z.string()).optional().describe("Dimensions: query, page, country, device, searchAppearance, date"),
    filters: z.array(z.any()).optional().describe("Filter objects"),
    rowLimit: z.number().optional().describe("Row limit"),
    engine: z.enum(["google", "bing", "all"]).optional().describe("Target search engine (default: all)")
  },
  analyticsFluent.analyticsQueryHandler
);

registerTool(
  "analytics_compare",
  "Period-over-period search performance comparisons, trends, and traffic drop attributions.",
  {
    siteUrl: z.string().describe("The site property URL"),
    mode: z.enum(["period_over_period", "trends", "drop_attribution"]).optional().describe("Comparison mode"),
    startDate: z.string().optional().describe("Start date YYYY-MM-DD"),
    endDate: z.string().optional().describe("End date YYYY-MM-DD"),
    compareStartDate: z.string().optional().describe("Comparison start date"),
    compareEndDate: z.string().optional().describe("Comparison end date"),
    engine: z.enum(["google", "bing", "all"]).optional().describe("Target search engine (default: all)")
  },
  analyticsFluent.analyticsCompareHandler
);

registerTool(
  "analytics_anomalies",
  "Detect search traffic anomalies across Google and Bing.",
  {
    siteUrl: z.string().describe("The site property URL"),
    startDate: z.string().optional().describe("Start date YYYY-MM-DD"),
    endDate: z.string().optional().describe("End date YYYY-MM-DD"),
    threshold: z.number().optional().describe("Sensitivity threshold"),
    engine: z.enum(["google", "bing", "all"]).optional().describe("Target search engine (default: all)")
  },
  analyticsFluent.analyticsAnomaliesHandler
);

registerTool(
  "analytics_advanced",
  "Google Analytics 4 (GA4) e-commerce, realtime metrics, user behavior, and conversion funnels.",
  {
    propertyId: z.string().describe("GA4 Property ID"),
    metricType: z.enum(["ecommerce", "realtime", "user_behavior", "audience_segments", "conversion_funnel"]).describe("Metric type"),
    startDate: z.string().optional().describe("Start date YYYY-MM-DD"),
    endDate: z.string().optional().describe("End date YYYY-MM-DD")
  },
  analyticsFluent.analyticsAdvancedHandler
);

// 4. URL Inspection & PageSpeed
registerTool(
  "inspection_inspect",
  "Inspect indexing, canonical, and crawl status for single or batch URLs on Google or Bing.",
  {
    siteUrl: z.string().describe("The site property URL"),
    urls: z.array(z.string()).describe("List of URLs to inspect"),
    engine: z.enum(["google", "bing", "all"]).optional().describe("Target search engine (default: all)")
  },
  inspectionFluent.inspectionInspectHandler
);

registerTool(
  "pagespeed_analyze",
  "Run PageSpeed Insights & Core Web Vitals performance analysis for a page.",
  {
    url: z.string().describe("The URL to analyze"),
    strategy: z.enum(["mobile", "desktop"]).optional().describe("Device strategy"),
    category: z.array(z.string()).optional().describe("Lighthouse categories"),
    cwvOnly: z.boolean().optional().describe("Return Core Web Vitals metrics only")
  },
  inspectionFluent.pagespeedAnalyzeHandler
);

// 5. Indexing & URL Submission
registerTool(
  "indexing_submit",
  "Submit URL(s) for indexing via Google Indexing API, Bing URL submission, or IndexNow protocol.",
  {
    siteUrl: z.string().optional().describe("The site property URL"),
    urls: z.array(z.string()).describe("List of URLs to submit"),
    method: z.enum(["standard", "index_now", "remove"]).optional().describe("Submission method (default: standard)"),
    engine: z.enum(["google", "bing", "all"]).optional().describe("Target search engine (default: google)"),
    host: z.string().optional().describe("Host for IndexNow submission"),
    key: z.string().optional().describe("Key for IndexNow submission"),
    keyLocation: z.string().optional().describe("Key location URL for IndexNow")
  },
  indexingFluent.indexingSubmitHandler
);

registerTool(
  "indexing_status",
  "Check notification status for Google Indexing API or remaining daily Bing submission quota.",
  {
    siteUrl: z.string().describe("The site property URL"),
    url: z.string().optional().describe("URL to check status for"),
    type: z.enum(["status", "quota"]).optional().describe("Check type (default: status)"),
    engine: z.enum(["google", "bing", "all"]).optional().describe("Target search engine")
  },
  indexingFluent.indexingStatusHandler
);

// 6. SEO Intelligence & Audit
registerTool(
  "seo_audit",
  "Specialized SEO intelligence analysis (recommendations, quick wins, cannibalization, striking distance, lost queries, low CTR, brand vs nonbrand).",
  {
    siteUrl: z.string().describe("The site property URL"),
    type: z.enum(["recommendations", "quick_wins", "low_hanging_fruit", "cannibalization", "striking_distance", "lost_queries", "low_ctr", "brand_vs_nonbrand"]).describe("Audit analysis type"),
    brandKeywords: z.array(z.string()).optional().describe("Brand keywords for brand_vs_nonbrand analysis"),
    minImpressions: z.number().optional().describe("Minimum impressions threshold"),
    engine: z.enum(["google", "bing", "all"]).optional().describe("Target search engine (default: all)")
  },
  seoFluent.seoAuditHandler
);

registerTool(
  "seo_keywords_research",
  "Keyword performance stats, related query expansion, and search volume estimates.",
  {
    siteUrl: z.string().optional().describe("The site property URL"),
    keywords: z.array(z.string()).describe("Keywords to analyze"),
    country: z.string().optional().describe("Country code"),
    language: z.string().optional().describe("Language code"),
    type: z.enum(["stats", "related", "traffic"]).optional().describe("Analysis type")
  },
  seoFluent.seoKeywordsResearchHandler
);

registerTool(
  "schema_validate",
  "Validate structured data (JSON-LD, Microdata, RDFa) for a given webpage URL.",
  { url: z.string().describe("The webpage URL to validate structured markup for") },
  seoFluent.schemaValidateHandler
);

// 7. Diagnostics & Cross-Engine Workflows
registerTool(
  "site_health_check",
  "Comprehensive health audit across Google Search Console and Bing Webmaster Tools.",
  {
    siteUrl: z.string().optional().describe("Optional specific site URL"),
    level: z.enum(["summary", "full", "crawl_issues"]).optional().describe("Health check depth"),
    engine: z.enum(["google", "bing", "all"]).optional().describe("Target search engine (default: all)")
  },
  healthFluent.siteHealthCheckHandler
);

registerTool(
  "compare_engines",
  "Cross-engine performance matrix comparing Google Search Console vs Bing Webmaster Tools.",
  {
    siteUrl: z.string().describe("The site property URL"),
    startDate: z.string().optional().describe("Start date YYYY-MM-DD"),
    endDate: z.string().optional().describe("End date YYYY-MM-DD"),
    dimension: z.enum(["query", "page"]).optional().describe("Comparison dimension"),
    limit: z.number().optional().describe("Result row limit")
  },
  healthFluent.compareEnginesHandler
);

registerTool(
  "diagnostics",
  "Run connectivity diagnostics for all connected accounts. Use this to troubleshoot '0 results' or authentication issues.",
  {},
  async () => {
    try {
      const results = await runDiagnostics();
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    } catch (error) {
      return formatError(error);
    }
  }
);

// Internal silent fallback router interceptor for CallTool requests
(server.server as any).setRequestHandler(CallToolRequestSchema, async (request: any, extra: any) => {
  const toolName = request.params.name;
  if (legacyFallbackMap[toolName]) {
    const legacyResult = await executeLegacyFallback(toolName, request.params.arguments);
    if (legacyResult) return legacyResult;
  }
  const registeredTool = (server as any)._registeredTools[toolName];
  if (!registeredTool) {
    throw new Error(`Tool ${toolName} not found`);
  }
  return await registeredTool.handler(request.params.arguments);
});

registerTool(
  "analytics_drop_attribution",
  "Analyze a significant traffic drop to identify if it was caused by specific devices (mobile/desktop) or coincides with known Google algorithm updates.",
  {
    siteUrl: z.string().describe("The URL of the site"),
    days: z.number().optional().describe("Number of days to look back (default: 30)"),
    threshold: z.number().optional().describe("Sensitivity threshold for drop detection (Standard Deviations, default: 2.0)")
  },
  async ({ siteUrl, days, threshold }) => {
    try {
      const result = await advancedAnalytics.analyzeDropAttribution(siteUrl, { days, threshold });
      return {
        content: [{ type: "text", text: result ? JSON.stringify(result, null, 2) : "No significant traffic drop detected in the specified period." }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "analytics_time_series",
  "Get advanced time series data including rolling averages, seasonality strength, and trend forecasting. Supports multi-dimensional analysis, metrics selection, and custom granularities.",
  {
    siteUrl: z.string().describe("The URL of the site"),
    days: z.number().optional().describe("Number of days of history to analyze (default: 60)"),
    startDate: z.string().optional().describe("Start date (YYYY-MM-DD)"),
    endDate: z.string().optional().describe("End date (YYYY-MM-DD)"),
    dimensions: z.array(z.string()).optional().describe("Dimensions to group by (default: ['date'])"),
    metrics: z.array(z.enum(["clicks", "impressions", "ctr", "position"])).optional().describe("Metrics to analyze (default: ['clicks'])"),
    granularity: z.enum(["daily", "weekly"]).optional().describe("Granularity of the data (default: daily)"),
    filters: z.array(z.object({
      dimension: z.string(),
      operator: z.string(),
      expression: z.string()
    })).optional().describe("Filter groups to apply"),
    window: z.number().optional().describe("Window size for rolling average in days/weeks (default: 7)"),
    forecastDays: z.number().optional().describe("Number of units (days/weeks) to forecast into the future (default: 7)")
  },
  async ({ siteUrl, days, startDate, endDate, dimensions, metrics, granularity, filters, window, forecastDays }) => {
    try {
      const result = await advancedAnalytics.getTimeSeriesInsights(siteUrl, {
        days,
        startDate,
        endDate,
        dimensions,
        metrics,
        granularity,
        filters,
        window,
        forecastDays
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

// Inspection Tools
registerTool(
  "inspection_batch",
  "Inspect multiple URLs for a site in batch",
  {
    siteUrl: z.string().describe("The URL of the property"),
    inspectionUrls: z.array(z.string()).describe("List of URLs to inspect (max 5)"),
    languageCode: z.string().optional().describe("Language code for localized results (Google only)"),
    engine: z.enum(["google", "bing"]).optional().describe("The search engine (default: google)")
  },
  async ({ siteUrl, inspectionUrls, languageCode, engine = "google" }) => {
    try {
      if (inspectionUrls.length > 5) {
        throw new Error("Batch inspection is limited to 5 URLs at a time to prevent rate limiting.");
      }

      const results = engine === "google"
        ? await inspection.inspectBatch(siteUrl, inspectionUrls, languageCode)
        : await bingInspection.inspectBatch(siteUrl, inspectionUrls);

      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

// PageSpeed Insights Tools
registerTool(
  "pagespeed_core_web_vitals",
  "Get Core Web Vitals for both mobile and desktop including LCP, FID, CLS, FCP, TTI, and TBT",
  {
    url: z.string().describe("The URL to analyze")
  },
  async ({ url }) => {
    try {
      const result = await pagespeed.getCoreWebVitals(url);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

// SEO Insights Tools
registerTool(
  "seo_recommendations",
  "Generate SEO recommendations based on site performance data",
  {
    siteUrl: z.string().describe("The site URL (e.g., https://example.com)"),
    days: z.number().optional().describe("Number of days to analyze (default: 28)"),
    engine: z.enum(["google", "bing"]).optional().describe("The search engine (default: google)")
  },
  async ({ siteUrl, days, engine = "google" }) => {
    try {
      const result = engine === "google"
        ? await seoInsights.generateRecommendations(siteUrl, { days })
        : await bingSeoInsights.generateRecommendations(siteUrl, { days });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "seo_low_hanging_fruit",
  "Find keywords with high impressions but low rankings that have potential for growth",
  {
    siteUrl: z.string().describe("The site URL"),
    days: z.number().optional().describe("Number of days (Google only, default: 28)"),
    minImpressions: z.number().optional().describe("Minimum impressions threshold (default: 100)"),
    limit: z.number().optional().describe("Max results to return (default: 50)"),
    engine: z.enum(["google", "bing"]).optional().describe("The search engine (default: google)")
  },
  async ({ siteUrl, days, minImpressions, limit, engine = "google" }) => {
    try {
      const result = engine === "google"
        ? await seoInsights.findLowHangingFruit(siteUrl, { days, minImpressions, limit })
        : await bingSeoInsights.findLowHangingFruit(siteUrl, { minImpressions, limit });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "seo_cannibalization",
  "Detect keyword cannibalization - multiple pages competing for the same query",
  {
    siteUrl: z.string().describe("The site URL"),
    days: z.number().optional().describe("Number of days (Google only, default: 28)"),
    minImpressions: z.number().optional().describe("Minimum impressions threshold (default: 50)"),
    limit: z.number().optional().describe("Max issues to return (default: 30)"),
    engine: z.enum(["google", "bing"]).optional().describe("The search engine (default: google)")
  },
  async ({ siteUrl, days, minImpressions, limit, engine = "google" }) => {
    try {
      const result = engine === "google"
        ? await seoInsights.detectCannibalization(siteUrl, { days, minImpressions, limit })
        : await bingSeoInsights.detectCannibalization(siteUrl, { minImpressions, limit });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "seo_low_ctr_opportunities",
  "Find queries with low CTR relative to their ranking position. Great for title tag optimization.",
  {
    siteUrl: z.string().describe("The site URL"),
    days: z.number().optional().describe("Number of days (Google only, default: 28)"),
    minImpressions: z.number().optional().describe("Minimum impressions threshold (default: 500)"),
    limit: z.number().optional().describe("Max issues to return (default: 50)"),
    engine: z.enum(["google", "bing"]).optional().describe("The search engine (default: google)")
  },
  async ({ siteUrl, days, minImpressions, limit, engine = "google" }) => {
    try {
      const result = engine === "google"
        ? await seoInsights.findLowCTROpportunities(siteUrl, { days, minImpressions, limit })
        : await bingSeoInsights.findLowCTROpportunities(siteUrl, { minImpressions, limit });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "seo_striking_distance",
  "Find keywords ranking in positions 8-15. These are high-priority targets to push to Page 1.",
  {
    siteUrl: z.string().describe("The site URL"),
    days: z.number().optional().describe("Number of days (Google only, default: 28)"),
    limit: z.number().optional().describe("Max results to return (default: 50)"),
    engine: z.enum(["google", "bing"]).optional().describe("The search engine (default: google)")
  },
  async ({ siteUrl, days, limit, engine = "google" }) => {
    try {
      const result = engine === "google"
        ? await seoInsights.findStrikingDistance(siteUrl, { days, limit })
        : await bingSeoInsights.findStrikingDistance(siteUrl, { limit });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "seo_lost_queries",
  "Identify queries that lost all traffic (or dropped >80%) compared to the previous period.",
  {
    siteUrl: z.string().describe("The site URL"),
    days: z.number().optional().describe("Number of days to compare (default: 28)"),
    limit: z.number().optional().describe("Max results to return (default: 50)"),
    engine: z.enum(["google", "bing"]).optional().describe("The search engine (default: google)")
  },
  async ({ siteUrl, days, limit, engine = "google" }) => {
    try {
      const result = engine === "google"
        ? await seoInsights.findLostQueries(siteUrl, { days, limit })
        : await bingSeoInsights.findLostQueries(siteUrl, { days, limit });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "seo_brand_vs_nonbrand",
  "Analyze performance split between Brand and Non-Brand queries using a regex.",
  {
    siteUrl: z.string().describe("The site URL"),
    brandRegex: z.string().describe("Regex to match brand keywords (e.g. 'acme|acme corp')"),
    days: z.number().optional().describe("Number of days to analyze (default: 28)"),
    engine: z.enum(["google", "bing"]).optional().describe("The search engine (default: google)")
  },
  async ({ siteUrl, brandRegex, days, engine = "google" }) => {
    try {
      const result = engine === "google"
        ? await seoInsights.analyzeBrandVsNonBrand(siteUrl, brandRegex, { days })
        : await bingSeoInsights.analyzeBrandVsNonBrand(siteUrl, brandRegex, { days });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "seo_quick_wins",
  "Find pages with queries ranking on page 2 (positions 11-20) that could be pushed to page 1",
  {
    siteUrl: z.string().describe("The site URL"),
    days: z.number().optional().describe("Number of days (Google only, default: 28)"),
    minImpressions: z.number().optional().describe("Minimum impressions threshold (default: 100)"),
    limit: z.number().optional().describe("Max results to return (default: 20)"),
    engine: z.enum(["google", "bing"]).optional().describe("The search engine (default: google)")
  },
  async ({ siteUrl, days, minImpressions, limit, engine = "google" }) => {
    try {
      const result = engine === "google"
        ? await seoInsights.findQuickWins(siteUrl, { days, minImpressions, limit })
        : await bingSeoInsights.findLowHangingFruit(siteUrl, { minImpressions, limit });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);


// Account Management Tools
registerTool(
  "accounts_list",
  "List all authorized Google and Bing accounts",
  {},
  async () => {
    try {
      const config = await loadConfig();
      const accounts = Object.values(config.accounts).map(a => ({
        id: a.id,
        engine: a.engine,
        alias: a.alias,
        websites: a.websites || [],
        isLegacy: a.isLegacy || false
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(accounts, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "accounts_add_site",
  "Authorize a specific site or domain for an account (Account Boundary)",
  {
    accountId: z.string().describe("The ID of the account"),
    site: z.string().describe("The site URL or domain (e.g., example.com)")
  },
  async ({ accountId, site }) => {
    try {
      const config = await loadConfig();
      const account = config.accounts[accountId];
      if (!account) throw new Error(`Account ${accountId} not found.`);

      if (!account.websites) account.websites = [];
      if (!account.websites.includes(site)) {
        account.websites.push(site);
        await updateAccount(account);
      }

      return {
        content: [{ type: "text", text: `Successfully authorized ${site} for account ${account.alias}.` }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "accounts_remove",
  "Remove an authorized account",
  { accountId: z.string().describe("The ID of the account to remove") },
  async ({ accountId }) => {
    try {
      await removeAccount(accountId);
      return {
        content: [{ type: "text", text: `Account ${accountId} removed successfully.` }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

// SEO Primitives (Atoms)
registerTool(
  "seo_primitive_ranking_bucket",
  "primitive: Get the ranking bucket for a specific position (e.g. Top 3, Page 1).",
  {
    position: z.number().describe("The ranking position"),
    engine: z.enum(["google", "bing"]).optional().describe("The search engine (optional)")
  },
  async ({ position, engine }) => {
    return {
      content: [{ type: "text", text: JSON.stringify(seoPrimitives.getRankingBucket(position, engine), null, 2) }]
    };
  }
);

registerTool(
  "seo_primitive_traffic_delta",
  "primitive: Calculate the delta between two traffic metrics (absolute and percentage).",
  {
    current: z.number().describe("Current value"),
    previous: z.number().describe("Previous value"),
    engine: z.enum(["google", "bing"]).optional().describe("The search engine (optional)")
  },
  async ({ current, previous, engine }) => {
    return {
      content: [{ type: "text", text: JSON.stringify(seoPrimitives.calculateTrafficDelta(current, previous, engine), null, 2) }]
    };
  }
);

registerTool(
  "seo_primitive_is_brand",
  "primitive: Check if a query is a brand query based on a regex pattern.",
  {
    query: z.string().describe("The search query"),
    brandRegex: z.string().describe("Regex pattern to identify brand terms"),
    engine: z.enum(["google", "bing"]).optional().describe("The search engine (optional)")
  },
  async ({ query, brandRegex, engine }) => {
    return {
      content: [{ type: "text", text: JSON.stringify(seoPrimitives.isBrandQuery(query, brandRegex, engine), null, 2) }]
    };
  }
);

registerTool(
  "seo_primitive_is_cannibalized",
  "primitive: Check if two pages are competing for the same query based on their metrics.",
  {
    query: z.string().describe("The search query"),
    pageA_position: z.number(),
    pageA_impressions: z.number(),
    pageA_clicks: z.number(),
    pageB_position: z.number(),
    pageB_impressions: z.number(),
    pageB_clicks: z.number(),
    engine: z.enum(["google", "bing"]).optional().describe("The search engine (optional)")
  },
  async ({ query, pageA_position, pageA_impressions, pageA_clicks, pageB_position, pageB_impressions, pageB_clicks, engine }) => {
    const pageA = { position: pageA_position, impressions: pageA_impressions, clicks: pageA_clicks, engine };
    const pageB = { position: pageB_position, impressions: pageB_impressions, clicks: pageB_clicks, engine };
    return {
      content: [{ type: "text", text: JSON.stringify(seoPrimitives.isCannibalized(query, pageA, pageB), null, 2) }]
    };
  }
);

// Support Tools
registerTool(
  "util_star_repo",
  "Star the GitHub repository to support the project. Uses GitHub CLI if available, or opens a browser.",
  {},
  async () => {
    try {
      const { starRepository } = await import("./google/tools/support.js");
      const result = await starRepository();
      return {
        content: [{ type: "text", text: result }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

// --- Bing Tools ---

registerTool(
  "bing_sites_list",
  "List all sites verified in Bing Webmaster Tools",
  {},
  async () => {
    try {
      const results = await bingSites.listSites();
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "bing_sites_add",
  "Add a new site to Bing Webmaster Tools",
  { siteUrl: z.string().describe("The URL of the site to add") },
  async ({ siteUrl }) => {
    try {
      const result = await bingSites.addSite(siteUrl);
      return {
        content: [{ type: "text", text: result }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "bing_sites_delete",
  "Remove a site from Bing Webmaster Tools",
  { siteUrl: z.string().describe("The URL of the site to remove") },
  async ({ siteUrl }) => {
    try {
      const result = await bingSites.removeSite(siteUrl);
      return {
        content: [{ type: "text", text: result }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "bing_sitemaps_list",
  "List sitemaps for a Bing site",
  {
    siteUrl: z.string().describe("The URL of the site")
  },
  async ({ siteUrl }) => {
    try {
      const results = await bingSitemaps.listSitemaps(siteUrl);
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "bing_sitemaps_submit",
  "Submit a sitemap to Bing Webmaster Tools",
  {
    siteUrl: z.string().describe("The URL of the site"),
    sitemapUrl: z.string().describe("The URL of the sitemap file")
  },
  async ({ siteUrl, sitemapUrl }) => {
    try {
      const result = await bingSitemaps.submitSitemap(siteUrl, sitemapUrl);
      return {
        content: [{ type: "text", text: result }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "bing_sitemaps_delete",
  "Remove a sitemap from Bing Webmaster Tools",
  {
    siteUrl: z.string().describe("The URL of the site"),
    sitemapUrl: z.string().describe("The URL of the sitemap to remove")
  },
  async ({ siteUrl, sitemapUrl }) => {
    try {
      const result = await bingSitemaps.deleteSitemap(siteUrl, sitemapUrl);
      return {
        content: [{ type: "text", text: result }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "bing_analytics_query",
  "Get query performance stats from Bing Webmaster Tools (Top Queries)",
  {
    siteUrl: z.string().describe("The URL of the site"),
    startDate: z.string().optional().describe("Start date (YYYY-MM-DD)"),
    endDate: z.string().optional().describe("End date (YYYY-MM-DD)"),
    limit: z.number().optional().describe("Max rows to return (default: 1000)"),
    format: z.enum(["json", "csv"]).optional().describe("Output format (default: json)")
  },
  async ({ siteUrl, startDate, endDate, limit, format }) => {
    try {
      let results = await bingAnalytics.getQueryStats(siteUrl, startDate, endDate);

      if (limit) {
        results = results.slice(0, limit);
      }

      if (format === 'csv') {
        return {
          content: [{ type: "text", text: jsonToCsv(results) }]
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "bing_analytics_page",
  "Get page performance stats from Bing Webmaster Tools (Top Pages)",
  {
    siteUrl: z.string().describe("The URL of the site"),
    startDate: z.string().optional().describe("Start date (YYYY-MM-DD)"),
    endDate: z.string().optional().describe("End date (YYYY-MM-DD)")
  },
  async ({ siteUrl, startDate, endDate }) => {
    try {
      const results = await bingAnalytics.getPageStats(siteUrl, startDate, endDate);
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "bing_analytics_page_query",
  "Get query performance stats for a specific page from Bing Webmaster Tools",
  {
    siteUrl: z.string().describe("The URL of the site"),
    pageUrl: z.string().describe("The URL of the specific page"),
    startDate: z.string().optional().describe("Start date (YYYY-MM-DD)"),
    endDate: z.string().optional().describe("End date (YYYY-MM-DD)")
  },
  async ({ siteUrl, pageUrl, startDate, endDate }) => {
    try {
      const results = await bingAnalytics.getPageQueryStats(siteUrl, pageUrl, startDate, endDate);
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "bing_get_top_queries",
  "Alias for bing_analytics_query. Get top queries for a site.",
  {
    siteUrl: z.string().describe("The URL of the site"),
    startDate: z.string().optional().describe("Start date (YYYY-MM-DD)"),
    endDate: z.string().optional().describe("End date (YYYY-MM-DD)")
  },
  async ({ siteUrl, startDate, endDate }) => {
    try {
      const results = await bingAnalytics.getQueryStats(siteUrl, startDate, endDate);
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "bing_get_top_pages",
  "Alias for bing_analytics_page. Get top pages for a site.",
  {
    siteUrl: z.string().describe("The URL of the site")
  },
  async ({ siteUrl }) => {
    try {
      const results = await bingAnalytics.getPageStats(siteUrl);
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "bing_analytics_query_page",
  "Get combined query and page performance stats for a site",
  {
    siteUrl: z.string().describe("The URL of the site"),
    startDate: z.string().optional().describe("Start date (YYYY-MM-DD)"),
    endDate: z.string().optional().describe("End date (YYYY-MM-DD)")
  },
  async ({ siteUrl, startDate, endDate }) => {
    try {
      const results = await bingAnalytics.getQueryPageStats(siteUrl, startDate, endDate);
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "bing_rank_traffic_stats",
  "Get historical rank and traffic statistics for a site",
  {
    siteUrl: z.string().describe("The URL of the site")
  },
  async ({ siteUrl }) => {
    try {
      const results = await bingAnalytics.getRankAndTrafficStats(siteUrl);
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "bing_keywords_stats",
  "Get historical stats for a keyword in Bing",
  {
    q: z.string().describe("The keyword to research"),
    country: z.string().optional().describe("Optional country code (e.g., US)"),
    language: z.string().optional().describe("Optional language code (e.g., en-US)")
  },
  async ({ q, country, language }) => {
    try {
      const results = await bingKeywords.getKeywordStats(q, country, language);
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "bing_related_keywords",
  "Get related keywords and search volume from Bing",
  {
    q: z.string().describe("The keyword to research"),
    country: z.string().optional().describe("Optional country code (e.g., US)"),
    language: z.string().optional().describe("Optional language code (e.g., en-US)")
  },
  async ({ q, country, language }) => {
    try {
      const results = await bingKeywords.getRelatedKeywords(q, country, language);
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "bing_crawl_issues",
  "Get crawl issues for a site from Bing Webmaster Tools",
  {
    siteUrl: z.string().describe("The URL of the site")
  },
  async ({ siteUrl }) => {
    try {
      const results = await bingCrawl.getCrawlIssues(siteUrl);
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "bing_crawl_stats",
  "Get crawl statistics (indexed, crawled, errors) for a site",
  {
    siteUrl: z.string().describe("The URL of the site")
  },
  async ({ siteUrl }) => {
    try {
      const results = await bingCrawl.getCrawlStats(siteUrl);
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "bing_url_submission_quota",
  "Get remaining URL submission quota for Bing",
  {
    siteUrl: z.string().describe("The URL of the site")
  },
  async ({ siteUrl }) => {
    try {
      const result = await bingUrlSubmission.getUrlSubmissionQuota(siteUrl);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "bing_url_submit",
  "Submit a single URL to Bing for indexing",
  {
    siteUrl: z.string().describe("The URL of the site"),
    url: z.string().describe("The specific URL to submit")
  },
  async ({ siteUrl, url }) => {
    try {
      const result = await bingUrlSubmission.submitUrl(siteUrl, url);
      return {
        content: [{ type: "text", text: result }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "bing_url_submit_batch",
  "Submit multiple URLs to Bing for indexing in a single batch",
  {
    siteUrl: z.string().describe("The URL of the site"),
    urlList: z.array(z.string()).describe("List of URLs to submit (max 500)")
  },
  async ({ siteUrl, urlList }) => {
    try {
      const result = await bingUrlSubmission.submitUrlBatch(siteUrl, urlList);
      return {
        content: [{ type: "text", text: result }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "bing_index_now",
  "Submit URLs via IndexNow API (Bing, Yandex, etc.)",
  {
    host: z.string().describe("The host/domain where URLs are located (e.g., www.example.com)"),
    key: z.string().describe("The IndexNow key generated for this host"),
    keyLocation: z.string().optional().describe("Optional URL of the key file (if not at host root)"),
    urlList: z.array(z.string()).describe("List of absolute URLs to notify IndexNow about")
  },
  async (options) => {
    try {
      const result = await indexNow.submitIndexNow(options);
      return {
        content: [{ type: "text", text: result }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

// --- Indexing API Tools ---

registerTool(
  "indexing_submit_url",
  "Submit a URL for indexing (notify Google or Bing that a page was updated). Google Indexing API is officially for JobPosting/BroadcastEvent pages.",
  {
    siteUrl: z.string().describe("The property URL as registered in Search Console"),
    url: z.string().describe("The specific URL to submit for indexing"),
    engine: z.enum(["google", "bing"]).optional().describe("The search engine (default: google)")
  },
  async ({ siteUrl, url, engine = "google" }) => {
    try {
      const result = engine === "google"
        ? await googleIndexing.publishNotification(siteUrl, url, 'URL_UPDATED')
        : await bingUrlSubmission.submitUrl(siteUrl, url);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "indexing_remove_url",
  "Notify Google that a URL has been removed (e.g., expired job posting). Google only.",
  {
    siteUrl: z.string().describe("The property URL as registered in Search Console"),
    url: z.string().describe("The URL that was removed")
  },
  async ({ siteUrl, url }) => {
    try {
      const result = await googleIndexing.publishNotification(siteUrl, url, 'URL_DELETED');
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "indexing_batch_submit",
  "Submit multiple URLs for indexing in batch. Google: max 200 (daily quota), Bing: max 500.",
  {
    siteUrl: z.string().describe("The property URL as registered in Search Console"),
    urls: z.array(z.string()).describe("List of URLs to submit for indexing"),
    engine: z.enum(["google", "bing"]).optional().describe("The search engine (default: google)")
  },
  async ({ siteUrl, urls, engine = "google" }) => {
    try {
      const result = engine === "google"
        ? await googleIndexing.batchPublishNotifications(siteUrl, urls, 'URL_UPDATED')
        : await bingUrlSubmission.submitUrlBatch(siteUrl, urls);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "bing_sites_health",
  "Run a comprehensive health check on one or all verified Bing sites",
  {
    siteUrl: z.string().optional().describe("Optional URL of a specific site to check")
  },
  async ({ siteUrl }) => {
    try {
      const results = await bingHealth.healthCheck(siteUrl);
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "bing_opportunity_finder",
  "Find high-potential 'low-hanging fruit' keywords in Bing",
  {
    siteUrl: z.string().describe("The URL of the site"),
    minImpressions: z.number().optional().describe("Minimum impressions threshold (default 100)")
  },
  async ({ siteUrl, minImpressions }) => {
    try {
      const results = await bingSeoInsights.findLowHangingFruit(siteUrl, { minImpressions });
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "bing_seo_recommendations",
  "Generate prioritized SEO recommendations for a Bing site",
  {
    siteUrl: z.string().describe("The URL of the site")
  },
  async ({ siteUrl }) => {
    try {
      const results = await bingSeoInsights.generateRecommendations(siteUrl);
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "bing_striking_distance",
  "Find keywords ranking positions 8-15 on Bing (near page 1)",
  {
    siteUrl: z.string().describe("The URL of the site")
  },
  async ({ siteUrl }) => {
    try {
      const results = await bingSeoInsights.findStrikingDistance(siteUrl);
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "bing_low_ctr_opportunities",
  "Identify high-ranking Bing queries with lower than expected CTR",
  {
    siteUrl: z.string().describe("The URL of the site"),
    minImpressions: z.number().optional().describe("Minimum impressions threshold (default 500)")
  },
  async ({ siteUrl, minImpressions }) => {
    try {
      const results = await bingSeoInsights.findLowCTROpportunities(siteUrl, { minImpressions });
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "bing_url_info",
  "Get detailed indexing and crawl information for a URL in Bing",
  {
    siteUrl: z.string().describe("The site URL"),
    url: z.string().describe("The specific URL to inspect")
  },
  async ({ siteUrl, url }) => {
    try {
      const result = await bingInspection.getUrlInfo(siteUrl, url);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "bing_link_counts",
  "Get inbound link counts for a site from Bing",
  {
    siteUrl: z.string().describe("The URL of the site")
  },
  async ({ siteUrl }) => {
    try {
      const results = await bingLinks.getLinkCounts(siteUrl);
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "bing_analytics_detect_anomalies",
  "Detect performance anomalies in Bing traffic",
  {
    siteUrl: z.string().describe("The URL of the site"),
    days: z.number().optional().describe("Number of days to check (default 14)"),
    threshold: z.number().optional().describe("Anomaly threshold (default 2.5)")
  },
  async ({ siteUrl, days, threshold }) => {
    try {
      const results = await bingAnalytics.detectAnomalies(siteUrl, { days, threshold });
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "bing_analytics_compare_periods",
  "Compare performance between two date ranges in Bing",
  {
    siteUrl: z.string().describe("The URL of the site"),
    startDate1: z.string().describe("Start date of period 1 (YYYY-MM-DD)"),
    endDate1: z.string().describe("End date of period 1 (YYYY-MM-DD)"),
    startDate2: z.string().describe("Start date of period 2 (YYYY-MM-DD)"),
    endDate2: z.string().describe("End date of period 2 (YYYY-MM-DD)")
  },
  async ({ siteUrl, startDate1, endDate1, startDate2, endDate2 }) => {
    try {
      const result = await bingAnalytics.comparePeriods(siteUrl, startDate1, endDate1, startDate2, endDate2);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "bing_analytics_drop_attribution",
  "Identify the likely cause of a Bing traffic drop",
  {
    siteUrl: z.string().describe("The URL of the site"),
    days: z.number().optional().describe("Lookback period in days (default 30)"),
    threshold: z.number().optional().describe("Anomaly threshold (default 2.0)")
  },
  async ({ siteUrl, days, threshold }) => {
    try {
      const result = await bingAdvancedAnalytics.analyzeDropAttribution(siteUrl, { days, threshold });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "bing_analytics_time_series",
  "Advanced time series analysis for Bing performance data",
  {
    siteUrl: z.string().describe("The URL of the site"),
    days: z.number().optional().describe("Number of days (default 60)"),
    granularity: z.enum(["daily", "weekly"]).optional().describe("Data granularity"),
    metrics: z.array(z.enum(["clicks", "impressions", "ctr", "position"])).optional().describe("Metrics to analyze")
  },
  async ({ siteUrl, days, granularity, metrics }) => {
    try {
      const result = await bingAdvancedAnalytics.getTimeSeriesInsights(siteUrl, { days, granularity, metrics });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);
// --- GA4 Tools ---

registerTool(
  "analytics_page_performance",
  "Get detailed page performance metrics from GA4 (sessions, views, engagement)",
  {
    propertyId: z.string().describe("GA4 Property ID"),
    accountId: z.string().optional().describe("GA4 account ID for multi-account setups"),
    startDate: z.string().describe("Start date (YYYY-MM-DD)"),
    endDate: z.string().describe("End date (YYYY-MM-DD)"),
    pagePath: z.string().optional().describe("Filter by specific page path"),
    limit: z.number().optional().describe("Max rows (default 50)"),
    offset: z.number().optional().describe("Starting row for pagination (0-based)"),
    format: z.enum(["json", "csv"]).optional().describe("Output format (default: json)")
  },
  async ({ propertyId, accountId, startDate, endDate, pagePath, limit, offset, format }) => {
    try {
      const result = await ga4Analytics.getPagePerformance(propertyId, startDate, endDate, pagePath, limit, accountId, offset);
      if (format === 'csv') {
        return {
          content: [{ type: "text", text: jsonToCsv(result) }]
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "analytics_traffic_sources",
  "Analyze traffic sources (Channel, Source, Medium) in GA4",
  {
    propertyId: z.string().describe("GA4 Property ID"),
    accountId: z.string().optional().describe("GA4 account ID for multi-account setups"),
    startDate: z.string().describe("Start date (YYYY-MM-DD)"),
    endDate: z.string().describe("End date (YYYY-MM-DD)"),
    channelGroup: z.string().optional().describe("Filter by Channel Group (e.g. 'Organic Search')"),
    limit: z.number().optional().describe("Max rows (default 50)"),
    offset: z.number().optional().describe("Starting row for pagination (0-based)")
  },
  async ({ propertyId, accountId, startDate, endDate, channelGroup, limit, offset }) => {
    try {
      const result = await ga4Analytics.getTrafficSources(propertyId, startDate, endDate, channelGroup, limit, accountId, offset);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "analytics_organic_landing_pages",
  "Get performance of organic landing pages in GA4 (matches GSC data)",
  {
    propertyId: z.string().describe("GA4 Property ID"),
    accountId: z.string().optional().describe("GA4 account ID for multi-account setups"),
    startDate: z.string().describe("Start date (YYYY-MM-DD)"),
    endDate: z.string().describe("End date (YYYY-MM-DD)"),
    limit: z.number().optional().describe("Max rows (default 50)"),
    offset: z.number().optional().describe("Starting row for pagination (0-based)")
  },
  async ({ propertyId, accountId, startDate, endDate, limit, offset }) => {
    try {
      const result = await ga4Analytics.getOrganicLandingPages(propertyId, startDate, endDate, limit, accountId, offset);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "analytics_content_performance",
  "Analyze content performance by Content Group in GA4 (Requires Content Groups to be configured in GA4 Admin)",
  {
    propertyId: z.string().describe("GA4 Property ID"),
    accountId: z.string().optional().describe("GA4 account ID for multi-account setups"),
    startDate: z.string().describe("Start date (YYYY-MM-DD)"),
    endDate: z.string().describe("End date (YYYY-MM-DD)"),
    limit: z.number().optional().describe("Max rows (default 50)"),
    offset: z.number().optional().describe("Starting row for pagination (0-based)")
  },
  async ({ propertyId, accountId, startDate, endDate, limit, offset }) => {
    try {
      const result = await ga4Analytics.getContentPerformance(propertyId, startDate, endDate, limit, accountId, offset);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "analytics_ecommerce",
  "Get ecommerce performance (products, revenue) from GA4",
  {
    propertyId: z.string().describe("GA4 Property ID"),
    accountId: z.string().optional().describe("GA4 account ID for multi-account setups"),
    startDate: z.string().describe("Start date (YYYY-MM-DD)"),
    endDate: z.string().describe("End date (YYYY-MM-DD)"),
    limit: z.number().optional().describe("Max rows (default 50)"),
    offset: z.number().optional().describe("Starting row for pagination (0-based)")
  },
  async ({ propertyId, accountId, startDate, endDate, limit, offset }) => {
    try {
      const result = await ga4Analytics.getEcommerce(propertyId, startDate, endDate, limit, accountId, offset);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "analytics_realtime",
  "Get realtime active users broken down by page, country, and device",
  {
    propertyId: z.string().describe("GA4 Property ID"),
    accountId: z.string().optional().describe("GA4 account ID for multi-account setups")
  },
  async ({ propertyId, accountId }) => {
    try {
      const result = await ga4Realtime.getRealtimeData(propertyId, accountId);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "analytics_user_behavior",
  "Get user behavior breakdown (Device, Country, Engagement) in a single batch",
  {
    propertyId: z.string().describe("GA4 Property ID"),
    accountId: z.string().optional().describe("GA4 account ID for multi-account setups"),
    startDate: z.string().describe("Start date (YYYY-MM-DD)"),
    endDate: z.string().describe("End date (YYYY-MM-DD)")
  },
  async ({ propertyId, accountId, startDate, endDate }) => {
    try {
      const result = await ga4Behavior.getUserBehavior(propertyId, startDate, endDate, accountId);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "analytics_audience_segments",
  "Get audience segmentation (New vs Returning, Age, OS) in a single batch",
  {
    propertyId: z.string().describe("GA4 Property ID"),
    accountId: z.string().optional().describe("GA4 account ID for multi-account setups"),
    startDate: z.string().describe("Start date (YYYY-MM-DD)"),
    endDate: z.string().describe("End date (YYYY-MM-DD)")
  },
  async ({ propertyId, accountId, startDate, endDate }) => {
    try {
      const result = await ga4Behavior.getAudienceSegments(propertyId, startDate, endDate, accountId);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "analytics_conversion_funnel",
  "Analyze top converting pages and events",
  {
    propertyId: z.string().describe("GA4 Property ID"),
    accountId: z.string().optional().describe("GA4 account ID for multi-account setups"),
    startDate: z.string().describe("Start date (YYYY-MM-DD)"),
    endDate: z.string().describe("End date (YYYY-MM-DD)"),
    eventName: z.string().optional().describe("Filter by specific event name")
  },
  async ({ propertyId, accountId, startDate, endDate, eventName }) => {
    try {
      const result = await ga4Behavior.getConversionFunnel(propertyId, startDate, endDate, eventName, accountId);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "analytics_pagespeed_correlation",
  "Correlate GA4 engagement metrics with PageSpeed Insights scores for top organic pages",
  {
    propertyId: z.string().describe("GA4 Property ID"),
    accountId: z.string().optional().describe("GA4 account ID for multi-account setups"),
    domain: z.string().describe("The domain of the site (e.g. example.com) to construct URLs"),
    startDate: z.string().describe("Start date (YYYY-MM-DD)"),
    endDate: z.string().describe("End date (YYYY-MM-DD)"),
    limit: z.number().optional().describe("Number of pages to analyze (default 5)"),
    strategy: z.enum(["mobile", "desktop"]).optional().describe("PageSpeed strategy (default mobile)")
  },
  async ({ propertyId, accountId, domain, startDate, endDate, limit, strategy }) => {
    try {
      const result = await ga4PageSpeed.getPageSpeedCorrelation(propertyId, domain, startDate, endDate, limit, strategy, accountId);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

// --- Cross-Platform Tools ---

registerTool(
  "page_analysis",
  "Compare GSC ranking data with GA4 behavior data for top pages to find opportunities",
  {
    gscSiteUrl: z.string().describe("GSC Site URL"),
    ga4PropertyId: z.string().describe("GA4 Property ID"),
    startDate: z.string().describe("Start date (YYYY-MM-DD)"),
    endDate: z.string().describe("End date (YYYY-MM-DD)"),
    limit: z.number().optional().describe("Max pages (default 50)"),
    ga4AccountId: z.string().optional().describe("Optional GA4 account ID"),
    gscAccountId: z.string().optional().describe("Optional GSC account ID")
  },
  async ({ gscSiteUrl, ga4PropertyId, startDate, endDate, limit, ga4AccountId, gscAccountId }) => {
    try {
      const result = await ga4GscComparator.analyzePagesCrossPlatform(gscSiteUrl, ga4PropertyId, startDate, endDate, limit, ga4AccountId, gscAccountId);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "traffic_health_check",
  "Diagnose tracking issues by comparing GSC clicks vs GA4 organic sessions",
  {
    gscSiteUrl: z.string().describe("GSC Site URL"),
    ga4PropertyId: z.string().describe("GA4 Property ID"),
    startDate: z.string().describe("Start date (YYYY-MM-DD)"),
    endDate: z.string().describe("End date (YYYY-MM-DD)"),
    ga4AccountId: z.string().optional().describe("Optional GA4 account ID"),
    gscAccountId: z.string().optional().describe("Optional GSC account ID")
  },
  async ({ gscSiteUrl, ga4PropertyId, startDate, endDate, ga4AccountId, gscAccountId }) => {
    try {
      const result = await ga4GscComparator.checkTrafficHealth(gscSiteUrl, ga4PropertyId, startDate, endDate, ga4AccountId, gscAccountId);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "opportunity_matrix",
  "Prioritize SEO tasks by combining signals from GSC, GA4, and Bing",
  {
    gscSiteUrl: z.string().describe("GSC Site URL"),
    bingSiteUrl: z.string().describe("Bing Site URL"),
    ga4PropertyId: z.string().describe("GA4 Property ID"),
    startDate: z.string().describe("Start date (YYYY-MM-DD)"),
    endDate: z.string().describe("End date (YYYY-MM-DD)"),
    limit: z.number().optional().describe("Max results (default 20)"),
    ga4AccountId: z.string().optional().describe("Optional GA4 account ID"),
    gscAccountId: z.string().optional().describe("Optional GSC account ID"),
    bingAccountId: z.string().optional().describe("Optional Bing account ID")
  },
  async ({ gscSiteUrl, bingSiteUrl, ga4PropertyId, startDate, endDate, limit, ga4AccountId, gscAccountId, bingAccountId }) => {
    try {
      const result = await ga4GscBingComparator.getOpportunityMatrix(gscSiteUrl, bingSiteUrl, ga4PropertyId, startDate, endDate, limit, ga4AccountId, gscAccountId, bingAccountId);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

registerTool(
  "brand_analysis",
  "Analyze Brand vs Non-Brand performance across GSC, Bing, and GA4",
  {
    brandTerms: z.array(z.string()).describe("List of brand keywords"),
    gscSiteUrl: z.string().describe("GSC Site URL"),
    bingSiteUrl: z.string().describe("Bing Site URL"),
    ga4PropertyId: z.string().describe("GA4 Property ID"),
    startDate: z.string().describe("Start date (YYYY-MM-DD)"),
    endDate: z.string().describe("End date (YYYY-MM-DD)"),
    ga4AccountId: z.string().optional().describe("Optional GA4 account ID"),
    gscAccountId: z.string().optional().describe("Optional GSC account ID"),
    bingAccountId: z.string().optional().describe("Optional Bing account ID")
  },
  async ({ brandTerms, gscSiteUrl, bingSiteUrl, ga4PropertyId, startDate, endDate, ga4AccountId, gscAccountId, bingAccountId }) => {
    try {
      const result = await ga4GscBingComparator.getBrandAnalysis(brandTerms, gscSiteUrl, bingSiteUrl, ga4PropertyId, startDate, endDate, ga4AccountId, gscAccountId, bingAccountId);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return formatError(error);
    }
  }
);

server.resource(
  "sites",
  "sites://list",
  async (uri) => {
    const result = await sites.listSites();
    return {
      contents: [{
        uri: uri.href,
        text: JSON.stringify(result, null, 2),
        mimeType: "application/json"
      }]
    };
  }
);

server.resource(
  "sitemaps",
  "sitemaps://list/{siteUrl}",
  async (uri) => {
    const siteUrl = decodeURIComponent(uri.pathname.replace('/list/', ''));
    const result = await sitemaps.listSitemaps(siteUrl);
    return {
      contents: [{
        uri: uri.href,
        text: JSON.stringify(result, null, 2),
        mimeType: "application/json"
      }]
    };
  }
);

server.resource(
  "analytics-summary",
  "analytics://summary/{siteUrl}",
  async (uri) => {
    const siteUrl = decodeURIComponent(uri.pathname.replace('/summary/', ''));
    const result = await analytics.getPerformanceSummary(siteUrl);
    return {
      contents: [{
        uri: uri.href,
        text: JSON.stringify(result, null, 2),
        mimeType: "application/json"
      }]
    };
  }
);

// Documentation Resources
import { dimensionsDocs, filtersDocs, searchTypesDocs, patternsDocs, algorithmUpdatesDocs, indexingDocs } from "./google/docs/index.js";

server.resource(
  "docs-dimensions",
  "docs://dimensions",
  async (uri) => ({
    contents: [{
      uri: uri.href,
      text: dimensionsDocs,
      mimeType: "text/markdown"
    }]
  })
);

server.resource(
  "docs-filters",
  "docs://filters",
  async (uri) => ({
    contents: [{
      uri: uri.href,
      text: filtersDocs,
      mimeType: "text/markdown"
    }]
  })
);

server.resource(
  "docs-search-types",
  "docs://search-types",
  async (uri) => ({
    contents: [{
      uri: uri.href,
      text: searchTypesDocs,
      mimeType: "text/markdown"
    }]
  })
);

server.resource(
  "docs-patterns",
  "docs://patterns",
  async (uri) => ({
    contents: [{
      uri: uri.href,
      text: patternsDocs,
      mimeType: "text/markdown"
    }]
  })
);

server.resource(
  "docs-algorithm-updates",
  "docs://algorithm-updates",
  async (uri) => ({
    contents: [{
      uri: uri.href,
      text: algorithmUpdatesDocs,
      mimeType: "text/markdown"
    }]
  })
);

server.resource(
  "docs-bing-api",
  "docs://bing-api",
  async (uri) => ({
    contents: [{
      uri: uri.href,
      text: bingApiDocs,
      mimeType: "text/markdown"
    }]
  })
);

server.resource(
  "docs-index-now",
  "docs://index-now",
  async (uri) => ({
    contents: [{
      uri: uri.href,
      text: indexNowDocs,
      mimeType: "text/markdown"
    }]
  })
);


server.resource(
  "docs-bing-dimensions",
  "docs://bing/dimensions",
  async (uri) => ({
    contents: [{
      uri: uri.href,
      text: bingDimensionsDocs,
      mimeType: "text/markdown"
    }]
  })
);

server.resource(
  "docs-bing-filters",
  "docs://bing/filters",
  async (uri) => ({
    contents: [{
      uri: uri.href,
      text: bingFiltersDocs,
      mimeType: "text/markdown"
    }]
  })
);

server.resource(
  "docs-bing-search-types",
  "docs://bing/search-types",
  async (uri) => ({
    contents: [{
      uri: uri.href,
      text: bingSearchTypesDocs,
      mimeType: "text/markdown"
    }]
  })
);

server.resource(
  "docs-bing-patterns",
  "docs://bing/patterns",
  async (uri) => ({
    contents: [{
      uri: uri.href,
      text: bingPatternsDocs,
      mimeType: "text/markdown"
    }]
  })
);

server.resource(
  "docs-bing-algorithm-updates",
  "docs://bing/algorithm-updates",
  async (uri) => ({
    contents: [{
      uri: uri.href,
      text: bingAlgorithmUpdatesDocs,
      mimeType: "text/markdown"
    }]
  })
);

server.resource(
  "docs-indexing",
  "docs://indexing",
  async (uri) => ({
    contents: [{
      uri: uri.href,
      text: indexingDocs,
      mimeType: "text/markdown"
    }]
  })
);

// Prompts
server.prompt(
  "analyze-site-performance",
  {
    siteUrl: z.string().describe("The URL of the site to analyze"),
    engine: z.enum(["google", "bing", "ga4"]).optional().describe("The search engine to use (default: google)"),
    startDate: z.string().optional().describe("Start date (YYYY-MM-DD), defaults to 1 month ago"),
    endDate: z.string().optional().describe("End date (YYYY-MM-DD), defaults to today")
  },
  ({ siteUrl, engine = "google", startDate, endDate }) => {
    const end = endDate || new Date().toISOString().split('T')[0];
    const start = startDate || (() => {
      const d = new Date();
      d.setMonth(d.getMonth() - 1);
      return d.toISOString().split('T')[0];
    })();

    return {
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Please analyze the performance of the site ${siteUrl} on ${engine === 'google' ? 'Google' : engine === 'bing' ? 'Bing' : 'GA4'} for the period ${start} to ${end}.
        
        ${engine === 'google'
              ? `Use the 'analytics_query' tool with startDate='${start}' and endDate='${end}' to get detailed metrics.`
              : engine === 'bing'
                ? `Use the 'bing_analytics_query' tool with startDate='${start}' and endDate='${end}' to get query stats and 'bing_analytics_page' for page-level performance.`
                : `Use the 'analytics_page_performance' and 'analytics_traffic_sources' tools with propertyId='[PROPERTY_ID]', startDate='${start}' and endDate='${end}'.`}
        
        Provide a summary of the site's health and any opportunities for improvement on ${engine === 'google' ? 'Google' : engine === 'bing' ? 'Bing' : 'GA4'}.`
        }
      }]
    };
  }
);

server.prompt(
  "compare-performance",
  {
    siteUrl: z.string().describe("The URL of the site to analyze"),
    engine: z.enum(["google", "bing", "ga4"]).optional().describe("The search engine to use (default: google)"),
    months: z.number().optional().describe("Number of months to compare (default: 1)")
  },
  ({ siteUrl, engine = "google", months = 1 }) => {
    const end1 = new Date().toISOString().split('T')[0];
    const start1 = (() => {
      const d = new Date();
      d.setMonth(d.getMonth() - months);
      return d.toISOString().split('T')[0];
    })();
    const end2 = start1;
    const start2 = (() => {
      const d = new Date();
      d.setMonth(d.getMonth() - (months * 2));
      return d.toISOString().split('T')[0];
    })();

    return {
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Compare the performance of ${siteUrl} on ${engine === 'google' ? 'Google' : 'Bing'} for the period ${start1} to ${end1} vs ${start2} to ${end2}.

${engine === 'google'
              ? `Use the 'analytics_compare_periods' tool with:
- period1Start: '${start1}', period1End: '${end1}'
- period2Start: '${start2}', period2End: '${end2}'

Analyze the changes in clicks, impressions, CTR, and position.
If there are notable changes, use 'analytics_top_queries' to identify which queries are driving the change.`
              : engine === 'bing'
                ? `Use the 'bing_analytics_compare_periods' tool with:
- startDate1: '${start1}', endDate1: '${end1}'
- startDate2: '${start2}', endDate2: '${end2}'

Analyze the changes in clicks, impressions, CTR, and position.
Use 'bing_analytics_query' to identify which queries are driving changes.`
                : `Use the 'analytics_page_performance' tool twice (once for each period: ${start1} to ${end1} and ${start2} to ${end2}) to compare sessions and engagement.
Analyze changes in key metrics and identify top performing pages.`
            }`
        }
      }]
    };
  }
);

server.prompt(
  "find-declining-pages",
  {
    siteUrl: z.string().describe("The URL of the site to analyze"),
    engine: z.enum(["google", "bing", "ga4"]).optional().describe("The search engine to use (default: google)"),
    months: z.number().optional().describe("Number of months to analyze (default: 1)")
  },
  ({ siteUrl, engine = "google", months = 1 }) => {
    const end = new Date().toISOString().split('T')[0];
    const start = (() => {
      const d = new Date();
      d.setMonth(d.getMonth() - months);
      return d.toISOString().split('T')[0];
    })();

    return {
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Find pages on ${siteUrl} that are losing traffic on ${engine === 'google' ? 'Google' : 'Bing'} between ${start} and ${end}.

${engine === 'google'
              ? `Steps:
1. Use 'analytics_compare_periods' to compare this period (${start} to ${end}) vs the previous ${months} month(s)
2. Use 'analytics_query' with dimension 'page' to get page-level data
3. Identify pages with significant click/impression drops`
              : engine === 'bing'
                ? `Steps:
1. Use 'bing_analytics_compare_periods' to identify overall traffic direction.
2. Use 'bing_analytics_page' with startDate='${start}' and endDate='${end}' to get top pages.
3. Use 'bing_analytics_page_query' for specific pages to see which queries dropped.`
                : `Steps:
1. Use 'analytics_page_performance' for the current period and compare it to historical data.
2. Identify landing pages with significant drops in sessions or engagement.`
            }

For each declining page, provide:
- The URL
- Previous vs current performance
- Possible reasons and recommendations`
        }
      }]
    };
  }
);

server.prompt(
  "keyword-opportunities",
  {
    siteUrl: z.string().describe("The URL of the site to analyze"),
    engine: z.enum(["google", "bing", "ga4"]).optional().describe("The search engine to use (default: google)"),
    months: z.number().optional().describe("Number of months of data to analyze (default: 3)")
  },
  ({ siteUrl, engine = "google", months = 3 }) => {
    const end = new Date().toISOString().split('T')[0];
    const start = (() => {
      const d = new Date();
      d.setMonth(d.getMonth() - months);
      return d.toISOString().split('T')[0];
    })();

    return {
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Find keyword opportunities for ${siteUrl} on ${engine === 'google' ? 'Google' : 'Bing'} for the last ${months} months (${start} to ${end}).
        
${engine === 'google'
              ? "Use 'analytics_top_queries' or 'seo_low_hanging_fruit' to find high-potential targets."
              : engine === 'bing'
                ? `Use 'bing_opportunity_finder' or 'bing_striking_distance' to find high-potential keywords.`
                : `Note: GA4 does not provide keyword-level data. Use 'analytics_organic_landing_pages' to find top organic pages and 'analytics_page_performance' to identify engagement opportunities.`}
        
        Analyze for:
        1. **Low CTR, High Impressions**: Queries where you rank but don't get clicks
        2. **High Position (>10), Good Impressions**: Queries not on page 1 (Striking Distance)
        3. **New Ranking Queries**: Queries that appeared recently (use comparison tools)
        
        Provide specific recommendations for the top 5 opportunities.`
        }
      }]
    };
  }
);

server.prompt(
  "new-content-impact",
  {
    siteUrl: z.string().describe("The URL of the site"),
    pageUrl: z.string().describe("The URL of the new content to analyze"),
    engine: z.enum(["google", "bing", "ga4"]).optional().describe("The search engine to use (default: google)"),
    months: z.number().optional().describe("Number of months to analyze (default: 1)")
  },
  ({ siteUrl, pageUrl, engine = "google", months = 1 }) => {
    const end = new Date().toISOString().split('T')[0];
    const start = (() => {
      const d = new Date();
      d.setMonth(d.getMonth() - months);
      return d.toISOString().split('T')[0];
    })();

    return {
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Analyze the impact of new content at ${pageUrl} on site ${siteUrl} in ${engine === 'google' ? 'Google' : 'Bing'} for the period ${start} to ${end}.

1. Use '${engine === 'google' ? 'inspection_inspect' : engine === 'bing' ? 'bing_url_info' : 'analytics_page_performance'}' to check status.
2. Use '${engine === 'google' ? 'analytics_query' : engine === 'bing' ? 'bing_analytics_page_query' : 'analytics_page_performance'}' with startDate='${start}' and endDate='${end}' to get performance for this specific URL.
3. Identify which queries (GSC/Bing) or traffic sources (GA4) are driving traffic to this page.

Provide:
- Indexing status
- Key metrics (clicks, impressions, CTR, position)
- Top queries ranking for this page
- Recommendations for improvement`
        }
      }]
    };
  }
);

server.prompt(
  "mobile-vs-desktop",
  {
    siteUrl: z.string().describe("The URL of the site to analyze"),
    engine: z.enum(["google", "bing", "ga4"]).optional().describe("The search engine to use (default: google)"),
    months: z.number().optional().describe("Number of months to analyze (default: 1)")
  },
  ({ siteUrl, engine = "google", months = 1 }) => {
    const end = new Date().toISOString().split('T')[0];
    const start = (() => {
      const d = new Date();
      d.setMonth(d.getMonth() - months);
      return d.toISOString().split('T')[0];
    })();

    return {
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Compare mobile vs desktop performance for ${siteUrl} on ${engine === 'google' ? 'Google' : 'Bing'} from ${start} to ${end}.

${engine === 'google'
              ? `Use 'analytics_query' with dimension 'device', startDate='${start}', and endDate='${end}' to get device-level metrics.`
              : engine === 'bing'
                ? "Note: Bing Webmaster API provides limited native device breakdown via the public API."
                : `Use 'analytics_user_behavior' to get a full device breakdown (Mobile vs Desktop vs Tablet) for GA4.`}

Analyze:
1. Click and impression distribution across devices (if data available)
2. CTR differences
3. Position ranking differences

If there's a significant gap, investigate:
- Use '${engine === 'google' ? 'inspection_inspect' : 'bing_url_info'}' on key pages to check health/usability.
- Recommend specific improvements.

Provide a summary with actionable recommendations.`
        }
      }]
    };
  }
);

server.prompt(
  "site-health-check",
  {
    siteUrl: z.string().optional().describe("Optional. The URL of a specific site to check."),
    engine: z.enum(["google", "bing", "ga4"]).optional().describe("The search engine to use (default: google)"),
    months: z.number().optional().describe("Number of months to analyze for trends (default: 1)")
  },
  ({ siteUrl, engine = "google", months = 1 }) => {
    const end = new Date().toISOString().split('T')[0];
    const start = (() => {
      const d = new Date();
      d.setMonth(d.getMonth() - months);
      return d.toISOString().split('T')[0];
    })();

    return {
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Run a comprehensive health check for ${siteUrl ? siteUrl : 'all verified sites'} on ${engine === 'google' ? 'Google' : 'Bing'} analyzing the period ${start} to ${end}.

Use the '${engine === 'google' ? 'sites_health_check' : engine === 'bing' ? 'bing_sites_health' : 'analytics_user_behavior'}' tool.

Then for each site in the results:
1. **Summarize the status** (healthy / warning / critical).
2. **Performance:** Report changes in key metrics (clicks/impressions for search, sessions/engagement for GA4).
3. **Internal Health:** Note any errors or warnings (use '${engine === 'google' ? 'sitemaps_list' : engine === 'bing' ? 'bing_crawl_issues' : 'analytics_conversion_funnel'}').
4. **Anomalies:** Highlight any traffic drops (use '${engine === 'google' ? 'analytics_anomalies' : engine === 'bing' ? 'bing_analytics_detect_anomalies' : 'analytics_realtime'}').

If any site has a 'critical' or 'warning' status:
- For critical drops, use '${engine === 'google' ? 'analytics_drop_attribution' : engine === 'bing' ? 'bing_analytics_drop_attribution' : 'analytics_user_behavior'}'.
- Provide 3 prioritized action items.`
        }
      }]
    };
  }
);

async function main() {
  const command = process.argv[2];

  if (process.stdout.isTTY) {
    try {
      const { checkVersionCached, promptUpdateInteractive } = await import("./utils/update.js");
      const info = await checkVersionCached(version);
      if (info.updateAvailable) {
        await promptUpdateInteractive(info.latestVersion, version);
      }
    } catch {
      // Fail silently
    }
  }

  if (command === 'update') {
    const { runUpdateCommand } = await import('./utils/update.js');
    await runUpdateCommand();
    return;
  }

  if (isCliRun()) {
    process.exitCode = await runCli();
    return;
  }

  // Handle standalone commands
  if (command === 'setup') {
    const { main: setupMain } = await import('./setup.js');
    await setupMain();
    return;
  }

  if (command === 'account' || command === 'accounts') {
    const { main: accountsMain } = await import('./accounts.js');
    await accountsMain(process.argv.slice(3));
    return;
  }

  if (command === 'logout') {
    const { runLogout } = await import('./setup.js');
    await runLogout();
    return;
  }

  if (command === 'login') {
    const { login } = await import('./setup.js');
    await login();
    return;
  }

  if (command === 'diagnostics') {
    const results = await runDiagnostics();
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  if (command === 'sites') {
    const { main: accountsMain } = await import('./accounts.js');
    await accountsMain(['list']);
    return;
  }

  // Check for credentials
  const config = await loadConfig();
  const accounts = Object.values(config.accounts);

  const hasGoogle = accounts.some(a => a.engine === 'google') ||
    !!process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    (!!process.env.GOOGLE_CLIENT_EMAIL && !!process.env.GOOGLE_PRIVATE_KEY) ||
    existsSync(join(homedir(), '.search-console-mcp-tokens.enc')); // Legacy check

  const hasBing = accounts.some(a => a.engine === 'bing') || !!process.env.BING_API_KEY;
  const hasGA4 = accounts.some(a => a.engine === 'ga4');

  if (!hasGoogle && !hasBing && !hasGA4) {
    printBoxHeader('Authentication', colors.red);

    console.error(`${colors.bold}${colors.dim}🔍 Connection Status:${colors.reset}`);
    printStatusLine('Google', hasGoogle);
    printStatusLine('GA4', hasGA4);
    printStatusLine('Bing', hasBing);
    console.error('');

    if (!hasGoogle) {
      console.error(`${colors.red}✘${colors.reset} ${colors.bold}Google not configured.${colors.reset}`);
      console.error(`${colors.blue}ℹ${colors.reset} ${colors.dim}Run:${colors.reset} ${colors.bold}${colors.cyan}search-console-mcp setup --engine=google${colors.reset}`);
    }

    if (!hasGA4) {
      console.error(`${colors.red}✘${colors.reset} ${colors.bold}GA4 not configured.${colors.reset}`);
      console.error(`${colors.blue}ℹ${colors.reset} ${colors.dim}Run:${colors.reset} ${colors.bold}${colors.cyan}search-console-mcp setup --engine=ga4${colors.reset}`);
    }

    if (!hasBing) {
      console.error(`\n${colors.red}✘${colors.reset} ${colors.bold}Bing not configured.${colors.reset}`);
      console.error(`${colors.blue}ℹ${colors.reset} ${colors.dim}Run:${colors.reset} ${colors.bold}${colors.cyan}search-console-mcp setup --engine=bing${colors.reset}`);
    }

    console.error(`\n${colors.dim}${'─'.repeat(64)}${colors.reset}\n`);
  }

  const isSseMode = process.argv.includes("--transport=sse") || process.argv.includes("serve");
  const portArg = process.argv.find((arg) => arg.startsWith("--port="));
  const port = portArg ? parseInt(portArg.split("=")[1], 10) : 3000;

  if (isSseMode) {
    await startSseServer(server, port);
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    const googleStatus = hasGoogle ? `${colors.green}✔ Google${colors.reset}` : `${colors.red}✘ Google${colors.reset}`;
    const ga4Status = hasGA4 ? `${colors.green}✔ GA4${colors.reset}` : `${colors.red}✘ GA4${colors.reset}`;
    const bingStatus = hasBing ? `${colors.green}✔ Bing${colors.reset}` : `${colors.red}✘ Bing${colors.reset}`;
    console.error(`Search Console MCP running on stdio [ ${googleStatus} | ${ga4Status} | ${bingStatus} ]`);
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
