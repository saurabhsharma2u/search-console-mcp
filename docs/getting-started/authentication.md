---
title: "Authentication"
description: "Setting up Google Cloud credentials for Search Console."
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

**Step-by-step process:**

1.  **Server Startup:** A local secure server starts on `http://127.0.0.1:8080` (or the next available port)
2.  **Browser Opens:** Your default web browser automatically opens to the Google OAuth consent screen
3.  **Authorization:** You select your Google account and grant permission to "See your Search Console data"
4.  **Redirect:** Google redirects back to the local server with an authorization code
5.  **Token Exchange:** The CLI exchanges the code for access and refresh tokens
6.  **Keychain Storage:** Tokens are securely stored in your OS's native credential manager:
    - **macOS:** Keychain (under "search-console-mcp" item)
    - **Windows:** Credential Manager (under Windows Credentials)
    - **Linux:** Secret Service (using libsecret)
7.  **Email Detection:** The CLI automatically fetches your Google account email
8.  **Success:** Configuration code is displayed for you to copy

**Note:** If your browser doesn't open automatically, the command will display a URL for you to copy and paste manually.

### Troubleshooting OAuth

**Problem: "Browser didn't open"**
- Solution: Copy the URL displayed in the terminal and paste it into your browser manually

**Problem: "Authentication failed"**
- Solution: Ensure you have at least "Restricted" permissions in Search Console
- Go to Search Console > Settings > Users and permissions

**Problem: "Access denied to site"**
- Solution: Your account doesn't have permission to access the site
- Contact the site owner to add your account with appropriate permissions

For more authentication issues, see our [Troubleshooting Guide](/troubleshooting).

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
