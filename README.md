
# Google Search Console MCP Server

A Model Context Protocol (MCP) server that transforms how you interact with Google Search Console. Stop exporting CSVs and start asking questions.

[📚 View Documentation](https://searchconsolemcp.mintlify.app/)

---

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://github.com/saurabhsharma2u/search-console-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/saurabhsharma2u/search-console-mcp/actions/workflows/ci.yml)

## Why use this?

### ❌ The Old Way
1.  Open Search Console -> Performance Tab
2.  Filter by "Last 28 days"
3.  Export to CSV
4.  Open in Excel/Sheets
5.  Create a filter for "Position > 10" AND "Impressions > 1000"
6.  Analyze manually to find opportunities

### ✅ The New Way
**Just ask:**
> "Find low-hanging fruit keywords (positions 11-20) with high impressions that I should optimize."

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

---

## 📊 Real Output Examples

### Example: `analytics_query` Response
```json
{
  "rows": [
    {
      "keys": ["https://example.com/page1"],
      "clicks": 1250,
      "impressions": 45000,
      "ctr": 2.78,
      "position": 8.5
    },
    {
      "keys": ["https://example.com/page2"],
      "clicks": 890,
      "impressions": 32000,
      "ctr": 2.78,
      "position": 12.3
    }
  ],
  "totals": {
    "clicks": 2140,
    "impressions": 77000,
    "ctr": 2.78,
    "position": 10.4
  },
  "rowCount": 2
}
```

### Example: `seo_low_hanging_fruit` Response
```json
{
  "opportunities": [
    {
      "query": "best hiking trails near me",
      "page": "https://example.com/hiking-guide",
      "position": 15.2,
      "impressions": 5200,
      "clicks": 156,
      "ctr": 3.0,
      "recommendation": "Optimize title tag and meta description for 'best hiking trails'"
    },
    {
      "query": "beginner guitar songs",
      "page": "https://example.com/beginner-songs",
      "position": 18.7,
      "impressions": 8900,
      "clicks": 178,
      "ctr": 2.0,
      "recommendation": "Add more detailed song tabs to improve CTR"
    }
  ],
  "totalOpportunities": 2
}
```

### Example: `sites_health_check` Response
```json
{
  "site": "https://example.com/",
  "health": {
    "overall": "healthy",
    "warnings": 2,
    "errors": 0
  },
  "sitemapStatus": {
    "submitted": 5,
    "indexed": 4,
    "issues": ["https://example.com/old-page"]
  },
  "trafficChange": {
    "period": "week_over_week",
    "changePercent": -12.5,
    "status": "declining"
  }
}
```

### Example: `inspection_inspect` Response
```json
{
  "inspectionResult": {
    "inspectionUrl": "https://example.com/page",
    "linkingCount": 150,
    "indexingState": "INDEXING_ALLOWED",
    "coverageStates": ["URL_IS_ON_WEB"],
    "mobileUsability": {
      "isMobileUsable": true,
      "issues": []
    },
    "richResultsResult": {
      "detectedItems": ["Article", "BreadcrumbList"],
      "notDetectedItems": ["FAQ"]
    }
  }
}
```

---

## 🔐 Authentication (Desktop Flow)

Search Console MCP uses a **Secure Desktop Flow**. This provides high-security, professional grade authentication for your Google account:
- **Multi-Account Support**: Automatically detects and stores separate tokens for different Google accounts based on your email.
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


## 🛡️ Fort Knox Security

This MCP server implements a multi-layered security architecture:

*   **Keychain Integration**: Primarily uses the **macOS Keychain**, **Windows Credential Manager**, or **libsecret (Linux)** to store tokens.
*   **Hardware-Bound Vault**: Fallback tokens are stored in `~/.search-console-mcp-tokens.enc` and encrypted with **AES-256-GCM**.
*   **Machine Fingerprinting**: The encryption key is derived from your unique hardware UUID and OS user. The encrypted file is useless if moved to another machine.
*   **Minimalist Storage**: Only the `refresh_token` and `expiry_date` are stored.
*   **Strict Unix Permissions**: The fallback file is created with `mode 600` (read/write only by your user).

---

## Tools Reference

### Analytics
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



## 🔧 Troubleshooting

### Common OAuth Errors

#### `Error: Invalid client credentials`
**Cause:** The OAuth token has been revoked or expired.
**Solution:** Run `npx search-console-mcp logout` to clear credentials, then `npx search-console-mcp setup` to re-authenticate.

#### `Error: Access denied - insufficient permissions`
**Cause:** Your Google account doesn't have access to the Search Console property.
**Solution:** 
1. Go to [Google Search Console](https://searchconsole.google.com/)
2. Ensure your account is added as a user with appropriate permissions (Full or Restricted) for the property

#### `Error: Token refresh failed`
**Cause:** The refresh token is invalid or the OAuth consent was revoked.
**Solution:** Run `npx search-console-mcp logout` and complete the setup flow again.

#### `Error: Could not find valid certification path to requested target`
**Cause:** Corporate firewall or proxy intercepting HTTPS traffic.
**Solution:** Configure your proxy settings or run from an unrestricted network.

#### `Error: Browser not found`
**Cause:** No default browser configured on the system.
**Solution:** Manually copy the auth URL and open it in your browser, then copy the redirect URL back to the terminal.

#### Multiple Account Issues
**Cause:** Tokens from multiple Google accounts are stored and the server picks the wrong one.
**Solution:** Use `npx search-console-mcp logout user@example.com` to remove specific account credentials.

### Need More Help?
- Check the [FAQ](https://searchconsolemcp.mintlify.app/faq)
- Open an [Issue](https://github.com/saurabhsharma2u/search-console-mcp/issues)
- Join our [Discord](https://discord.gg/searchconsolemcp)

---

## License

[MIT](LICENSE)
[Contributing](CONTRIBUTING.md)
