---
title: "Overview"
description: "What is search-console-mcp?"
---

**search-console-mcp** is an open-source implementation of the [Model Context Protocol](https://modelcontextprotocol.io) that gives AI agents direct, structured access to **Google Search Console (GSC)**, **Bing Webmaster Tools**, and **Google Analytics 4 (GA4)**.

Unlike simple API wrappers, this project focuses on providing **SEO Intelligence Tools**. Instead of just asking an agent to "look at my data," you can give it tools to "find quick wins," "detect traffic anomalies," or "submit URLs instantly."

## Key Capabilities (v2.0)

*   **Fluent Domain Architecture:** Streamlined into 7 core domain entry points (`sites_list`, `sitemaps_list`, `analytics_query`, `inspection_inspect`, `indexing_submit`, `seo_audit`, `site_health_check`).
*   **Parallel Multi-Engine Execution (`engine: "all"`):** Query Google, Bing, and GA4 simultaneously with **50%+ lower latency**.
*   **100% Backward Compatibility:** All ~96 legacy tool names continue working seamlessly via our Fallback Router. [Read Backward Compatibility Guide →](/concepts/backward-compatibility)
*   **Multi-Platform Support:** Manage sites, behavior data, and ad revenue for Google, Bing, GA4, and AdSense in one place.
*   **Advanced Analytics:** Multi-dimensional analysis, rolling averages, period-over-period comparisons, and drop attribution.
*   **SEO Insights:** Deterministic detection of cannibalization, Striking Distance keywords, and "Low-Hanging Fruit."
*   **Site Health Check:** Automated diagnostics across all your properties — performance trends, sitemap status, and anomaly detection in one call.
*   **Instant Indexing:** Use **IndexNow** to instantly notify Bing and other engines of content changes.
*   **Sitemap Control:** List, submit, and delete sitemaps.
*   **URL Inspection & PageSpeed:** Check indexing status on Google and Bing, and audit Core Web Vitals directly within your SEO workflow.

## The Problem

Working with SEO data in LLMs usually involves:
1.  Exporting CSVs.
2.  Uploading them to a chat window.
3.  Hoping the model calculates standard deviations or trends correctly.

## The Solution

With this MCP server, the agent has a "toolbox." When you ask "Why did my traffic drop?", the agent doesn't guess. It calls `analytics_anomalies` to check for statistical drops, `inspection_inspect` to check indexing, and `analytics_compare({ mode: "drop_attribution" })` to correlate with algorithm updates and GA4 behavior.

## Supported Clients

This server works with any MCP-compatible client, including:
*   [Claude Desktop](https://claude.ai/download)
*   [Cursor](https://cursor.com)
*   [Antigravity / AGY CLI](https://antigravity.google.com)
*   [LibreChat](https://librechat.ai)
*   Custom agent implementations using the MCP SDK.
