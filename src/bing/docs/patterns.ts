/**
 * Bing Webmaster Tools - Common Patterns & Recipes
 * 
 * This documentation is exposed as an MCP resource for AI agents.
 */

export const patternsDocs = `# Bing Webmaster Tools - Common Patterns & Recipes

This guide shows common use cases and patterns for analyzing Bing Webmaster Tools data.

## Quick Reference

### Get Site Performance Overview
Use \`bing_rank_traffic_stats\` for high-level metrics (Clicks, Impressions, Position) over time:
\`\`\`
Tool: bing_rank_traffic_stats
Args: { "siteUrl": "https://example.com" }
\`\`\`

### Submit Content (IndexNow)
Instantly notify Bing of new content using IndexNow (preferred over sitemaps for speed):
\`\`\`
Tool: bing_index_now
Args: { 
  "host": "www.example.com",
  "urlList": ["https://www.example.com/new-page"]
}
\`\`\`

---

## Content Analysis

### Top Performing Queries
\`\`\`json
{
  "tool": "bing_analytics_query",
  "siteUrl": "https://example.com"
}
\`\`\`

### Top Performing Pages
\`\`\`json
{
  "tool": "bing_analytics_page",
  "siteUrl": "https://example.com"
}
\`\`\`

### Deep Dive: Queries for a Specific Page
Find out what a specific page ranks for:
\`\`\`json
{
  "tool": "bing_analytics_page_query",
  "siteUrl": "https://example.com",
  "pageUrl": "https://example.com/blog/my-post"
}
\`\`\`

---

## Diagnostics & Health

### Traffic Drop Analysis
If you see a sudden drop in traffic, use attribution to check for algorithm updates:
\`\`\`json
{
  "tool": "bing_analytics_drop_attribution",
  "siteUrl": "https://example.com",
  "days": 30
}
\`\`\`

### Check URL Indexing Status
Verify if a URL is indexed and see crawl issues:
\`\`\`json
{
  "tool": "bing_url_info",
  "siteUrl": "https://example.com",
  "url": "https://example.com/troublesome-page"
}
\`\`\`

### List Crawl Issues
\`\`\`json
{
  "tool": "bing_crawl_issues",
  "siteUrl": "https://example.com"
}
\`\`\`

---

## Advanced Time Series

### Forecasting Traffic
Predict future clicks based on historical trends:
\`\`\`json
{
  "tool": "bing_analytics_time_series",
  "siteUrl": "https://example.com",
  "days": 90,
  "forecastDays": 30,
  "granularity": "weekly"
}
\`\`\`
`;

export default patternsDocs;
