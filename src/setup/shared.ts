import { existsSync, readFileSync, mkdirSync, writeFileSync, chmodSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { colors, log, printError, printInfo, printStatusLine, printSuccess } from '../utils/ui.js';
import { prompts, withSpinner } from '../utils/prompts.js';
import {
    validateKeyFilePath, parseServiceAccountKey, parseServiceAccountJson,
    ServiceAccountKey,
} from '../utils/validation.js';
import { loadConfig, saveConfig, isServiceAccountKeyMissing } from '../common/auth/config.js';

// stderr message helpers now live in utils/ui.ts; re-exported here so
// existing setup flows keep their import paths.
export { log, printSuccess, printError, printInfo };

/**
 * Shared helpers for setup flows. All UI output goes to stderr —
 * stdout belongs to machine-readable output (MCP stdio / --status).
 */

const pkgVersion = (() => {
    try {
        const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../package.json');
        return JSON.parse(readFileSync(pkgPath, 'utf8')).version || '';
    } catch {
        return '';
    }
})();

/**
 * Branded banner: wordmark + tagline (option B).
 * The tagline does real work — the product name alone undersells the
 * Bing/GA4/AdSense scope to every first-time user.
 */
export function printBanner() {
    log('');
    log(`  ${colors.bold}${colors.cyan}⌗ search-console-mcp${colors.reset}`);
    log(`  ${colors.dim}One MCP server · GSC + Bing + GA4 + AdSense${colors.reset}`);
    log(`  ${colors.dim}setup${pkgVersion ? ` · v${pkgVersion}` : ''}${colors.reset}`);
    log('');
}

export function printStep(num: number, text: string) {
    log(`\n${colors.bold}${colors.cyan}Step ${num}${colors.reset} ${colors.dim}─${colors.reset} ${colors.bold}${text}${colors.reset}\n`);
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
    // Shallow-copy with a derived flag so stale SA paths surface as
    // "key file missing" instead of a false "connected". Copies avoid
    // mutating the cached config objects.
    const withKeyFlag = <T extends { serviceAccountPath?: string }>(a: T) => ({
        ...a,
        keyFileMissing: isServiceAccountKeyMissing(a as any),
    });
    return {
        googleAccounts: accounts.filter(a => a.engine === 'google').map(withKeyFlag),
        bingAccounts: accounts.filter(a => a.engine === 'bing').map(withKeyFlag),
        ga4Accounts: accounts.filter(a => a.engine === 'ga4').map(withKeyFlag),
        adsenseAccounts: accounts.filter(a => a.engine === 'adsense').map(withKeyFlag),
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

/**
 * Compact one-line connection summary (replaces the old multi-line status list —
 * per-platform state now lives in the menu itself via colored dots).
 */
export function printSummaryLine(status: ConfigStatus, total = 5) {
    const connected = [
        status.googleAccounts.length > 0,
        status.ga4Accounts.length > 0,
        status.bingAccounts.length > 0 || status.legacyBing,
        status.adsenseAccounts.length > 0,
        status.pagespeedApiKey,
    ].filter(Boolean).length;

    if (connected === 0) return;

    log(`${colors.dim}${connected} of ${total} integrations connected${colors.reset}\n`);
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
    const expandedPath = resolve(path.trim().replace(/\0/g, '').replace(/^~(?=$|\/)/, homedir()));
    const { key, error } = parseServiceAccountKey(expandedPath);
    if (error || !key) {
        printError(error || 'Invalid service account key.');
        return null;
    }
    return key;
}

/**
 * Unified service account key acquisition.
 *
 * NOTE: The "paste JSON" option is intentionally hidden — terminal multiline
 * paste doesn't survive single-line input fields (clack aborts on newlines).
 * parseServiceAccountJson() + persistPastedKey() below are kept dormant for
 * when we support multiline capture. Re-enable by restoring the select:
 *
 *   const method = await prompts.select('How would you like to provide the key?', [
 *     { value: 'path', label: 'Enter a file path' },
 *     { value: 'paste', label: 'Paste the JSON content' },
 *   ]);
 *
 * Returns null if the user gives up.
 */
export async function acquireServiceAccountKey(): Promise<{ key: ServiceAccountKey; path: string } | null> {
    while (true) {
        let result: { key: ServiceAccountKey; path: string } | null = null;
        try {
            const keyPath = await prompts.text('Enter the path to your JSON key file:', {
                validate: validateKeyFilePath,
            });
            const fullPath = resolve(keyPath.trim().replace(/\0/g, '').replace(/^~(?=$|\/)/, homedir()));
            const { key, error } = parseServiceAccountKey(fullPath);
            if (error || !key) {
                printError(error || 'Invalid service account key.');
            } else {
                result = { key, path: fullPath };
            }
        } catch (e) {
            if ((e as any).name === 'CancelledError') throw e;
            throw e;
        }

        if (result) return result;

        const retry = await prompts.confirm('Would you like to try again?', true);
        if (!retry) return null;
    }
}

function persistPastedKey(key: ServiceAccountKey): string {
    const keysDir = join(homedir(), '.search-console-mcp', 'keys');
    mkdirSync(keysDir, { recursive: true });
    const hash = createHash('sha256').update(key.client_email).digest('hex').slice(0, 12);
    const keyPath = join(keysDir, `${hash}.json`);
    writeFileSync(keyPath, JSON.stringify(key, null, 2), { mode: 0o600 });
    chmodSync(keyPath, 0o600);
    return keyPath;
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
 * Human-friendly diagnostics output (stderr). The standalone
 * `search-console-mcp diagnostics` command still prints JSON for machines.
 */
export function renderDiagnostics(results: any[]) {
    if (results.length === 0) {
        printInfo('No diagnostic checks to run.');
        return;
    }

    const trunc = (s: string) => s.length > 64 ? s.slice(0, 61) + '...' : s;
    const rows = results.map(r => ({
        engine: String(r.engine).toUpperCase(),
        account: String(r.account),
        ok: r.status === 'ok',
        message: trunc(String(r.message)),
    }));

    const headers: Record<string, string> = { engine: 'ENGINE', account: 'ACCOUNT', status: 'STATUS', message: 'MESSAGE' };
    const widths: Record<string, number> = {
        engine: Math.max('ENGINE'.length, ...rows.map(r => r.engine.length)),
        account: Math.max('ACCOUNT'.length, ...rows.map(r => r.account.length)),
        status: 7,
        message: Math.max('MESSAGE'.length, ...rows.map(r => r.message.length)),
    };

    const border = colors.dim + '+' + Object.keys(widths).map(k => '─'.repeat(widths[k] + 2)).join('+') + '+' + colors.reset;
    const cell = (content: string, width: number) => ' ' + content.padEnd(width) + ' ';

    log('');
    log(border);
    log('|' + Object.keys(widths).map(k => cell(colors.bold + headers[k] + colors.reset, widths[k])).join('|') + '|');
    log(border);
    for (const r of rows) {
        const symbol = r.ok ? `${colors.green}✔${colors.reset}` : `${colors.red}✘${colors.reset}`;
        const statusCell = ' ' + symbol + ' '.repeat(widths.status);
        log('|'
            + cell(r.engine, widths.engine) + '|'
            + cell(r.account, widths.account) + '|'
            + statusCell + '|'
            + cell(r.ok ? r.message : colors.red + r.message + colors.reset, widths.message)
            + '|');
    }
    log(border);

    const failed = rows.filter(r => !r.ok).length;
    log('');
    if (failed > 0) {
        printError(`${failed} check(s) failed. Re-run the failing engine's setup or consult the docs.`);
    } else {
        printSuccess(`All ${rows.length} check(s) passed.`);
    }
}


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
