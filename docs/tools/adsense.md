---
title: "Google AdSense"
description: "Connect your AdSense revenue data so your AI agent can correlate earnings with search performance."
---

The **Google AdSense** integration closes the loop between traffic and money. Your AI agent can pull earnings, impressions, clicks, CTR, and RPM directly from AdSense and combine them with GSC/Bing/GA4 analysis — no dashboard hopping required.

## Core Capabilities

### Accounts

*   `adsense_accounts`: List configured publisher accounts, or discover every publisher ID your Google account can access (`mode: "discover"`).

### Reports

*   `adsense_report`: Earnings & performance reports with dimension breakdowns, metric selection, custom sort order, and row limits.

### Payments & Policy

*   `adsense_payments_alerts`: Outstanding payment balances plus active account alerts (policy issues, payment holds).

---

## `adsense_report` Parameters

| Parameter | Values | Notes |
|---|---|---|
| `dateRange` | `TODAY`, `YESTERDAY`, `THIS_WEEK`, `LAST_WEEK`, `THIS_MONTH`, `LAST_MONTH`, `LAST_7_DAYS`, `LAST_30_DAYS` | Default: `LAST_7_DAYS` |
| `startDate` / `endDate` | `YYYY-MM-DD` | Custom range — **overrides `dateRange`** when either is provided |
| `dimensions` | `DATE`, `WEEK`, `MONTH`, `DOMAIN_NAME`, `COUNTRY_NAME`, `PLATFORM_TYPE_NAME`, `AD_UNIT_ID`, `AD_UNIT_NAME`, `CUSTOM_CHANNEL_ID`, `CUSTOM_CHANNEL_NAME`, `PRODUCT_NAME`, `PRODUCT_CODE`, `URL_CHANNEL_ID` | Breakdown dimensions |
| `metrics` | `ESTIMATED_EARNINGS`, `PAGE_VIEWS`, `IMPRESSIONS`, `CLICKS`, `PAGE_VIEWS_CTR`, `PAGE_VIEWS_RPM`, `IMPRESSIONS_CTR`, `IMPRESSIONS_RPM` | Default: earnings, page views, impressions, clicks, RPM |
| `orderBy` | `+METRIC` ascending, `-METRIC` descending | e.g. `-ESTIMATED_EARNINGS` for top-earning first |
| `rowLimit` | up to `200` | Default: `100` |
| `accountId` | configured profile ID | See note below |

<Info>
  **accountId semantics:** `accountId` refers to the configured profile ID shown by `accounts_manage` (e.g. `adsense_2`) — not a publisher resource name like `accounts/pub-123`. With a single configured account you can omit it entirely.
</Info>

---

## Setup & Authentication

AdSense uses **user-authorized OAuth 2.0 only** — the AdSense Management API does not support service accounts.

1.  **Run Setup**: `npx search-console-mcp setup --engine=adsense`
2.  **Consent**: Approve the read-only `adsense.readonly` scope in the browser window.
3.  **Account Selection**: If your Google account has multiple publisher accounts, pick one from the list. Setup runs a live validation query before saving.

### Headless servers

The AdSense Management API does not support service accounts and config files are machine-encrypted, so use the export/import pair to move an OAuth grant to a server:

```bash
# On any machine with a browser (after setup):
npx search-console-mcp adsense-export

# On the headless server:
npx search-console-mcp adsense-import --token='...' --publisher-id='accounts/pub-...'
```

`adsense-import` validates the token live, auto-detects the publisher ID when omitted, and stores everything encrypted on the target machine. Over SSH, `setup --engine=adsense` also works directly — it prints the authorization URL plus `ssh -L 3000:localhost:3000` forwarding instructions when no browser is available.

<Info>
  **Existing configurations are untouched.** Enabling AdSense requires a separate consent step; GSC, Bing, and GA4 users never need to re-authenticate until they opt in.
</Info>

---

## MCP Resources & Prompts

The integration also registers native MCP resources and guided prompts:

*   `seo://adsense/accounts` — configured publisher accounts
*   `seo://adsense/payments` — live balances and alerts for every configured account, keyed by account ID
*   `adsense_earnings_review` — prompt walking your agent through daily trend, top domains, balance, and alerts
*   `adsense_monetization_audit` — prompt for finding underperforming ad units and geography/platform RPM gaps

---

## Example Prompts

> "How much did I earn from AdSense in the last 30 days, and which day was best?"

> "Break down my AdSense earnings by domain for this month. Which site drives the most revenue?"

> "List any active AdSense policy alerts or pending payments."

> "Which ad units have high impressions but low RPM? Use `adsense_monetization_audit`."
