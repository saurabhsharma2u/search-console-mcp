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
import { executeLegacyFallback, legacyFallbackMap, shouldUseLegacyFallback } from "./legacy/fallback-router.js";
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

// Google AdSense
registerTool(
  "adsense_accounts",
  "List configured AdSense publisher accounts, or discover all publisher accounts the authorized user has access to.",
  {
    accountId: z.string().optional().describe("Specific AdSense account ID (default: auto-select)"),
    mode: z.enum(["configured", "discover"]).optional().describe("configured = saved accounts; discover = all accessible publisher IDs (default: configured)")
  },
  async (args: any) => {
    const { listAdSenseAccounts, listAccessibleAdSenseAccounts } = await import("./adsense/tools/accounts.js");
    const result = args.mode === "discover"
      ? await listAccessibleAdSenseAccounts(args.accountId)
      : await listAdSenseAccounts(args.accountId);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

registerTool(
  "adsense_report",
  "Google AdSense earnings & performance report: estimated earnings, impressions, clicks, CTR and RPM with dimension breakdowns.",
  {
    accountId: z.string().optional().describe("Specific AdSense account ID (default: auto-select)"),
    dateRange: z.enum(["TODAY", "YESTERDAY", "THIS_WEEK", "LAST_WEEK", "THIS_MONTH", "LAST_MONTH", "LAST_7_DAYS", "LAST_30_DAYS"]).optional().describe("Preset date range (default: LAST_7_DAYS)"),
    startDate: z.string().optional().describe("Custom start date YYYY-MM-DD (requires endDate, overrides dateRange)"),
    endDate: z.string().optional().describe("Custom end date YYYY-MM-DD (requires startDate)"),
    dimensions: z.array(z.enum(["DATE", "WEEK", "MONTH", "DOMAIN_NAME", "COUNTRY_NAME", "PLATFORM_TYPE_NAME", "AD_UNIT_ID", "AD_UNIT_NAME", "CUSTOM_CHANNEL_ID", "CUSTOM_CHANNEL_NAME", "PRODUCT_NAME", "PRODUCT_CODE", "URL_CHANNEL_ID"])).optional().describe("Breakdown dimensions"),
    metrics: z.array(z.enum(["ESTIMATED_EARNINGS", "PAGE_VIEWS", "IMPRESSIONS", "CLICKS", "PAGE_VIEWS_CTR", "PAGE_VIEWS_RPM", "IMPRESSIONS_CTR", "IMPRESSIONS_RPM"])).optional().describe("Metrics to report (default: earnings, page views, impressions, clicks, RPM)"),
    rowLimit: z.number().optional().describe("Max rows to return (default: 100, max: 200)"),
    orderBy: z.string().optional().describe('Sort order as "+METRIC" (ascending) or "-METRIC" (descending), e.g. "-ESTIMATED_EARNINGS"')
  },
  async (args: any) => {
    const { generateReport } = await import("./adsense/tools/reports.js");
    const result = await generateReport(args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

registerTool(
  "adsense_payments_alerts",
  "Outstanding AdSense payments and account alerts (policy issues, payment holds).",
  {
    accountId: z.string().optional().describe("Specific AdSense account ID (default: auto-select)")
  },
  async (args: any) => {
    const { listPayments, listAlerts } = await import("./adsense/tools/reports.js");
    const [payments, alerts] = await Promise.all([
      listPayments(args.accountId),
      listAlerts(args.accountId)
    ]);
    return { content: [{ type: "text", text: JSON.stringify({ payments, alerts }, null, 2) }] };
  }
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
    type: z.enum(["stats", "related", "traffic"]).optional().describe("Analysis type"),
    engine: z.enum(["google", "bing", "all"]).optional().describe("Target search engine (default: google)")
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

// Legacy names are aliases only for tools not registered under the current
// schema; non-legacy traffic goes to the SDK dispatcher for validation.
const sdkCallToolHandler =
  (server.server as any)._requestHandlers?.get('tools/call') ?? null;
(server.server as any).setRequestHandler(CallToolRequestSchema, async (request: any, extra: any) => {
  const toolName = request.params.name;
  const registeredTool = (server as any)._registeredTools[toolName];
  if (shouldUseLegacyFallback(toolName, Boolean(registeredTool))) {
    const legacyResult = await executeLegacyFallback(toolName, request.params.arguments);
    if (legacyResult) return legacyResult;
  }
  if (sdkCallToolHandler) {
    return await sdkCallToolHandler(request, extra);
  }
  if (!registeredTool) {
    throw new Error(`Tool ${toolName} not found`);
  }
  return await registeredTool.handler(request.params.arguments);
});

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
  const hasAdSense = accounts.some(a => a.engine === 'adsense');

  if (!hasGoogle && !hasBing && !hasGA4 && !hasAdSense) {
    printBoxHeader('Authentication', colors.red);

    console.error(`${colors.bold}${colors.dim}🔍 Connection Status:${colors.reset}`);
    printStatusLine('Google', hasGoogle);
    printStatusLine('GA4', hasGA4);
    printStatusLine('Bing', hasBing);
    printStatusLine('AdSense', hasAdSense);
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

    if (!hasAdSense) {
      console.error(`\n${colors.red}✘${colors.reset} ${colors.bold}AdSense not configured.${colors.reset}`);
      console.error(`${colors.blue}ℹ${colors.reset} ${colors.dim}Run:${colors.reset} ${colors.bold}${colors.cyan}search-console-mcp setup --engine=adsense${colors.reset}`);
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
    const adsenseStatus = hasAdSense ? `${colors.green}✔ AdSense${colors.reset}` : '';
    const statusParts = [googleStatus, ga4Status, bingStatus, adsenseStatus].filter(Boolean);
    console.error(`Search Console MCP running on stdio [ ${statusParts.join(' | ')} ]`);
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
