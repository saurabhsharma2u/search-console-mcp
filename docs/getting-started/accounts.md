---
title: "Managing Accounts"
description: "View, remove, and update your connected accounts."
---

## View Your Accounts

See all connected accounts at a glance:

```bash
npx search-console-mcp accounts list
```

This shows each account's name, engine (Google, Bing, GA4, or AdSense), and which sites it has access to.

---

## Remove an Account

No longer need an account? Remove it by name:

```bash
npx search-console-mcp accounts remove --account=marketing@company.com
```

---

## Add a Site to an Account

By default, a connected account can access **all sites** on that credential. If you want to limit it to specific sites, add a site boundary:

```bash
npx search-console-mcp accounts add-site --account=marketing@company.com --site=example.com
```

You can also restrict sites during setup — the wizard will show you a list of available sites and let you pick which ones to include.

---

## Remove a Site from an Account

To remove a specific site from an account's access list:

```bash
npx search-console-mcp accounts remove --site=example.com
```
