/**
 * Documentation barrel export for Bing
 */
export { dimensionsDocs } from './dimensions.js';
export { filtersDocs } from './filters.js';
export { searchTypesDocs } from './search-types.js';
export { patternsDocs } from './patterns.js';
export { algorithmUpdatesDocs } from './algorithm-updates.js';

export const bingApiDocs = `
# Bing Webmaster Tools API Documentation

The Bing Webmaster Tools API allows you to manage your sites on Bing and get search performance data.

## Authentication
Authentication is handled via an **API Key**. 
You can get your API key from the [Bing Webmaster Tools Settings](https://www.bing.com/webmasters/settings/api).

## Tools

### \`bing_sites_list\`
Lists all sites verified in your Bing account.

### \`bing_sites_health\`
Runs a multi-factor health check (performance, sitemaps, crawl issues) on your Bing sites.

### \`bing_analytics_query\` / \`bing_get_top_queries\`
Returns top search queries for a site.

### \`bing_analytics_page\` / \`bing_get_top_pages\`
Returns top performing pages for a site.

### \`bing_analytics_page_query\`
Returns query performance data for a specific page.

### \`bing_analytics_query_page\`
Returns combined query and page performance stats for a site.

### \`bing_rank_traffic_stats\`
Returns historical rank and traffic statistics for a site.

### \`bing_opportunity_finder\`
Identifies "low-hanging fruit" keywords on Bing (positions 5-20 with high potential).

### \`bing_seo_recommendations\`
Provides prioritized SEO insights (cannibalization, low CTR, new ranking opportunities) for Bing.

### \`bing_url_info\`
Get detailed indexing and crawl information for a URL in Bing. Similar to Google's URL Inspection.

### \`bing_link_counts\`
Returns inbound link counts for a site.

### \`bing_keywords_stats\`
Get historical stats for a keyword in Bing.

### \`bing_related_keywords\`
Get related keywords and search volume from Bing.

### \`bing_crawl_issues\`
Lists crawl issues detected by Bing for a site.

### \`bing_crawl_stats\`
Returns crawl statistics (indexed pages, crawled pages, errors) for a site.

### \`bing_url_submission_quota\`
Get your daily URL submission quota and remaining balance.

### \`bing_url_submit\`
Submit a single URL to Bing for faster indexing.

### \`bing_url_submit_batch\`
Submit up to 500 URLs in a single request.

### \`bing_sitemaps_list\`
Lists all sitemaps submitted for a specific site.

### \`bing_sitemaps_submit\`
Submits a new sitemap URL to Bing.

### \`bing_analytics_detect_anomalies\`
Detects sharp traffic drops or spikes in Bing performance data.

### \`bing_analytics_compare_periods\`
Compares Bing performance metrics between two date ranges (clicks, impressions, position).

### \`bing_analytics_drop_attribution\`
Analyzes traffic drops to attribute them to potential causes (device-specific issues, etc.).

### \`bing_analytics_time_series\`
Performs advanced time series analysis with smoothing and trend forecasting for Bing data.

`;

export const indexNowDocs = `
# IndexNow Documentation

IndexNow is a simple way for website owners to instantly inform search engines about recent content changes on their website.

## How it works
1. **Generate a Key**: Create a unique key (UUID) for your host.
2. **Host the Key**: Serve the key as a text file at the root of your host or a specific location.
3. **Submit URLs**: Use the \`bing_index_now\` tool to notify search engines of new, updated, or deleted URLs.

## Tool: \`bing_index_now\`
Arguments:
- \`host\`: The domain (e.g., \`www.example.com\`).
- \`key\`: Your generated IndexNow key. In tenant HTTP mode this is resolved from server-side tenant configuration and must not be sent by the MCP client.
- \`keyLocation\` (optional): The URL where the key is hosted if not at the root.
- \`urlList\`: An array of URLs that have changed.

For more information, visit [IndexNow.org](https://www.indexnow.org/).
`;
