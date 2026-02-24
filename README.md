
# Search Console MCP

A Model Context Protocol (MCP) server that transforms how you interact with **Google Search Console**, **Bing Webmaster Tools**, and **Google Analytics 4**. Stop exporting CSVs and start asking questions.

[📚 View Documentation](https://searchconsolemcp.mintlify.app/)

---

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://github.com/saurabhsharma2u/search-console-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/saurabhsharma2u/search-console-mcp/actions/workflows/ci.yml)

## Why use this?

### ❌ The Old, Broken Way
*   **Data Silos**: Manually checking Google, then Bing, then GA4.
*   **Manual Correlation**: Exporting 3 different CSVs and using VLOOKUPs to see if your #1 ranking page actually converts.
*   **Switching Fatigue**: Logging in and out to manage multiple clients or properties.
*   **AI Context Limits**: Uploading giant spreadsheets that hit context limits and cause model hallucinations.

### ✅ The Search Console MCP Way
*   **Platform Synergy**: **GSC + Bing + GA4** in a single context window. Stop exporting, start analyzing.
*   **Deterministic Intelligence**: The server performs the complex SEO math (cannibalization, Z-score anomalies, striking distance) so your AI agent gets curated insights, not raw data piles.
*   **Cross-Platform ROI**: Use the **Opportunity Matrix** to prioritize keywords that have high search visibility (GSC) but poor on-site engagement (GA4).
*   **Zero-Config Multi-Account**: Connect 20+ accounts. The server automatically resolves the correct credentials for every site URL.

**One Server. Three Platforms. Infinite Accounts. Actionable Intelligence.**

---
## 🎯 Magic Prompts

Copy and paste these into your MCP client (Claude Desktop, etc.) to see the intelligence engine in action:

#### 🔍 The Traffic Detective
> "My traffic dropped this week compared to last. Use the anomaly detection and time-series tools to find exactly when the drop started and which pages are responsible."

#### 🎯 The "Striking Distance" Hunter
> "Find keywords for https://example.com where I'm ranking in positions 8-15 but have at least 1,000 impressions. These are my best opportunities for a quick traffic boost."

#### ⚔️ The Cannibalization Cleaner
> "Check for keyword cannibalization. Are there any queries where two or more of my pages are competing and splitting the traffic? Suggest which one should be the primary authority."

#### 📈 The SEO Opportunity Scoreboard
> "Analyze my top 50 keywords for the last 90 days. Rank them by a custom 'Opportunity Score' (Impressions / Position). Give me the top 5 specific pages to focus on."

#### 📊 The Executive Health Check
> "Run a full SEO health check for my site. Segment the results by Brand vs. Non-Brand and give me 3 high-impact actions for the upcoming week."

#### ⚡ The Speed vs. Ranking Correlator
> "Fetch the top 5 pages by impressions. For these pages, run a PageSpeed audit. Is there any correlation between low performance scores and recently declining positions?"

#### 🔀 Multi-Engine Comparison
> "Compare my performance between Google and Bing for the last 30 days. Which keywords are ranking better on Bing but have lower traffic on Google?"

#### 🎯 Bing Opportunity Finder
> "Show me keywords where I'm in the top 5 on Google but not ranking on Bing. These are my easy Bing wins."

#### ⚠️ Google Dependency Check
> "Am I too dependent on Google? Check my click share across both engines and flag any keywords where over 85% of traffic comes from Google."

#### 💰 The ROI Prioritizer (GSC + GA4)
> "Run an `opportunity_matrix` for my top 20 pages. Which high-visibility pages have the lowest engagement or conversion rates? These are my conversion optimization priorities."

---

## 🔐 Authentication (Desktop Flow)

Search Console MCP uses a **Secure Desktop Flow**. This provides high-security, professional grade authentication for your Google account:
- **Multi-Account Support**: Connect multiple Google and Bing accounts. The server automatically picks the right one for each site.
- **System Keychain Primary**: Tokens are stored in your OS's native credential manager (macOS Keychain, Windows Credential Manager, or Linux Secret Service).
- **AES-256-GCM Hardware-Bound Encryption**: Fallback storage is encrypted with AES-256-GCM using a key derived from your unique hardware machine ID. Tokens stolen from your machine cannot be decrypted on another computer.
- **Silent Background Refresh**: Tokens auto-refresh silently when they expire.

### 🚀 Step 1 — Initiate Login
Run the following command to start the authorization process:
```bash
npx search-console-mcp setup
```

The CLI will:
1. Briefly start a secure local server to handle the redirect.
2. Open your default web browser to the Google Authorization page.
3. Automatically fetch your email after authorization to label your credentials securely.

### 🔑 Step 2 — Logout & Management
To wipe your credentials from both the keychain and the disk:
```bash
# Logout of the default account
npx search-console-mcp logout

# Logout of a specific account
npx search-console-mcp logout user@gmail.com
```

---

## 🔑 Alternative: Service Account (Advanced)

For server-side environments or automated tasks where interactive login isn't possible, you can use a Google Cloud Service Account.

### Setup:
1.  **Create Service Account**: Go to the [Google Cloud Console](https://console.cloud.google.com/iam-admin/serviceaccounts) and create a service account.
2.  **Generate Key**: Click "Keys" > "Add Key" > "Create new key" (JSON). Download this file.
3.  **Share Access**: In Google Search Console, add the service account's email address (e.g., `account@project.iam.gserviceaccount.com`) as a user with at least "Full" or "Restricted" permissions.
4.  **Configure**: Point the server to your key file:
    ```bash
    export GOOGLE_APPLICATION_CREDENTIALS="/path/to/your/key.json"
    ```

---

## 🔑 Bing Webmaster Tools (API Key)

To access Bing data, you simply need an API Key.

### Setup:
1.  **Get Your API Key**: Go to [Bing Webmaster Tools Settings](https://www.bing.com/webmasters/settings/api).
2.  **Configure**: Set the API key in your environment:
    ```bash
    export BING_API_KEY="your-api-key-here"
    ```
3.  **IndexNow**: Bing tools also support **IndexNow** for instant URL submission.

---

## 📊 Google Analytics 4 (GA4)

Connect your GA4 properties to correlate ranking data with user behavior.

### Setup:
1.  **Run Setup**: `npx search-console-mcp setup --engine=ga4`
2.  **Auth Method**: Choose **Service Account** (JSON Key). This is the recommended method for server-side integrations.
    *   **Service Account**: You must add the service account email as a user in **GA4 Admin > Property Settings > Property Access Management**.
3.  **Property Selection**: The tool will automatically fetch all available GA4 properties for your account and let you select one from a list. You can also enter a Property ID manually if needed.

---

## 👥 Multi-Account Management

Manage multiple Google and Bing accounts from the CLI:

```bash
# List all connected accounts
npx search-console-mcp accounts list

# Remove an account
npx search-console-mcp accounts remove --account=marketing@company.com

# Add a site boundary to an account
npx search-console-mcp accounts add-site --account=marketing@company.com --site=example.com
```

When your AI agent queries a site, the server automatically resolves which account to use. [Learn more →](https://searchconsolemcp.mintlify.app/getting-started/multi-account)

---


## 🛡️ Fort Knox Security

This MCP server implements a multi-layered security architecture:

*   **Keychain Integration**: Primarily uses the **macOS Keychain**, **Windows Credential Manager**, or **libsecret (Linux)** to store tokens.
*   **Encrypted Config**: Account configuration is stored in `~/.search-console-mcp-config.enc` using **AES-256-GCM** encryption.
*   **Machine Fingerprinting**: The encryption key is derived from your unique hardware UUID and OS user. The encrypted file is useless if moved to another machine.
*   **Minimalist Storage**: Only the `refresh_token` and `expiry_date` are stored.
*   **Legacy Support**: Automatically detects credentials from older versions (tokens files, environment variables).
*   **Strict Unix Permissions**: Config files are created with `mode 600` (read/write only by your user).

---

## Tools Reference

### Google Analytics
| Tool | Description |
|------|-------------|
| `analytics_query` | Master tool for raw data. Supports `dimensions`, `filters`, `aggregationType` (byPage/byProperty), `dataState` (final/all), and `type` (web/image/news/discover). |
| `analytics_trends` | Detect trends (rising/falling) for specific queries or pages. |
| `analytics_anomalies` | Detect statistical anomalies in daily traffic. |
| `analytics_drop_attribution` | **[NEW]** Attribute traffic drops to mobile/desktop or correlate with known Google Algorithm Updates. |
| `analytics_time_series` | **[NEW]** Advanced time series with rolling averages, seasonality detection, and forecasting. |
| `analytics_compare_periods` | Compare two date ranges (e.g., WoW, MoM). |
| `seo_brand_vs_nonbrand` | **[NEW]** Analyze performance split between Brand vs Non-Brand traffic. |

### SEO Opportunities (Opinionated)
| Tool | Description |
|------|-------------|
| `seo_low_hanging_fruit` | Find keywords ranking in pos 5-20 with high impressions. |
| `seo_striking_distance` | **[NEW]** Find keywords ranking 8-15 (Quickest ROI wins). |
| `seo_low_ctr_opportunities` | **[NEW]** Find top ranking queries (pos 1-10) with poor CTR. |
| `seo_cannibalization` | **[Enhanced]** Detect pages competing for the same query with traffic conflict. |
| `seo_lost_queries` | **[NEW]** Identify queries that lost all traffic in the last 28 days. |

### SEO Primitives (Atoms for Agents)
These are low-level tools designed to be used by other AI agents to build complex logic.
| Tool | Description |
|------|-------------|
| `seo_primitive_ranking_bucket` | Categorize a position (e.g. "Top 3", "Page 1", "Unranked"). |
| `seo_primitive_traffic_delta` | Calculate absolute and % change between two numbers. |
| `seo_primitive_is_brand` | Check if a query matches a brand regex. |
| `seo_primitive_is_cannibalized` | Check if two pages are competing for the same query. |

### Sites & Sitemaps
| Tool | Description |
|------|-------------|
| `sites_list` | List all verified sites. |
| `sites_add` / `sites_delete` | Manage properties. |
| `sites_health_check` | **[NEW]** Run a health check on one or all sites. Checks WoW performance, sitemaps, and anomalies. |
| `sitemaps_list` / `sitemaps_submit` | Manage sitemaps. |

### Inspection & Validation
| Tool | Description |
|------|-------------|
| `inspection_inspect` | Google URL Inspection API (Index status, mobile usability). |
| `pagespeed_analyze` | Lighthouse scores & Core Web Vitals. |
| `schema_validate` | Validate Structured Data (JSON-LD). |

### Bing Webmaster Tools
| Tool | Description |
|------|-------------|
| `bing_sites_list` | List all verified sites in Bing. |
| `bing_analytics_query` | Query search performance from Bing. |
| `bing_opportunity_finder` | Find low-hanging fruit keywords on Bing. |
| `bing_seo_recommendations` | Get prioritized SEO insights for Bing. |
| `bing_url_info` | Detailed indexing and crawl info for a URL (Bing). |
| `bing_index_now` | **[NEW]** Instantly notify search engines of changes. |
| `bing_crawl_issues` | List crawl issues detected by Bing. |
| `bing_analytics_detect_anomalies` | Detect daily spikes or drops in Bing traffic. |
| `bing_analytics_time_series` | Advanced time series analysis for Bing. |
| `bing_sitemaps_list` / `bing_sitemaps_submit` | Manage sitemaps in Bing. |

### Google Analytics 4 (GA4)
| Tool | Description |
|------|-------------|
| `analytics_page_performance` | Detailed page metrics (sessions, engagement, views). |
| `analytics_traffic_sources` | Analyze sessions by Channel, Source, and Medium. |
| `analytics_organic_landing_pages` | Focused metrics for organic traffic landing pages. |
| `analytics_content_performance` | Analyze content performance by Content Group in GA4. |
| `analytics_conversion_funnel` | Top converting pages and events. |
| `analytics_user_behavior` | Device, Country, and Engagement breakdown. |
| `analytics_audience_segments` | New vs Returning, Age, and OS analysis. |
| `analytics_realtime` | Live active user data by page and location. |
| `analytics_ecommerce` | Product and revenue performance. |
| `analytics_pagespeed_correlation` | Correlate GA4 metrics with PageSpeed scores. |

### Cross-Platform Intelligence
| Tool | Description |
|------|-------------|
| `opportunity_matrix` | **[Flagship]** Prioritize SEO tasks by combining signals from GSC, GA4, and Bing. |
| `page_analysis` | Joint analysis of ranking (GSC) vs behavior (GA4) for pages. |
| `traffic_health_check` | Diagnose tracking gaps by comparing GSC clicks to GA4 organic sessions. |
| `brand_analysis` | Brand vs Non-Brand split across GSC, Bing, and GA4. |
| `compare_engines` | Compare keyword performance between Google and Bing. |



## License

[MIT](LICENSE)
[Contributing](CONTRIBUTING.md)
