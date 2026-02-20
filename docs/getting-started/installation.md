---
title: "Installation"
description: "Get up and running in less than 2 minutes."
---

We designed `search-console-mcp` to work instantly with your favorite AI editor. No complex configuration required.

## Prerequisites

Before you begin, ensure you have the following:

1.  **Node.js 18 or higher**
    - Check your Node.js version by running: `node --version`
    - If you need to install Node.js, download it from [nodejs.org](https://nodejs.org/)
    - Or use a version manager like [nvm](https://github.com/nvm-sh/nvm) (recommended for managing multiple Node.js versions)

2.  **A verified Google Search Console property**
    - Go to [Google Search Console](https://search.google.com/search-console)
    - Add and verify ownership of your website
    - You need at least "Restricted" level access to view data

3.  **A Google account with appropriate permissions**
    - Your Google account must be added as a user in Search Console
    - Go to Settings > Users and permissions to check your access level

## 🚀 One-Line Setup

Run this command in your terminal. It will authenticate you with Google and generate the configuration you need.

```bash
npx search-console-mcp setup
```

**What happens when you run this command:**

1.  The tool starts a temporary local server to handle the OAuth callback
2.  Your default web browser opens to the Google Authorization page
3.  You grant permission to access your Search Console data
4.  The CLI automatically:
    - Retrieves your email address
    - Creates secure credentials in your system's keychain
    - Generates and displays the exact configuration code for your MCP client
5.  The temporary server shuts down automatically

**After the setup completes:**
- Copy the displayed configuration code
- Paste it into your MCP client configuration file
- Restart your MCP client to load the new server

---

## Client Configuration

If you prefer to set it up manually, here are the instructions for the most popular clients.

### Claude Desktop

Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "search-console": {
      "command": "npx",
      "args": ["-y", "search-console-mcp"]
    }
  }
}
```

*That's it! No environment variables needed if you ran the setup command.*

### Cursor

1.  Open **Cursor Settings** (Cmd + ,).
2.  Navigate to **Features** > **MCP**.
3.  Click **+ Add New MCP Server**.
4.  Enter the following:
    *   **Name:** `Search Console`
    *   **Type:** `command`
    *   **Command:** `npx -y search-console-mcp`

<Tip>
  If you see an error about "command not found," try using the full path to your node executable or `npm` prefix.
</Tip>

### VS Code

You can configure the server specifically for your workspace using the standard MCP extension.

1.  **Option A: Config File**
    Create a file named `.vscode/mcp.json` and add:

    ```json
    {
        "servers": {
            "search-console": {
                "command": "npx",
                "args": [
                    "-y",
                    "search-console-mcp"
                ]
            }
        }
    }
    ```

2.  **Option B: Command Palette**
    *   Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`).
    *   Search for **"MCP: Add Server"**.
    *   Enter the command: `npx -y search-console-mcp`.
