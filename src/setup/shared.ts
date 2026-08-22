import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { colors, printBoxHeader, printStatusLine } from '../utils/ui.js';
import { prompts, withSpinner } from '../utils/prompts.js';
import { validateKeyFilePath, parseServiceAccountKey, ServiceAccountKey } from '../utils/validation.js';
import { loadConfig, saveConfig } from '../common/auth/config.js';

/**
 * Shared helpers for setup flows. All UI output goes to stderr —
 * stdout belongs to machine-readable output (MCP stdio / --status).
 */

export function log(text: string) {
    console.error(text);
}

export function printHeader() {
    printBoxHeader('Setup Wizard');
}

export function printStep(num: number, text: string) {
    log(`\n${colors.bold}${colors.cyan}Step ${num}${colors.reset} ${colors.dim}─${colors.reset} ${colors.bold}${text}${colors.reset}\n`);
}

export function printSuccess(text: string) {
    log(`${colors.green}✔${colors.reset} ${text}`);
}

export function printError(text: string) {
    log(`${colors.red}✘${colors.reset} ${colors.bold}${text}${colors.reset}`);
}

export function printInfo(text: string) {
    log(`${colors.blue}ℹ${colors.reset} ${colors.dim}${text}${colors.reset}`);
}

export interface ConfigStatus {
    googleAccounts: any[];
    bingAccounts: any[];
    ga4Accounts: any[];
    adsenseAccounts: any[];
    legacyBing: boolean;
    pagespeedApiKey: boolean;
}

export async function detectConfig(): Promise<ConfigStatus> {
    const config = await loadConfig();
    const accounts = Object.values(config.accounts);
    return {
        googleAccounts: accounts.filter(a => a.engine === 'google'),
        bingAccounts: accounts.filter(a => a.engine === 'bing'),
        ga4Accounts: accounts.filter(a => a.engine === 'ga4'),
        adsenseAccounts: accounts.filter(a => a.engine === 'adsense'),
        legacyBing: !!process.env.BING_API_KEY,
        pagespeedApiKey: !!process.env.PAGESPEED_API_KEY
    };
}

export function isAnyAccountConfigured(status: ConfigStatus): boolean {
    return status.googleAccounts.length > 0 ||
        status.bingAccounts.length > 0 ||
        status.ga4Accounts.length > 0 ||
        status.adsenseAccounts.length > 0 ||
        status.legacyBing;
}

export function printDetectionSummary(results: ConfigStatus) {
    const gCount = results.googleAccounts.length;
    const bCount = results.bingAccounts.length + (results.legacyBing ? 1 : 0);
    const ga4Count = results.ga4Accounts.length;
    const adsenseCount = results.adsenseAccounts.length;
    const hasPageSpeed = results.pagespeedApiKey;

    if (gCount === 0 && bCount === 0 && ga4Count === 0 && adsenseCount === 0 && !hasPageSpeed) return;

    log(`${colors.bold}${colors.dim}🔍 Connection Status${colors.reset}\n`);

    printStatusLine('Google Search Console', gCount > 0);
    printStatusLine('Google Analytics 4', ga4Count > 0);
    printStatusLine('Bing Webmaster Tools', bCount > 0);
    printStatusLine('Google AdSense', adsenseCount > 0);
    printStatusLine('PageSpeed Insights (API Key)', hasPageSpeed);
    log('');
}

/**
 * Validates a key file path interactively-friendly. Returns the parsed key
 * or null after printing a human-readable error.
 */
export function validateKeyFile(path: string): ServiceAccountKey | null {
    const pathError = validateKeyFilePath(path);
    if (pathError) {
        printError(pathError);
        return null;
    }
    const expandedPath = resolve(path.trim().replace(/\0/g, '').replace('~', homedir()));
    const { key, error } = parseServiceAccountKey(expandedPath);
    if (error || !key) {
        printError(error || 'Invalid service account key.');
        return null;
    }
    return key;
}

export async function testConnection(keyPath: string): Promise<boolean> {
    try {
        process.env.GOOGLE_APPLICATION_CREDENTIALS = resolve(keyPath.replace('~', homedir()));
        const { google } = await import('googleapis');
        const auth = new google.auth.GoogleAuth({
            scopes: ['https://www.googleapis.com/auth/webmasters.readonly']
        });
        await auth.getClient();
        return true;
    } catch (error) {
        printError(`Authentication failed: ${(error as Error).message}`);
        return false;
    }
}

export function showMcpConfigSnippet() {
    log('\nAdd this to your MCP client configuration:\n');
    log(JSON.stringify({
        mcpServers: {
            "search-console": {
                command: "npx",
                args: ["-y", "search-console-mcp"]
            }
        }
    }, null, 2));
}

export function resolveRepo(dirname: string): string {
    let repo = '';
    try {
        const url = execSync('git remote get-url origin', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        repo = url
            .replace(/^git@github\.com:|^https:\/\/github\.com\//, '')
            .replace(/\.git$/, '');
    } catch {
        // Fallback to package.json
        const pkgPath = resolve(dirname, '../package.json');
        if (existsSync(pkgPath)) {
            const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
            if (pkg.repository?.url) {
                repo = pkg.repository.url.replace(/.*github\.com\//, '').replace(/\.git$/, '');
            } else if (pkg.mcpName && pkg.mcpName.includes('/')) {
                repo = pkg.mcpName.replace(/^io\.github\./, '').split('/').slice(-2).join('/');
            }
        }
    }
    return repo;
}

const REPO_URL = 'https://github.com/saurabhsharma2u/search-console-mcp';

/**
 * GitHub star ask. Post-success only, non-blocking, shown once per machine.
 */
export async function supportProject(context?: string) {
    const config = await loadConfig();
    if (config.starAskShown) return;

    const valueDelivered = context ? `Your ${context} setup is live.` : 'Everything is set up.';
    const wantsToStar = await prompts.confirm(
        `${valueDelivered} If this saved you time, would you like to star the repo on GitHub? It helps others find it.`,
        true
    );

    if (wantsToStar) {
        try {
            const repo = resolveRepo(dirname(fileURLToPath(import.meta.url)));
            if (repo && /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo)) {
                execSync(`gh api -X PUT /user/starred/${repo}`, { stdio: 'ignore' });
                printSuccess('Thanks for your support! ⭐');
            } else {
                log(`🔗 ${REPO_URL}`);
            }
        } catch (error) {
            log(`🔗 ${REPO_URL}`);
        }
    }

    await markStarAskShown();
}

async function markStarAskShown() {
    try {
        const config = await loadConfig();
        config.starAskShown = true;
        await saveConfig(config);
    } catch {
        // Non-fatal: worst case we ask again next time.
    }
}
