<div align="center">

# 🔍 Search Console MCP

[![MCP Toplist](https://mcptoplist.com/badge/io.github.saurabhsharma2u%2Fsearch-console-mcp.svg)](https://mcptoplist.com/server/io.github.saurabhsharma2u%2Fsearch-console-mcp)

**Google Search Console + Bing Webmaster Tools + GA4 — in one context window.**

Stop exporting CSVs. Start asking your AI agent questions.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://github.com/saurabhsharma2u/search-console-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/saurabhsharma2u/search-console-mcp/actions/workflows/ci.yml)
[![Stars](https://img.shields.io/github/stars/saurabhsharma2u/search-console-mcp?style=social)](https://github.com/saurabhsharma2u/search-console-mcp/stargazers)

[📚 Docs](https://searchconsolemcp.saurabh.app/) · [Quick Start](#-quick-start) · [Tools](#-tools) · [Security](#-security)

</div>

---

## Why this exists

SEO data lives in three different silos. Answering one question — *"did my traffic drop because of a ranking loss or a UX issue?"* — usually means logging into three dashboards, exporting three CSVs, and doing VLOOKUPs by hand.

Search Console MCP puts **GSC, Bing, and GA4** behind one set of tools your AI agent can call directly, and does the SEO math (cannibalization, anomaly detection, opportunity scoring) *before* the data ever reaches your context window — so your agent gets insights, not spreadsheets.

| | Before | After |
|---|---|---|
| **Data** | 3 dashboards, manual exports | 1 unified context |
| **Analysis** | Manual VLOOKUPs & pivot tables | Deterministic SEO math, done server-side |
| **Accounts** | Constant re-login | 20+ accounts, auto-resolved per site |
| **Insight** | Raw rows, agent guesses | Curated signals (opportunity scores, anomalies) |

---

## ⚡ Quick Start

```bash
npx search-console-mcp setup
```

This opens your browser, authorizes your Google account, and stores your credentials securely (see [Security](#-security)). Then add it to your MCP client config (Claude Desktop, Cursor, etc.):

```json
{
  "mcpServers": {
    "search-console": {
      "command": "npx",
      "args": ["search-console-mcp"]
    }
  }
}
```

Restart your client — and try one of the prompts below.

---

## 💬 Try it

Paste these straight into your agent:

> **"My traffic dropped this week vs. last. Find exactly when it started and which pages are responsible."**

> **"Find keywords for example.com ranking positions 8–15 with 1,000+ impressions — my best quick wins."**

> **"Check for keyword cannibalization — are two of my pages competing for the same query?"**

> **"Run `opportunity_matrix` on my top 20 pages: which have high search visibility but poor on-site engagement?"**

<details>
<summary>More example prompts</summary>

- *"Run a full SEO health check, segmented by Brand vs Non-Brand, with 3 high-impact actions."*
- *"Fetch my top 5 pages by impressions and run a PageSpeed audit — any correlation with declining rankings?"*
- *"Compare Google vs Bing performance for the last 30 days — where is Bing winning?"*
- *"Am I too dependent on Google? Flag keywords where 85%+ of clicks come from one engine."*

</details>

---

## 🔌 Connect your accounts

| Platform | Method | Setup |
|---|---|---|
| **Google Search Console** | OAuth (recommended) | `npx search-console-mcp setup` |
| **Google Search Console** | Service Account | Set `GOOGLE_APPLICATION_CREDENTIALS` — [details](#service-account-advanced) |
| **Bing Webmaster Tools** | API Key | `export BING_API_KEY="..."` — [get a key](https://www.bing.com/webmasters/settings/api) |
| **Google Analytics 4** | Service Account | `npx search-console-mcp setup --engine=ga4` |

Manage everything from the CLI:

```bash
npx search-console-mcp accounts list
npx search-console-mcp accounts add-site --account=you@company.com --site=example.com
npx search-console-mcp accounts remove --account=you@company.com
```

When your agent queries a site, the server auto-resolves which account owns it — no manual switching. [Multi-account docs →](https://searchconsolemcp.mintlify.app/getting-started/multi-account)


## 🖥️ Run tools from the CLI

Search Console MCP also exposes registered MCP tools as direct CLI commands. Use the `run` subcommand to list tools, inspect tool-specific arguments, and print results as JSON, CSV, or an ASCII table:

```bash
# List registered tools
npx search-console-mcp run --help

# Show options for one tool
npx search-console-mcp run analytics_query --help

# Run a tool with JSON output (default)
npx search-console-mcp run seo_low_hanging_fruit --siteUrl=https://example.com --minImpressions=100

# Print array results as CSV or a table
npx search-console-mcp run analytics_query --siteUrl=https://example.com --startDate=2026-06-01 --endDate=2026-06-30 --dimensions=date,query --format=csv
npx search-console-mcp run sites_list --engine=google --format=table
```

CLI arguments are validated against the same Zod schemas used by MCP clients. String arguments are coerced for common schema types, including numbers, booleans, comma-separated arrays, and JSON arrays/objects.

<details>
<summary id="service-account-advanced">Service Account setup (for servers/automation)</summary>

1. Create a service account in the [Google Cloud Console](https://console.cloud.google.com/iam-admin/serviceaccounts)
2. Generate a JSON key
3. Add the service account email as a user in Search Console with "Full" or "Restricted" access
4. `export GOOGLE_APPLICATION_CREDENTIALS="/path/to/key.json"`

</details>

---

## 🛠 Tools

40+ tools across five categories. A few flagship ones:

| Tool | What it does |
|---|---|
| `opportunity_matrix` | Ranks pages by combining GSC visibility with GA4 engagement — where's the ROI? |
| `seo_striking_distance` | Keywords ranking 8–15 — your fastest wins |
| `seo_cannibalization` | Pages competing for the same query, with a recommended primary |
| `analytics_anomalies` | Statistical traffic drop/spike detection |
| `sites_health_check` | One-shot WoW performance + sitemap + anomaly check |
| `compare_engines` | Google vs Bing performance, side by side |

<details>
<summary><strong>Full tool reference (40+ tools)</strong></summary>

### Analytics & Trends
`analytics_query` · `analytics_trends` · `analytics_anomalies` · `analytics_drop_attribution` · `analytics_time_series` · `analytics_compare_periods` · `seo_brand_vs_nonbrand`

### SEO Opportunities
`seo_low_hanging_fruit` · `seo_striking_distance` · `seo_low_ctr_opportunities` · `seo_cannibalization` · `seo_lost_queries`

### SEO Primitives (building blocks for agent logic)
`seo_primitive_ranking_bucket` · `seo_primitive_traffic_delta` · `seo_primitive_is_brand` · `seo_primitive_is_cannibalized`

### Sites & Sitemaps
`sites_list` · `sites_add` · `sites_delete` · `sites_health_check` · `sitemaps_list` · `sitemaps_submit`

### Inspection & Validation
`inspection_inspect` · `pagespeed_analyze` · `schema_validate`

### URL Indexing
`indexing_submit_url` · `indexing_remove_url` · `indexing_status` · `indexing_batch_submit` · `bing_url_submission_quota`

### Bing Webmaster Tools
`bing_sites_list` · `bing_analytics_query` · `bing_opportunity_finder` · `bing_seo_recommendations` · `bing_url_info` · `bing_index_now` · `bing_crawl_issues` · `bing_analytics_detect_anomalies` · `bing_analytics_time_series` · `bing_seo_lost_queries` · `bing_brand_analysis` · `bing_sitemaps_list` · `bing_sitemaps_submit`

### Google Analytics 4
`analytics_page_performance` · `analytics_traffic_sources` · `analytics_organic_landing_pages` · `analytics_content_performance` · `analytics_conversion_funnel` · `analytics_user_behavior` · `analytics_audience_segments` · `analytics_realtime` · `analytics_ecommerce` · `analytics_pagespeed_correlation`

### Cross-Platform Intelligence
`opportunity_matrix` · `page_analysis` · `traffic_health_check` · `brand_analysis` · `compare_engines`

</details>

---

## 🔒 Security

- **OS keychain first** — tokens stored in macOS Keychain, Windows Credential Manager, or Linux Secret Service
- **AES-256-GCM fallback** — encrypted with a key derived from your machine's hardware ID; a stolen file is useless on another device
- **Minimal storage** — only `refresh_token` and `expiry_date` are persisted, at `mode 600`
- **Silent refresh** — tokens renew automatically in the background

---

## License

[MIT](./LICENSE) · [Contributing guide](./CONTRIBUTING.md)

<div align="center">

If this saves you a spreadsheet, consider ⭐ starring the repo.

</div>
