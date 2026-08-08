import * as sitesFluent from "../tools/fluent/sites.js";
import * as sitemapsFluent from "../tools/fluent/sitemaps.js";
import * as analyticsFluent from "../tools/fluent/analytics.js";
import * as inspectionFluent from "../tools/fluent/inspection.js";
import * as indexingFluent from "../tools/fluent/indexing.js";
import * as seoFluent from "../tools/fluent/seo.js";
import * as healthFluent from "../tools/fluent/health.js";

type LegacyHandler = (args: any) => Promise<any>;

export const legacyFallbackMap: Record<string, LegacyHandler> = {
  // Sites & Accounts
  sites_list: (args) => sitesFluent.sitesListHandler({ engine: "google" }),
  sites_get: (args) => sitesFluent.sitesListHandler({ engine: "google" }),
  sites_add: (args) => sitesFluent.sitesManageHandler({ action: "add", siteUrl: args.siteUrl, engine: "google" }),
  sites_delete: (args) => sitesFluent.sitesManageHandler({ action: "delete", siteUrl: args.siteUrl, engine: "google" }),
  bing_sites_list: (args) => sitesFluent.sitesListHandler({ engine: "bing" }),
  bing_sites_add: (args) => sitesFluent.sitesManageHandler({ action: "add", siteUrl: args.siteUrl, engine: "bing" }),
  bing_sites_delete: (args) => sitesFluent.sitesManageHandler({ action: "delete", siteUrl: args.siteUrl, engine: "bing" }),
  accounts_list: (args) => sitesFluent.accountsManageHandler({ action: "list" }),
  accounts_add_site: (args) => sitesFluent.accountsManageHandler({ action: "add_site", accountId: args.accountId, siteUrl: args.siteUrl }),
  accounts_remove: (args) => sitesFluent.accountsManageHandler({ action: "remove", accountId: args.accountId }),

  // Sitemaps
  sitemaps_list: (args) => sitemapsFluent.sitemapsListHandler({ siteUrl: args.siteUrl, feedUrl: args.feedUrl, engine: "google" }),
  sitemaps_get: (args) => sitemapsFluent.sitemapsListHandler({ siteUrl: args.siteUrl, feedUrl: args.feedUrl, engine: "google" }),
  sitemaps_submit: (args) => sitemapsFluent.sitemapsSubmitHandler({ siteUrl: args.siteUrl, feedUrl: args.feedUrl, engine: "google" }),
  sitemaps_delete: (args) => sitemapsFluent.sitemapsDeleteHandler({ siteUrl: args.siteUrl, feedUrl: args.feedUrl, engine: "google" }),
  bing_sitemaps_list: (args) => sitemapsFluent.sitemapsListHandler({ siteUrl: args.siteUrl, engine: "bing" }),
  bing_sitemaps_submit: (args) => sitemapsFluent.sitemapsSubmitHandler({ siteUrl: args.siteUrl, feedUrl: args.feedUrl, engine: "bing" }),
  bing_sitemaps_delete: (args) => sitemapsFluent.sitemapsDeleteHandler({ siteUrl: args.siteUrl, feedUrl: args.feedUrl, engine: "bing" }),

  // Indexing & URL Submission
  indexing_submit_url: (args) => indexingFluent.indexingSubmitHandler({ siteUrl: args.siteUrl, urls: [args.url], method: "standard", engine: args.engine ?? "google" }),
  indexing_batch_submit: (args) => indexingFluent.indexingSubmitHandler({ siteUrl: args.siteUrl, urls: args.urls, method: "standard", engine: args.engine ?? "google" }),
  indexing_remove_url: (args) => indexingFluent.indexingSubmitHandler({ siteUrl: args.siteUrl, urls: [args.url], method: "remove" }),
  indexing_status: (args) => indexingFluent.indexingStatusHandler({ siteUrl: args.siteUrl, url: args.url, type: "status" }),
  bing_url_submit: (args) => indexingFluent.indexingSubmitHandler({ siteUrl: args.siteUrl, urls: [args.url], method: "standard", engine: "bing" }),
  bing_url_submit_batch: (args) => indexingFluent.indexingSubmitHandler({ siteUrl: args.siteUrl, urls: args.urlList, method: "standard", engine: "bing" }),
  bing_index_now: (args) => indexingFluent.indexingSubmitHandler({ urls: args.urlList, method: "index_now", host: args.host, key: args.key, keyLocation: args.keyLocation }),
  bing_url_submission_quota: (args) => indexingFluent.indexingStatusHandler({ siteUrl: args.siteUrl, type: "quota", engine: "bing" }),

  // Inspection & PageSpeed
  inspection_inspect: (args) => inspectionFluent.inspectionInspectHandler({ siteUrl: args.siteUrl, urls: [args.url], engine: "google" }),
  inspection_batch: (args) => inspectionFluent.inspectionInspectHandler({ siteUrl: args.siteUrl, urls: args.urls, engine: "google" }),
  bing_url_info: (args) => inspectionFluent.inspectionInspectHandler({ siteUrl: args.siteUrl, urls: [args.url], engine: "bing" }),
  pagespeed_analyze: (args) => inspectionFluent.pagespeedAnalyzeHandler({ url: args.url, strategy: args.strategy, category: args.category }),
  pagespeed_core_web_vitals: (args) => inspectionFluent.pagespeedAnalyzeHandler({ url: args.url, strategy: args.strategy, cwvOnly: true }),

  // Analytics & Trends
  analytics_query: (args) => analyticsFluent.analyticsQueryHandler({ siteUrl: args.siteUrl, startDate: args.startDate, endDate: args.endDate, dimensions: args.dimensions, filters: args.filters, rowLimit: args.rowLimit, engine: "google" }),
  bing_analytics_query: (args) => analyticsFluent.analyticsQueryHandler({ siteUrl: args.siteUrl, startDate: args.startDate, endDate: args.endDate, dimensions: args.dimensions, filters: args.filters, rowLimit: args.rowLimit, engine: "bing" }),
  analytics_performance_summary: (args) => analyticsFluent.analyticsQueryHandler({ siteUrl: args.siteUrl, startDate: args.startDate, endDate: args.endDate, engine: "google" }),
  analytics_top_queries: (args) => analyticsFluent.analyticsQueryHandler({ siteUrl: args.siteUrl, dimensions: ["query"], rowLimit: args.limit ?? 10, engine: "google" }),
  analytics_top_pages: (args) => analyticsFluent.analyticsQueryHandler({ siteUrl: args.siteUrl, dimensions: ["page"], rowLimit: args.limit ?? 10, engine: "google" }),
  analytics_by_country: (args) => analyticsFluent.analyticsQueryHandler({ siteUrl: args.siteUrl, dimensions: ["country"], engine: "google" }),
  analytics_search_appearance: (args) => analyticsFluent.analyticsQueryHandler({ siteUrl: args.siteUrl, dimensions: ["searchAppearance"], engine: "google" }),
  analytics_time_series: (args) => analyticsFluent.analyticsQueryHandler({ siteUrl: args.siteUrl, dimensions: ["date"], startDate: args.startDate, endDate: args.endDate, engine: "google" }),
  bing_analytics_time_series: (args) => analyticsFluent.analyticsQueryHandler({ siteUrl: args.siteUrl, dimensions: ["date"], startDate: args.startDate, endDate: args.endDate, engine: "bing" }),
  bing_get_top_queries: (args) => analyticsFluent.analyticsQueryHandler({ siteUrl: args.siteUrl, dimensions: ["query"], rowLimit: args.limit ?? 10, engine: "bing" }),
  bing_get_top_pages: (args) => analyticsFluent.analyticsQueryHandler({ siteUrl: args.siteUrl, dimensions: ["page"], rowLimit: args.limit ?? 10, engine: "bing" }),
  bing_analytics_page: (args) => analyticsFluent.analyticsQueryHandler({ siteUrl: args.siteUrl, dimensions: ["page"], engine: "bing" }),
  bing_analytics_page_query: (args) => analyticsFluent.analyticsQueryHandler({ siteUrl: args.siteUrl, dimensions: ["page", "query"], engine: "bing" }),
  bing_analytics_query_page: (args) => analyticsFluent.analyticsQueryHandler({ siteUrl: args.siteUrl, dimensions: ["query", "page"], engine: "bing" }),

  // Comparisons & Trends
  analytics_compare_periods: (args) => analyticsFluent.analyticsCompareHandler({ siteUrl: args.siteUrl, mode: "period_over_period", startDate: args.startDate, endDate: args.endDate, compareStartDate: args.compareStartDate, compareEndDate: args.compareEndDate, engine: "google" }),
  bing_analytics_compare_periods: (args) => analyticsFluent.analyticsCompareHandler({ siteUrl: args.siteUrl, mode: "period_over_period", startDate: args.startDate, endDate: args.endDate, compareStartDate: args.compareStartDate, compareEndDate: args.compareEndDate, engine: "bing" }),
  analytics_trends: (args) => analyticsFluent.analyticsCompareHandler({ siteUrl: args.siteUrl, mode: "trends", startDate: args.startDate, endDate: args.endDate, engine: "google" }),
  bing_analytics_trends: (args) => analyticsFluent.analyticsCompareHandler({ siteUrl: args.siteUrl, mode: "trends", startDate: args.startDate, endDate: args.endDate, engine: "bing" }),
  analytics_drop_attribution: (args) => analyticsFluent.analyticsCompareHandler({ siteUrl: args.siteUrl, mode: "drop_attribution", startDate: args.startDate, endDate: args.endDate, engine: "google" }),
  bing_analytics_drop_attribution: (args) => analyticsFluent.analyticsCompareHandler({ siteUrl: args.siteUrl, mode: "drop_attribution", startDate: args.startDate, endDate: args.endDate, engine: "bing" }),
  analytics_anomalies: (args) => analyticsFluent.analyticsAnomaliesHandler({ siteUrl: args.siteUrl, startDate: args.startDate, endDate: args.endDate, threshold: args.threshold, engine: "google" }),
  bing_analytics_detect_anomalies: (args) => analyticsFluent.analyticsAnomaliesHandler({ siteUrl: args.siteUrl, startDate: args.startDate, endDate: args.endDate, threshold: args.threshold, engine: "bing" }),

  // SEO Insights & Audits
  seo_recommendations: (args) => seoFluent.seoAuditHandler({ siteUrl: args.siteUrl, type: "recommendations", engine: "google" }),
  bing_seo_recommendations: (args) => seoFluent.seoAuditHandler({ siteUrl: args.siteUrl, type: "recommendations", engine: "bing" }),
  seo_quick_wins: (args) => seoFluent.seoAuditHandler({ siteUrl: args.siteUrl, type: "quick_wins", engine: "google" }),
  seo_low_hanging_fruit: (args) => seoFluent.seoAuditHandler({ siteUrl: args.siteUrl, type: "low_hanging_fruit", minImpressions: args.minImpressions, engine: "google" }),
  bing_opportunity_finder: (args) => seoFluent.seoAuditHandler({ siteUrl: args.siteUrl, type: "low_hanging_fruit", minImpressions: args.minImpressions, engine: "bing" }),
  seo_cannibalization: (args) => seoFluent.seoAuditHandler({ siteUrl: args.siteUrl, type: "cannibalization", engine: "google" }),
  bing_seo_cannibalization: (args) => seoFluent.seoAuditHandler({ siteUrl: args.siteUrl, type: "cannibalization", engine: "bing" }),
  seo_striking_distance: (args) => seoFluent.seoAuditHandler({ siteUrl: args.siteUrl, type: "striking_distance", engine: "google" }),
  bing_striking_distance: (args) => seoFluent.seoAuditHandler({ siteUrl: args.siteUrl, type: "striking_distance", engine: "bing" }),
  seo_lost_queries: (args) => seoFluent.seoAuditHandler({ siteUrl: args.siteUrl, type: "lost_queries", engine: "google" }),
  bing_seo_lost_queries: (args) => seoFluent.seoAuditHandler({ siteUrl: args.siteUrl, type: "lost_queries", engine: "bing" }),
  seo_low_ctr_opportunities: (args) => seoFluent.seoAuditHandler({ siteUrl: args.siteUrl, type: "low_ctr", minImpressions: args.minImpressions, engine: "google" }),
  bing_low_ctr_opportunities: (args) => seoFluent.seoAuditHandler({ siteUrl: args.siteUrl, type: "low_ctr", minImpressions: args.minImpressions, engine: "bing" }),
  seo_brand_vs_nonbrand: (args) => seoFluent.seoAuditHandler({ siteUrl: args.siteUrl, type: "brand_vs_nonbrand", brandKeywords: args.brandKeywords, engine: "google" }),
  bing_brand_analysis: (args) => seoFluent.seoAuditHandler({ siteUrl: args.siteUrl, type: "brand_vs_nonbrand", brandKeywords: args.brandKeywords, engine: "bing" }),

  // Keywords & Health
  bing_keywords_stats: (args) => seoFluent.seoKeywordsResearchHandler({ keywords: args.keywords, country: args.country, language: args.language, type: "stats" }),
  bing_related_keywords: (args) => seoFluent.seoKeywordsResearchHandler({ keywords: [args.keyword], country: args.country, language: args.language, type: "related" }),
  bing_rank_traffic_stats: (args) => seoFluent.seoKeywordsResearchHandler({ siteUrl: args.siteUrl, keywords: [], type: "traffic" }),
  sites_health_check: (args) => healthFluent.siteHealthCheckHandler({ siteUrl: args.siteUrl, engine: "google" }),
  bing_sites_health: (args) => healthFluent.siteHealthCheckHandler({ siteUrl: args.siteUrl, engine: "bing" }),
  bing_crawl_issues: (args) => healthFluent.siteHealthCheckHandler({ siteUrl: args.siteUrl, level: "crawl_issues", engine: "bing" }),
  bing_crawl_stats: (args) => healthFluent.siteHealthCheckHandler({ siteUrl: args.siteUrl, level: "crawl_issues", engine: "bing" }),
  compare_engines: (args) => healthFluent.compareEnginesHandler({ siteUrl: args.siteUrl, startDate: args.startDate, endDate: args.endDate, dimension: args.dimension, limit: args.limit })
};

/**
 * Handle a legacy tool execution request if registered in fallback map.
 */
export async function executeLegacyFallback(name: string, args: any): Promise<any | null> {
  const handler = legacyFallbackMap[name];
  if (!handler) return null;
  return await handler(args);
}

/**
 * Decide whether a CallTool request should be served by the legacy fallback map.
 *
 * A registered tool always wins. Several legacy keys share a name with a modern
 * tool but accept a different argument shape (for example `inspection_inspect`
 * reads a singular `url` while the registered tool takes a `urls` array, and the
 * analytics/sites/sitemaps shims hardcode `engine: "google"`). Consulting the
 * fallback map first would route those calls to a handler that silently drops or
 * misreads the caller's arguments.
 *
 * @param toolName - The requested tool name.
 * @param isRegistered - Whether a tool of that name is registered on the server.
 * @returns True when the legacy shim should handle the request.
 */
export function shouldUseLegacyFallback(toolName: string, isRegistered: boolean): boolean {
  if (isRegistered) return false;
  return Boolean(legacyFallbackMap[toolName]);
}
