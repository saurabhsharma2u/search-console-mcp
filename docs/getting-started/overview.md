---
title: "Overview"
---

# Search Console MCP

**Search Console MCP connects your Google Search Console, Bing Webmaster Tools, Google Analytics 4, and Google AdSense accounts to AI assistants like Claude, so you can ask questions about your site's traffic, rankings, and revenue instead of exporting spreadsheets.**

It's an open-source tool built by [Saurabh Sharma](https://github.com/saurabhsharma2u) for site owners, SEO professionals, and developers who want their AI agent to read their site performance data directly.

## What it does

You connect your Google and Bing accounts once. After that, your AI agent can pull reports, detect traffic anomalies, find keyword opportunities, and check ad revenue — all through natural-language requests instead of manual dashboard exports.

## Permissions we request

| Access | Scope | What it's used for |
| --- | --- | --- |
| Google Search Console | `webmasters.readonly` | Read search performance, indexing status, and sitemap data |
| Google Analytics 4 | `analytics.readonly` | Read traffic and engagement reports |
| Google AdSense | `adsense.readonly` | Read ad revenue and performance reports |
| Bing Webmaster Tools | API key (not OAuth) | Read search performance data from Bing |

**All access is read-only.** Search Console MCP never modifies, deletes, or shares your data. Nothing is sent to third-party servers — the tool runs locally on your own machine and talks directly to Google's and Microsoft's APIs using your own credentials.

## Who this is for

- **Indie hackers & founders** automating weekly SEO reviews
- **SEO professionals** investigating traffic drops or ranking changes across many properties
- **Developers** building AI agents that need reliable site performance data

## Data & privacy

- Credentials are stored locally on your device (OS keychain where available), never on our servers — we don't operate any servers that see your data
- You can revoke access at any time from your [Google Account permissions page](https://myaccount.google.com/permissions)
- Read our full Privacy Policy and browse the [source code](https://github.com/saurabhsharma2u/search-console-mcp)

## Questions or issues

Open an issue on [GitHub](https://github.com/saurabhsharma2u/search-console-mcp/issues) or reach out at \[your support email/contact link\].

---

[Get Started →](/getting-started/installation) · [View Documentation →](/docs) · [View on GitHub →](https://github.com/saurabhsharma2u/search-console-mcp)