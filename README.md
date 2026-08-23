<div align="center">

# 🔍 Search Console MCP

**Google Search Console + Bing Webmaster Tools + GA4 + AdSense — in one context window.**

Stop exporting CSVs. Start asking your AI agent questions about your site's traffic, rankings, and revenue.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://github.com/saurabhsharma2u/search-console-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/saurabhsharma2u/search-console-mcp/actions/workflows/ci.yml)
[![Stars](https://img.shields.io/github/stars/saurabhsharma2u/search-console-mcp?style=social)](https://github.com/saurabhsharma2u/search-console-mcp/stargazers)

<br/>

[![Download MCPB Bundle](https://img.shields.io/badge/📦%20Download%20.mcpb-One--Click%20Bundle-D97706?style=for-the-badge&logo=claude&logoColor=white)](https://github.com/saurabhsharma2u/search-console-mcp/releases/latest/download/search-console-mcp.mcpb)

[📚 Docs](https://searchconsolemcp.saurabh.app/) · [Quick Start](#-quick-start) · [Tools](#-tools) · [Backward Compatibility](https://searchconsolemcp.saurabh.app/concepts/backward-compatibility) · [Security](#-security)

</div>

---

## ⚡ What's New in v2.1.0

* 💰 **Google AdSense Integration**: Earnings reports, payments and account alerts via `setup --engine=adsense`. Enabling AdSense requires you to approve a separate `adsense.readonly` OAuth scope; your existing GSC, Bing, and GA4 configuration remains unchanged until you opt in.
* 🔐 **OAuth-only AdSense auth**: The AdSense Management API supports user OAuth only — setup now validates access live and rejects unsupported service-account configs with actionable guidance. Multi-account users get explicit publisher-account selection with full pagination (>100 accounts).
* 📊 **`adsense_report` upgrades**: Custom `startDate`/`endDate` now override preset `dateRange`s, plus a new `orderBy` parameter (`-ESTIMATED_EARNINGS`) for sorted revenue reports.
* 🧪 **End-to-end MCP test suite**: The built server binary is now tested over stdio and SSE exactly like an MCP host would drive it — handshake, tool schemas, error envelopes, and multi-account resource behavior (11 e2e tests wired into CI).

<details>
<summary><strong>What's New in v2.0.x</strong></summary>

* 📦 **MCPB One-Click Bundle Support (`.mcpb`)**: Drag and drop bundle installation for Claude Desktop.
* ⚡ **Parallel Fetch Engine (`engine: "all"`)**: Multi-engine queries fetch Google, Bing, and GA4 concurrently with **50%+ lower latency**.
* 🔄 **100% Backward Compatibility**: All ~96 legacy tool names continue to work seamlessly via our fallback router. [Read Backward Compatibility Guide →](https://searchconsolemcp.saurabh.app/concepts/backward-compatibility)

</details>

---

## Why this exists

Site data lives in four different silos. Answering one question —
*"did my ad revenue drop because of a traffic dip or a lower RPM?"*
— usually means logging into four dashboards, exporting four CSVs,
and doing VLOOKUPs by hand.

Search Console MCP puts **GSC, Bing, GA4, and AdSense** behind one
set of tools your AI agent can call directly, and does the analysis
(cannibalization, anomaly detection, revenue attribution) *before*
the data ever reaches your context window.

|              | Before                         | After                                           |
| ------------ | ------------------------------ | ------------------------------------------------ |
| **Data**     | 4 dashboards, manual exports   | 1 unified context                               |
| **Analysis** | Manual VLOOKUPs & pivot tables | Deterministic SEO + revenue math, server-side    |
| **Accounts** | Constant re-login              | 20+ accounts, auto-resolved per site            |
| **Insight**  | Raw rows, agent guesses        | Curated signals (opportunity scores, anomalies)  |

---

## ⚡ Quick Start

```bash
npx search-console-mcp setup
```

This opens your browser, authorizes your Google account, and stores your credentials securely (see [Security](#-security)). Then add it to your MCP client config (Claude Desktop, Cursor, Antigravity, etc.):

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

> **"Run `seo_audit` on my top pages: which have high search visibility but poor CTR?"**

<details>
<summary>More example prompts</summary>

- *"Run a full SEO health check (`site_health_check`), segmented by Brand vs Non-Brand."*
- *"Fetch my top 5 pages by impressions and run `pagespeed_analyze` — any correlation with declining rankings?"*
- *"Compare Google vs Bing performance for the last 30 days (`compare_engines`) — where is Bing winning?"*
- *"Submit my latest URLs to Google and IndexNow using `indexing_submit` with `method: "index_now"`."*

</details>

---

## 🔌 Connect your accounts

| Platform | Method | Setup |
|---|---|---|
| **Google Search Console** | OAuth (recommended) | `npx search-console-mcp setup` |
| **Google Search Console** | Service Account | Set `GOOGLE_APPLICATION_CREDENTIALS` — [details](#service-account-advanced) |
| **Bing Webmaster Tools** | API Key | `export BING_API_KEY="..."` — [get a key](https://www.bing.com/webmasters/settings/api) |
| **Google Analytics 4** | Service Account | `npx search-console-mcp setup --engine=ga4` |
| **Google AdSense** | OAuth (read-only) | `npx search-console-mcp setup --engine=adsense` |

Manage everything from the CLI:

```bash
npx search-console-mcp accounts list
npx search-console-mcp accounts add-site --account=you@company.com --site=example.com
npx search-console-mcp accounts remove --account=you@company.com
```

When your agent queries a site, the server auto-resolves which account owns it — no manual switching. [Multi-account docs →](https://searchconsolemcp.saurabh.app/getting-started/multi-account)

---

## 🖥️ Run tools from the CLI

Search Console MCP also exposes registered MCP tools as direct CLI commands. Use the `run` subcommand to list tools, inspect tool-specific arguments, and print results as JSON, CSV, or an ASCII table:

```bash
# List registered tools
npx search-console-mcp run --help

# Show options for one tool
npx search-console-mcp run analytics_query --help

# Run an SEO audit with JSON output
npx search-console-mcp run seo_audit --siteUrl=https://example.com --type=quick_wins

# Print array results as CSV or a table
npx search-console-mcp run analytics_query --siteUrl=https://example.com --startDate=2026-06-01 --endDate=2026-06-30 --dimensions=date,query --format=csv
npx search-console-mcp run sites_list --engine=all --format=table
```

<details>
<summary id="service-account-advanced">Service Account setup (for servers/automation)</summary>

1. Create a service account in the [Google Cloud Console](https://console.cloud.google.com/iam-admin/serviceaccounts)
2. Generate a JSON key
3. Add the service account email as a user in Search Console with "Full" or "Restricted" access
4. `export GOOGLE_APPLICATION_CREDENTIALS="/path/to/key.json"`

</details>

---

## 🛠 Tools (Fluent Domain Architecture)

Search Console MCP v2.0 features **7 Fluent Domain Tools** that handle all SEO, Analytics, Inspection, and Indexing operations cleanly:

| Fluent Tool | Parameters / Actions | Description |
|---|---|---|
| `sites_list` | `engine: "all" \| "google" \| "bing"` | Lists verified sites across search engines in parallel |
| `sites_manage` | `action: "add" \| "delete"`, `siteUrl`, `engine` | Adds or removes site properties |
| `accounts_manage` | `action: "list" \| "add_site" \| "remove"` | Configures multi-account profiles |
| `sitemaps_list` | `siteUrl`, `feedUrl`, `engine` | Fetches sitemap status and indexing state |
| `sitemaps_submit` | `siteUrl`, `feedUrl`, `engine` | Submits sitemaps to GSC & Bing |
| `sitemaps_delete` | `siteUrl`, `feedUrl`, `engine` | Removes sitemaps |
| `analytics_query` | `siteUrl`, `engine`, `dimensions`, `metrics` | Multi-engine search & GA4 analytics query |
| `analytics_compare` | `mode: "period_over_period" \| "trends" \| "drop_attribution"` | Analyzes period deltas, trend shifts, and drop causes |
| `analytics_anomalies`| `siteUrl`, `threshold` | Statistical detection of traffic spikes/drops |
| `inspection_inspect`| `siteUrl`, `urls`, `engine` | Google URL inspection & Bing URL info |
| `pagespeed_analyze` | `url`, `strategy`, `cwvOnly` | Core Web Vitals and PageSpeed Insights audits |
| `indexing_submit` | `urls`, `method: "standard" \| "index_now" \| "remove"` | Instantly indexes URLs via IndexNow or Google/Bing API |
| `indexing_status` | `siteUrl`, `type: "quota" \| "status"` | Checks remaining indexing quota & URL status |
| `seo_audit` | `type: "quick_wins" \| "striking_distance" \| "cannibalization" \| "low_hanging_fruit" \| "lost_queries" \| "recommendations" \| "brand_vs_nonbrand"` | Comprehensive automated SEO audits |
| `seo_keywords_research`| `keywords`, `type: "stats" \| "related" \| "traffic"` | Keyword volumes and related keyword stats |
| `site_health_check` | `siteUrl`, `level: "summary" \| "full" \| "crawl_issues"` | One-shot site performance & technical audit |
| `compare_engines` | `siteUrl` | Side-by-side Google vs Bing performance breakdown |

### Google AdSense Tools

| Tool | Parameters | Description |
|---|---|---|
| `adsense_accounts` | `mode: "configured" \| "discover"`, `accountId` | Lists configured or discoverable AdSense publisher accounts |
| `adsense_report` | `dateRange`, `startDate`, `endDate`, `dimensions`, `metrics`, `orderBy`, `rowLimit`, `accountId` | Earnings, impressions, clicks, CTR & RPM with dimension breakdowns. Custom dates override `dateRange`. |
| `adsense_payments_alerts` | `accountId` | Outstanding payments and account alerts (policy issues, payment holds) |

> **Note:** `accountId` refers to the configured profile ID (e.g. `adsense_2`, as shown by `accounts_manage`), not a publisher resource name like `accounts/pub-123`.

<details>
<summary><strong>Backward Compatibility Notice (96+ Legacy Tools)</strong></summary>

All legacy tool names (`bing_sites_list`, `seo_quick_wins`, `sitemaps_get`, `bing_index_now`, `indexing_submit_url`, `opportunity_matrix`, etc.) continue to work transparently via our fallback router.

Read our complete [Backward Compatibility & Migration Guide →](https://searchconsolemcp.saurabh.app/concepts/backward-compatibility)

</details>

---

## 🔒 Security

- **OS keychain first** — tokens stored in macOS Keychain, Windows Credential Manager, or Linux Secret Service
- **AES-256-GCM fallback** — encrypted with a key derived from your machine's hardware ID; a stolen file is useless on another device
- **Minimal storage** — only `refresh_token` and `expiry_date` are persisted, at `mode 600`
- **Silent refresh** — tokens renew automatically in the background

---

## License

[MIT](./LICENSE) · [Contributing guide](./CONTRIBUTING.md) · [Backward Compatibility Guide](https://searchconsolemcp.saurabh.app/concepts/backward-compatibility)

<div align="center">

If this saves you a spreadsheet, consider ⭐ starring the repo.

</div>