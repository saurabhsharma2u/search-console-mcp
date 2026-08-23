---
title: "Authentication"
description: "Authentication for Google Search Console and Bing Webmaster Tools."
---

To use this MCP server, you must authenticate with the Google Search Console API. We recommend the **Secure Desktop Flow**, which uses your local machine's keychain and hardware-bound encryption to store tokens safely.

## 1. OAuth 2.0 Desktop Flow (Recommended)

This method allows you to log in with your Google account via a browser, just like any other desktop application.

### Security Features
- **System Keychain**: Tokens are stored in your OS's native credential manager (macOS Keychain, Windows Credential Manager, Linux Secret Service).
- **Hardware-Bound Encryption**: Fallback storage uses AES-256-GCM with a key derived from your unique machine ID. Tokens cannot be decrypted on other devices.
- **Multi-Account Support**: Easily switch between multiple Google accounts.

### How to Login

Run the following command in your terminal:

```bash
npx search-console-mcp setup
```

1.  A local secure server will start.
2.  Your browser will open to the Google Authorization page.
3.  Grant access to your Search Console data.
4.  The CLI will automatically fetch your email and securely store your credentials.

### Logout & Management

You can manage your sessions directly from the CLI:

```bash
# Logout of the default account
npx search-console-mcp logout

# Logout of a specific account by email
npx search-console-mcp logout user@gmail.com
```

---

## 2. Service Account (Advanced / Headless)

For server-side environments or automated tasks where interactive login isn't possible, you can use a Google Cloud Service Account.

### Step 1: Create a Service Account
1.  Go to the [Google Cloud Console](https://console.cloud.google.com/).
2.  Create a new project (or select an existing one).
3.  Go to **IAM & Admin** > **Service Accounts**.
4.  Click **Create Service Account**.
5.  Give it a name (e.g., `seo-agent`) and click **Create and Continue**.
6.  Click **Done**.

### Step 2: Generate a JSON Key
1.  In the Service Accounts list, click on your new account.
2.  Select the **Keys** tab.
3.  Click **Add Key** > **Create new key**.
4.  Select **JSON** and click **Create**.
5.  A JSON file will download to your computer. **Keep this file secure.**

### Step 3: Grant Access in Search Console
You must give your Service Account permission to see your data:
1.  Open the [Google Search Console](https://search.google.com/search-console).
2.  Go to **Settings** > **Users and permissions**.
3.  Click **Add User**.
4.  Enter the **Service Account Email** (e.g., `seo-agent@your-project.iam.gserviceaccount.com`).
5.  Select Permissions (Full or Restricted) and click **Add**.

### Step 4: Configure the Server
Set the `GOOGLE_APPLICATION_CREDENTIALS` environment variable to point to your key file:

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/your/key.json"
```

---

## 3. Bing Webmaster Tools (API Key)

To access Bing data, you simply need an API Key.

### Step 1: Get Your API Key
1.  Go to [Bing Webmaster Tools Settings](https://www.bing.com/webmasters/settings/api).
2.  Log in with your Microsoft account.
3.  Click **Generate API Key**.
4.  Copy the key.

### Step 2: Configure the Client
You can configure the Bing API Key in your MCP client configuration using the `BING_API_KEY` environment variable.

**Example for Claude Desktop:**
```json
{
  "mcpServers": {
    "search-console": {
      "command": "npx",
      "args": ["-y", "search-console-mcp"],
      "env": {
        "BING_API_KEY": "YOUR_BING_API_KEY"
      }
    }
  }
}
```

### Setup Wizard support
Alternatively, run `npx search-console-mcp setup` and choose Option 3 to configure your Bing API Key interactively.

---

## 4. Google Analytics 4 (Service Account)

GA4 integration currently requires a Service Account for the most reliable connection.

### Step 1: Automated Setup

Run the setup wizard with the GA4 flag:

```bash
npx search-console-mcp setup --engine=ga4
```

### Step 2: Granting Property Access

Just like Search Console, you must add your Service Account email to your GA4 property:
1.  Open [Google Analytics](https://analytics.google.com/).
2.  Go to **Admin** > **Property Settings** > **Property Access Management**.
3.  Click the blue **+** button > **Add users**.
4.  Enter the **Service Account Email**.
5.  Select the **Viewer** role (minimum) and click **Add**.

---

## 5. Google AdSense (OAuth)

The AdSense Management API supports **user-authorized OAuth 2.0 only** — service accounts are not accepted.

### Step 1: Automated Setup

Run the setup wizard with the AdSense flag:

```bash
npx search-console-mcp setup --engine=adsense
```

### Step 2: Consent & Account Selection

1.  Approve the read-only `adsense.readonly` scope in the browser window.
2.  If your Google account has multiple publisher accounts, select the one to connect.
3.  Setup runs a live validation query before saving — you'll see **Connection successful!** when done.

<Info>
  Enabling AdSense requires this separate consent step; your existing GSC, Bing, and GA4 configuration is never touched until you opt in.
</Info>

Full parameter reference: [Google AdSense Tools](/tools/adsense).

---

## 6. PageSpeed Insights (Optional API Key)

PageSpeed tools (`pagespeed_analyze`, `pagespeed_core_web_vitals`, `analytics_pagespeed_correlation`) work **without any configuration** using Google's free tier.

For heavy usage (batch audits, automated monitoring), you can provide an API key to increase quotas.

| Scenario | Daily Limit | Rate Limit |
|---|---|---|
| No API key (default) | ~100 queries/day | ~1 query/sec |
| With API key | 25,000 queries/day | ~4 queries/sec |

### Step 1: Create an API Key
1.  Go to the [Google Cloud Console — Credentials](https://console.cloud.google.com/apis/credentials).
2.  Click **Create Credentials** > **API key**.
3.  Copy the generated key.

### Step 2: Enable the API
1.  In the same GCP project, go to **APIs & Services** > **Library**.
2.  Search for **PageSpeed Insights API**.
3.  Click **Enable**.

### Step 3: Configure
Set the `PAGESPEED_API_KEY` environment variable in your MCP client or `.env` file:

```bash
export PAGESPEED_API_KEY="your-api-key-here"
```

<Tip>
  This key is optional. Without it, all PageSpeed tools still work — just at lower rate limits.
</Tip>

---

## What's Next?

Once you're authenticated, you can manage your accounts and connect additional ones:

- [Managing Accounts](/getting-started/accounts) — List, remove, and restrict accounts from the CLI.
- [Multi-Account Support](/getting-started/multi-account) — Connect multiple Google and Bing accounts and let the server pick the right one automatically.
