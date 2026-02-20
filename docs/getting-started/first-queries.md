---
title: "First Queries"
description: "Testing your SEO agent for the first time."
---

Once the server is installed and authenticated, it's time to test it. Open your MCP-compatible client (like Claude Desktop) and start a conversation.

## Step 1: Verify Connection

Start by asking the agent what it can see. This verifies that the authentication is working.

**User Prompt:**
> "List the sites I have access to in Search Console."

**Expected Agent Response:**
> "I can see the following sites:
> 1. https://example.com
> 2. https://myblog.org"

**Real API Response Example:**
The agent calls the `sites_list` tool, which returns:
```json
{
  "siteSummaries": [
    {
      "siteUrl": "https://example.com",
      "permissionLevel": "siteOwner"
    },
    {
      "siteUrl": "https://myblog.org",
      "permissionLevel": "siteRestrictedUser"
    }
  ]
}
```

## Step 2: Get a Basic Performance Summary

Now, ask for a high-level overview of a specific site.

**User Prompt:**
> "Give me a summary of how https://example.com performed in the last 28 days compared to the period before."

The agent will likely use the `compare_periods` tool to give you a breakdown of clicks, impressions, and CTR changes.

**Real API Response Example:**
```json
{
  "rows": [
    {
      "keys": ["https://example.com"],
      "clicks": {
        "current": 12543,
        "previous": 9821,
        "change": 2722,
        "changePercent": 27.7
      },
      "impressions": {
        "current": 456789,
        "previous": 412345,
        "change": 44444,
        "changePercent": 10.8
      },
      "ctr": {
        "current": 2.75,
        "previous": 2.38,
        "change": 0.37,
        "changePercent": 15.5
      },
      "position": {
        "current": 8.5,
        "previous": 9.2,
        "change": 0.7,
        "changePercent": 7.6
      }
    }
  ]
}
```

## Step 3: Run an Intelligence Tool

This is where the power of the MCP shines. Instead of asking for data, ask for an analysis.

**User Prompt:**
> "Can you find any 'quick wins' for https://example.com? I'm looking for pages ranking just off the first page that have high impressions."

The agent will use the `seo_quick_wins` tool, which performs a deterministic filter to identify the best opportunities.

**Real API Response Example:**
```json
{
  "opportunities": [
    {
      "query": "best coffee shops nearby",
      "page": "https://example.com/coffee-shops-guide",
      "position": 11,
      "impressions": 5420,
      "clicks": 89,
      "ctr": 1.64,
      "recommendation": "Improve title and meta description to increase CTR"
    },
    {
      "query": "how to brew coffee at home",
      "page": "https://example.com/brewing-guide",
      "position": 13,
      "impressions": 3890,
      "clicks": 45,
      "ctr": 1.16,
      "recommendation": "Add schema markup and improve content freshness"
    }
  ],
  "totalOpportunities": 2,
  "potentialTrafficIncrease": "134 clicks/month"
}
```

## Step 4: Run a Site Health Check

Now try the health check tool to get an instant diagnostic across your properties.

**User Prompt:**
> "Run a health check on all my sites and tell me which ones need attention."

The agent will use the `sites_health_check` tool to check performance trends, sitemap status, and traffic anomalies — returning a status of healthy, warning, or critical for each site.

**Real API Response Example:**
```json
{
  "siteHealth": [
    {
      "siteUrl": "https://example.com",
      "status": "healthy",
      "checks": {
        "trafficTrend": "stable",
        "sitemapStatus": "valid",
        "anomalyStatus": "none"
      },
      "summary": "All checks passed. Traffic is stable with no anomalies detected."
    },
    {
      "siteUrl": "https://myblog.org",
      "status": "warning",
      "checks": {
        "trafficTrend": "declining",
        "sitemapStatus": "valid",
        "anomalyStatus": "detected"
      },
      "summary": "Traffic declined 15% WoW. 2 anomalies detected in the last 7 days.",
      "issues": [
        {
          "severity": "warning",
          "message": "Traffic down 15% compared to previous week",
          "recommendation": "Check for recent algorithm updates or technical issues"
        }
      ]
    }
  ]
}
```

## Tips for Success

*   **Specify the Site:** Always include the `siteUrl` in your prompt if you have access to multiple sites.
*   **Be Outcome-Oriented:** Instead of "show me my clicks," say "analyze why my clicks dropped."
*   **Context is King:** Tell the agent *what* the site is about to get better qualitative insights.
