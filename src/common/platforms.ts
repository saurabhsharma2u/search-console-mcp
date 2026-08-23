import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { loadConfig } from "./auth/config.js";

/**
 * Detect which search platforms are currently enabled based on environment
 * variables and credential files. This is evaluated at call time so it
 * always reflects the current state.
 */
export async function getEnabledPlatforms() {
    const hasServiceAccount = !!process.env.GOOGLE_APPLICATION_CREDENTIALS || (!!process.env.GOOGLE_CLIENT_EMAIL && !!process.env.GOOGLE_PRIVATE_KEY);
    const tokenPath = join(homedir(), '.search-console-mcp-tokens.enc');
    const configPath = join(homedir(), '.search-console-mcp-config.enc');
    const hasOAuthTokens = existsSync(tokenPath) || existsSync(configPath);
    const isGoogleEnabled = hasServiceAccount || hasOAuthTokens;
    const isBingEnabled = !!process.env.BING_API_KEY;

    // GA4 needs the config file (for service accounts or oauth)
    const isGA4Enabled = existsSync(configPath);

    // AdSense requires an explicitly configured adsense-engine account — the
    // config file alone says nothing about AdSense being set up.
    let isAdSenseEnabled = false;
    if (existsSync(configPath)) {
        const config = await loadConfig();
        isAdSenseEnabled = Object.values(config.accounts).some(a => a.engine === 'adsense');
    }

    return { isGoogleEnabled, isBingEnabled, isGA4Enabled, isAdSenseEnabled };
}
