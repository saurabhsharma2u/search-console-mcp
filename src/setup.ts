#!/usr/bin/env node
import 'dotenv/config';
import { readFileSync, existsSync, statSync, writeFileSync } from 'fs';
import { resolve, dirname, extname, join } from 'path';
import { createInterface } from 'readline';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { startLocalFlow, getUserEmail, logout, getSearchConsoleClient, DEFAULT_CLIENT_ID, DEFAULT_CLIENT_SECRET, saveTokensForAccount } from './google/client.js';
import { getBingClient, BingClient } from './bing/client.js';
import { google } from 'googleapis';
import { loadConfig, updateAccount, AccountConfig } from './common/auth/config.js';
import { colors, printBoxHeader, printStatusLine } from './utils/ui.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const rl = createInterface({
    input: process.stdin,
    output: process.stdout
});

function ask(question: string): Promise<string> {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer.trim());
        });
    });
}

function findAccount(accounts: Record<string, AccountConfig>, predicate: (a: AccountConfig) => boolean): AccountConfig | undefined {
    for (const key in accounts) {
        if (Object.prototype.hasOwnProperty.call(accounts, key)) {
            const a = accounts[key];
            if (predicate(a)) {
                return a;
            }
        }
    }
    return undefined;
}


function printHeader() {
    printBoxHeader('Setup Wizard');
}

function printStep(num: number, text: string) {
    console.log(`\n${colors.bold}${colors.cyan}Step ${num}${colors.reset} ${colors.dim}─${colors.reset} ${colors.bold}${text}${colors.reset}\n`);
}

function printSuccess(text: string) {
    console.log(`${colors.green}✔${colors.reset} ${text}`);
}

function printError(text: string) {
    console.log(`${colors.red}✘${colors.reset} ${colors.bold}${text}${colors.reset}`);
}

function printInfo(text: string) {
    console.log(`${colors.blue}ℹ${colors.reset} ${colors.dim}${text}${colors.reset}`);
}

async function selectGA4Property(auth: any): Promise<string | undefined> {
    printInfo('Fetching available GA4 properties...');
    try {
        const admin = google.analyticsadmin('v1beta');
        const response = await admin.accountSummaries.list({ auth });

        const properties: { id: string, name: string }[] = [];
        for (const account of response.data.accountSummaries || []) {
            for (const prop of account.propertySummaries || []) {
                const id = prop.property?.replace('properties/', '') || '';
                properties.push({ id, name: prop.displayName || id });
            }
        }

        if (properties.length === 0) {
            printInfo('No GA4 properties found in this account.');
            console.log(`\n${colors.yellow}💡 Hint:${colors.reset} Ensure your Google account or Service Account has been added to the GA4 Property.`);
            console.log(`   Go to ${colors.cyan}GA4 Admin > Property Settings > Property Access Management${colors.reset} and add it.`);
            return await ask('\nEnter your GA4 Property ID manually (e.g. 123456789): ');
        }

        if (properties.length === 1) {
            printSuccess(`Found property: ${colors.bold}${properties[0].name}${colors.reset} (${properties[0].id})`);
            const useIt = await ask('Use it? (Y/n): ');
            if (useIt === '' || useIt.toLowerCase().startsWith('y')) {
                return properties[0].id;
            }
        } else {
            console.log(`\nFound ${properties.length} properties:`);
            properties.forEach((p, i) => {
                console.log(`${colors.cyan}[${i + 1}]${colors.reset} ${p.name} ${colors.dim}(${p.id})${colors.reset}`);
            });
            console.log(`${colors.cyan}[M]${colors.reset} Enter manually`);

            const choice = await ask(`\nSelect property (1-${properties.length}) or M: `);
            if (choice.toLowerCase() === 'm') {
                return await ask('Enter your GA4 Property ID manually: ');
            }
            const index = parseInt(choice) - 1;
            if (index >= 0 && index < properties.length) {
                return properties[index].id;
            }
        }
    } catch (e) {
        printInfo(`Note: Could not fetch property list automatically: ${(e as Error).message}`);
        return await ask('Enter your GA4 Property ID manually (e.g. 123456789): ');
    }
    return undefined;
}

async function detectConfig() {
    const config = await loadConfig();
    const accounts = Object.values(config.accounts);
    return {
        googleAccounts: accounts.filter(a => a.engine === 'google'),
        bingAccounts: accounts.filter(a => a.engine === 'bing'),
        ga4Accounts: accounts.filter(a => a.engine === 'ga4'),
        legacyBing: !!process.env.BING_API_KEY,
        pagespeedApiKey: !!process.env.PAGESPEED_API_KEY
    };
}

function printDetectionSummary(results: any) {
    const gCount = results.googleAccounts ? results.googleAccounts.length : 0;
    const bCount = (results.bingAccounts ? results.bingAccounts.length : 0) + (results.legacyBing ? 1 : 0);
    const ga4Count = results.ga4Accounts ? results.ga4Accounts.length : 0;
    const hasPageSpeed = !!results.pagespeedApiKey;

    if (gCount === 0 && bCount === 0 && ga4Count === 0 && !hasPageSpeed) return;

    console.log(`${colors.bold}${colors.dim}🔍 Connection Status${colors.reset}\n`);

    printStatusLine('Google Search Console', gCount > 0);
    printStatusLine('Google Analytics 4', ga4Count > 0);
    printStatusLine('Bing Webmaster Tools', bCount > 0);
    printStatusLine('PageSpeed Insights (API Key)', hasPageSpeed);
    console.log('');
}

interface ServiceAccountKey {
    type: string;
    project_id: string;
    private_key_id: string;
    private_key: string;
    client_email: string;
    client_id: string;
    auth_uri: string;
    token_uri: string;
}

export function validateKeyFile(path: string): ServiceAccountKey | null {
    try {
        const sanitizedPath = path.trim().replace(/\0/g, '');
        const expandedPath = sanitizedPath.startsWith('~')
            ? sanitizedPath.replace('~', homedir())
            : sanitizedPath;
        const fullPath = resolve(expandedPath);

        if (!existsSync(fullPath)) {
            printError(`File not found: ${fullPath}`);
            return null;
        }

        const stats = statSync(fullPath);
        if (!stats.isFile()) {
            printError(`Not a regular file: ${fullPath}`);
            return null;
        }

        if (extname(fullPath).toLowerCase() !== '.json') {
            printError(`Invalid file type. Please provide a .json file.`);
            return null;
        }

        const content = readFileSync(fullPath, 'utf-8');
        const key = JSON.parse(content) as ServiceAccountKey;

        const required = ['type', 'project_id', 'client_email', 'private_key'];
        const missing = required.filter(f => !(f in key));

        if (missing.length > 0) {
            printError(`Missing required fields: ${missing.join(', ')}`);
            return null;
        }

        if (key.type !== 'service_account') {
            printError(`Invalid key type: ${key.type}. Expected 'service_account'`);
            return null;
        }

        return key;
    } catch (error) {
        printError(`Failed to parse JSON: ${(error as Error).message}`);
        return null;
    }
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
    console.log('\nAdd this to your MCP client configuration:\n');
    console.log(JSON.stringify({
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

export async function login() {
    printHeader();
    printStep(1, 'Browser Authorization');

    console.log('Using Secure Desktop Flow.');
    console.log('Note: We will automatically fetch your email to support multiple accounts.');

    // Use centralized defaults
    const clientId = DEFAULT_CLIENT_ID;
    const clientSecret = DEFAULT_CLIENT_SECRET;

    console.log(`\n${colors.bold}💡 Google Indexing API Rules:${colors.reset}`);
    console.log(`   Officially, the Google Indexing API is only supported for pages containing`);
    console.log(`   ${colors.cyan}JobPosting${colors.reset} or ${colors.cyan}BroadcastEvent${colors.reset} structured data. Using it for other content`);
    console.log(`   types may result in submissions being ignored by Google.`);

    const authorizeIndexing = await ask('\nWould you like to also authorize Google Indexing API write scope? (y/N): ');
    const useIndexing = authorizeIndexing.toLowerCase().startsWith('y');
    const scopes = useIndexing
        ? [
            'https://www.googleapis.com/auth/webmasters.readonly',
            'https://www.googleapis.com/auth/indexing',
            'https://www.googleapis.com/auth/userinfo.email'
          ]
        : [
            'https://www.googleapis.com/auth/webmasters.readonly',
            'https://www.googleapis.com/auth/userinfo.email'
          ];

    try {
        const tokens = await startLocalFlow(clientId, clientSecret, scopes);

        printInfo('Fetching account information...');
        const email = await getUserEmail(tokens);

        console.log(`\nAuthorized as: ${colors.bold}${email}${colors.reset}`);

        // Fetch and select websites
        const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
        oauth2Client.setCredentials(tokens);
        const gClient = google.searchconsole({ version: 'v1', auth: oauth2Client });

        const siteResponse = await gClient.sites.list();
        const allSites = siteResponse.data?.siteEntry || [];

        let selectedWebsites: string[] | undefined;
        if (allSites.length > 0) {
            console.log(`\n${colors.bold}Available websites:${colors.reset}`);
            console.log(`  0. [All Sites] (Default)`);
            allSites.forEach((s: any, i: number) => {
                let displayUrl = (s.siteUrl || '').trim();
                if (displayUrl.startsWith('sc-domain:')) displayUrl = displayUrl.substring(10);
                else if (displayUrl.startsWith('sc-ptr:')) displayUrl = displayUrl.substring(7);
                console.log(`  ${i + 1}. ${displayUrl}`);
            });

            const selection = await ask(`\nSelect websites to authorize (comma-separated numbers, e.g. 1,2 or leave empty for all): `);
            if (selection && selection.trim() !== '0') {
                const indices = selection.split(',').map(s => parseInt(s.trim()) - 1).filter(idx => idx >= 0 && idx < allSites.length);
                if (indices.length > 0) {
                    selectedWebsites = indices.map(idx => allSites[idx].siteUrl!);
                }
            }
        }

        const alias = await ask(`Enter an alias for this account (optional, default: ${email}): `) || email;

        const config = await loadConfig();
        const existingAccount = findAccount(config.accounts, a => a.engine === 'google' && a.alias === alias);
        const accountId = existingAccount ? existingAccount.id : `google_${Date.now()}`;

        const account: AccountConfig = {
            ...(existingAccount || {}),
            id: accountId,
            engine: 'google',
            alias,
            websites: selectedWebsites
        };
        delete account.serviceAccountPath;

        await updateAccount(account);
        await saveTokensForAccount(account, tokens);

        printSuccess(`Successfully added account ${alias}!`);
        printInfo('Tokens are stored securely in your system keychain.');

        printStep(2, 'Configure your MCP client');
        showMcpConfigSnippet();

        await supportProject();
    } catch (error) {
        printError(`Authentication failed: ${(error as Error).message}`);
        console.log('\nTip: Ensure you are using a "Desktop Application" Client ID type in the Cloud Console.');
        process.exit(1);
    }
}

export async function runLogout() {
    printHeader();
    printInfo('Logging out and clearing secure credentials...');

    // Get email from CLI args if provided: search-console-mcp logout user@gmail.com
    const email = process.argv[3];

    try {
        await logout(email);
        if (email) {
            printSuccess(`Successfully logged out and removed credentials for ${email}.`);
        } else {
            printSuccess('Successfully logged out from default account.');
        }
    } catch (error) {
        printError(`Logout failed: ${(error as Error).message}`);
    }
}

async function setupServiceAccount() {
    printStep(1, 'Locate your service account JSON key file');

    console.log('If you don\'t have one yet, follow these steps:');
    console.log('  1. Go to https://console.cloud.google.com/iam-admin/serviceaccounts');
    console.log('  2. Create a new service account (or select existing)');
    console.log('  3. Click "Keys" > "Add Key" > "Create new key" > "JSON"');
    console.log('  4. Save the downloaded JSON file\n');

    const keyPath = await ask('Enter the path to your JSON key file: ');

    if (!keyPath) {
        printError('No credentials file provided.');
        process.exit(1);
    }

    const key = validateKeyFile(keyPath);
    if (!key) {
        process.exit(1);
    }

    printSuccess('JSON key file is valid!');
    const serviceAccountEmail = key.client_email;
    const credentialsPath = resolve(keyPath.replace('~', homedir()));

    printStep(2, 'Add service account to Google Search Console');
    console.log('You need to add this email as a user in Google Search Console:\n');
    console.log(`  📧 ${serviceAccountEmail}\n`);
    console.log('Steps:');
    console.log('  1. Go to https://search.google.com/search-console');
    console.log('  2. Select your property');
    console.log('  3. Click "Settings" > "Users and permissions" > "Add user"');
    console.log(`  4. Enter: ${serviceAccountEmail}`);
    console.log('  5. Set permission to "Full" or "Restricted" and click "Add"\n');

    await ask('Press Enter when you\'ve added the service account to Search Console...');

    printStep(3, 'Test connection');
    console.log('Testing authentication with Google APIs...');
    const connected = await testConnection(credentialsPath);

    if (connected) {
        printSuccess('Authentication successful!');
    } else {
        process.exit(1);
    }

    let selectedWebsites: string[] | undefined;
    try {
        const { google } = await import('googleapis');
        const auth = new google.auth.GoogleAuth({
            keyFilename: credentialsPath,
            scopes: ['https://www.googleapis.com/auth/webmasters.readonly']
        });
        const gClient = google.searchconsole({ version: 'v1', auth });
        const siteResponse = await gClient.sites.list();
        const allSites = siteResponse.data?.siteEntry || [];

        if (allSites.length > 0) {
            console.log(`\n${colors.bold}Available websites:${colors.reset}`);
            console.log(`  0. [All Sites] (Default)`);
            allSites.forEach((s: any, i: number) => {
                let displayUrl = (s.siteUrl || '').trim();
                if (displayUrl.startsWith('sc-domain:')) displayUrl = displayUrl.substring(10);
                else if (displayUrl.startsWith('sc-ptr:')) displayUrl = displayUrl.substring(7);
                console.log(`  ${i + 1}. ${displayUrl}`);
            });

            const selection = await ask(`\nSelect websites to authorize (comma-separated numbers, e.g. 1,2 or leave empty for all): `);
            if (selection && selection.trim() !== '0') {
                const indices = selection.split(',').map(s => parseInt(s.trim()) - 1).filter(idx => idx >= 0 && idx < allSites.length);
                if (indices.length > 0) {
                    selectedWebsites = indices.map(idx => allSites[idx].siteUrl!);
                }
            }
        }
    } catch (e) {
        // Silently skip if fails to fetch
    }

    const alias = await ask(`Enter an alias for this account (optional, default: ${serviceAccountEmail}): `) || serviceAccountEmail;

    const config = await loadConfig();
    const existingAccount = findAccount(config.accounts, a => a.engine === 'google' && a.alias === alias);
    const accountId = existingAccount ? existingAccount.id : `google_${Date.now()}`;

    const account: AccountConfig = {
        ...(existingAccount || {}),
        id: accountId,
        engine: 'google',
        alias,
        websites: selectedWebsites,
        serviceAccountPath: credentialsPath
    };
    await updateAccount(account);
    printSuccess(`Successfully added account ${alias}!`);

    printStep(4, 'Configure your MCP client');
    showMcpConfigSnippet();
    console.log('\n🎉 Setup complete! You can now use Search Console MCP.\n');

    await supportProject();
}

async function supportProject() {
    const answer = await ask('\nWould you like to star the repo on GitHub? (Y/n): ');
    if (answer === '' || answer.toLowerCase().startsWith('y')) {
        try {
            const repo = resolveRepo(__dirname);
            if (repo && /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo)) {
                execSync(`gh api -X PUT /user/starred/${repo}`, { stdio: 'ignore' });
                printSuccess('Thanks for your support! ⭐');
            } else {
                console.log('🔗 https://github.com/saurabhsharma2u/search-console-mcp');
            }
        } catch (error) {
            console.log('🔗 https://github.com/saurabhsharma2u/search-console-mcp');
        }
    }
}

async function setupBing() {
    printStep(1, 'Get your Bing Webmaster Tools API Key');
    console.log('If you don\'t have one yet:');
    console.log('  1. Go to https://www.bing.com/webmasters/settings/api');
    console.log('  2. Log in with your Microsoft account');
    console.log('  3. Click "API Key" and copy it\n');

    const apiKey = await ask('Enter your Bing API Key: ');

    if (!apiKey) {
        printError('No API Key provided.');
        return;
    }

    printInfo('Verifying API key and fetching sites...');
    let allSites: any[] = [];
    try {
        const tempClient = new BingClient(apiKey);
        allSites = await tempClient.getSiteList();
    } catch (e) {
        printError(`Failed to verify Bing key: ${(e as Error).message}`);
        return;
    }

    let selectedWebsites: string[] | undefined;
    if (allSites.length > 0) {
        console.log(`\n${colors.bold}Available Bing sites:${colors.reset}`);
        console.log(`  0. [All Sites] (Default)`);
        allSites.forEach((s, i) => console.log(`  ${i + 1}. ${s.Url}`));

        const selection = await ask(`\nSelect websites to authorize (comma-separated numbers, or leave empty for all): `);
        if (selection && selection.trim() !== '0') {
            const indices = selection.split(',').map(s => parseInt(s.trim()) - 1).filter(idx => idx >= 0 && idx < allSites.length);
            if (indices.length > 0) {
                selectedWebsites = indices.map(idx => allSites[idx].Url);
            }
        }
    }

    const defaultAlias = selectedWebsites && selectedWebsites.length > 0 ? selectedWebsites[0] : 'Bing Account';
    const alias = await ask(`Enter an alias for this account (optional, default: ${defaultAlias}): `) || defaultAlias;

    const account: AccountConfig = {
        id: `bing_${Date.now()}`,
        engine: 'bing',
        alias,
        apiKey,
        websites: selectedWebsites
    };

    await updateAccount(account);
    printSuccess(`Successfully added Bing account ${alias}!`);

    printStep(2, 'Configure your MCP client');
    showMcpConfigSnippet();

    console.log('\n🎉 Setup complete! You can now use Search Console MCP.\n');

    await supportProject();
}

async function checkAndShowSites(engine: 'google' | 'bing', configStatus: any): Promise<boolean> {
    const isConnected = engine === 'google'
        ? configStatus.googleAccounts && configStatus.googleAccounts.length > 0
        : ((configStatus.bingAccounts && configStatus.bingAccounts.length > 0) || configStatus.legacyBing);

    if (!isConnected) return true;

    const label = engine === 'google' ? 'Google Search Console' : 'Bing Webmaster Tools';
    console.log(`${colors.green}✔ ${label} is already connected!${colors.reset}`);

    try {
        if (engine === 'google') {
            const client = await getSearchConsoleClient();
            const response = await client.sites.list();
            const sites = response.data.siteEntry || [];
            console.log(`\n${colors.bold}Your verified Google sites:${colors.reset}`);
            sites.forEach(s => {
                let displayUrl = (s.siteUrl || '').trim();
                if (displayUrl.startsWith('sc-domain:')) {
                    displayUrl = displayUrl.substring(10);
                } else if (displayUrl.startsWith('sc-ptr:')) {
                    displayUrl = displayUrl.substring(7);
                }
                console.log(`  • ${displayUrl}`);
            });
        } else {
            const client = await getBingClient();
            const sites = await client.getSiteList();
            console.log(`\n${colors.bold}Your verified Bing sites:${colors.reset}`);
            sites.forEach(s => console.log(`  • ${s.Url}`));
        }
    } catch (e) {
        console.log(`${colors.dim} (Could not fetch site list)${colors.reset}`);
    }

    const reconf = await ask(`\nWould you like to reconfigure ${label.split(' ')[0]}? (y/N): `);
    return reconf.toLowerCase().startsWith('y');
}

async function handleGoogleFlow(configStatus: any, forceSubMenu = false) {
    if (!forceSubMenu) {
        const shouldProceed = await checkAndShowSites('google', configStatus);
        if (!shouldProceed) {
            console.log(`\n${colors.green}✔${colors.reset} ${colors.bold}Configuration untouched. You're ready to roll!${colors.reset}`);
            return;
        }
    }
    await googleSubMenu(configStatus);
}

async function handleBingFlow(configStatus: any) {
    const shouldProceed = await checkAndShowSites('bing', configStatus);
    if (!shouldProceed) {
        console.log(`\n${colors.green}✔${colors.reset} ${colors.bold}Configuration untouched. You're ready to roll!${colors.reset}`);
        return;
    }
    await setupBing();
}

export async function main() {
    const args = process.argv.slice(2);

    // Support running `--accounts` directly from the setup file for better developer experience
    if (args.includes('--accounts') || args.includes('accounts')) {
        const { main: accountsMain } = await import('./accounts.js');
        const accountsArgs = args.filter(a => a !== '--accounts' && a !== 'accounts');
        await accountsMain(accountsArgs.length ? accountsArgs : ['list']);
        return;
    }

    const engineFlag = args.find(a => a.startsWith('--engine='))?.split('=')[1]?.toLowerCase();
    const configStatus = await detectConfig();

    if (engineFlag === 'bing') {
        await handleBingFlow(configStatus);
        return;
    } else if (engineFlag === 'google') {
        await handleGoogleFlow(configStatus);
        return;
    } else if (engineFlag === 'ga4') {
        await handleGA4Flow(configStatus);
        return;
    } else if (engineFlag === 'pagespeed') {
        await setupPageSpeed();
        return;
    }

    while (true) {
        printHeader();
        printDetectionSummary(configStatus);

        console.log(`${colors.bold}Let’s wire this up. Pick your integration.${colors.reset}`);

        console.log(`\n1. Google Search Console`);
        console.log('2. Google Analytics 4');
        console.log('3. Bing Webmaster Tools');
        console.log('4. PageSpeed Insights (Optional API Key)');
        console.log('5. Exit');

        const choice = await ask(`\n${colors.bold}${colors.cyan}Enter your choice (1-5): ${colors.reset}`);

        switch (choice) {
            case '1':
                await handleGoogleFlow(configStatus, true);
                break;
            case '2':
                await handleGA4Flow(configStatus);
                break;
            case '3':
                await handleBingFlow(configStatus);
                break;
            case '4':
                await setupPageSpeed();
                // Refresh config status after setting key
                Object.assign(configStatus, await detectConfig());
                break;
            case '5':
            default:
                console.log(`\n${colors.dim}See you on the flip side!${colors.reset}`);
                rl.close();
                return;
        }
    }
}

async function googleSubMenu(configStatus: any) {
    console.log(`\n${colors.bold}Google Search Console Configuration${colors.reset}`);
    console.log(`\n1. Login with Google (OAuth 2.0)`);
    console.log('2. Setup Service Account (JSON Key)');
    console.log('3. Back to main menu');

    const choice = await ask(`\n${colors.bold}${colors.cyan}Enter your choice (1-3): ${colors.reset}`);

    switch (choice) {
        case '1':
            await login();
            break;
        case '2':
            await setupServiceAccount();
            break;
        default:
            return;
    }
}

async function checkAndShowGA4Sites(configStatus: any): Promise<boolean> {
    const isConnected = configStatus.ga4Accounts && configStatus.ga4Accounts.length > 0;
    if (!isConnected) return true;

    console.log(`${colors.green}✔ Google Analytics 4 is already connected!${colors.reset}`);
    const config = await loadConfig();
    const accounts = Object.values(config.accounts).filter(a => a.engine === 'ga4');

    console.log(`\n${colors.bold}Your configured GA4 properties:${colors.reset}`);
    accounts.forEach(a => console.log(`  • ${a.alias} (Property ID: ${a.ga4PropertyId})`));

    const reconf = await ask(`\nWould you like to reconfigure GA4? (y/N): `);
    return reconf.toLowerCase().startsWith('y');
}

async function handleGA4Flow(configStatus: any) {
    const shouldProceed = await checkAndShowGA4Sites(configStatus);
    if (!shouldProceed) {
        console.log(`\n${colors.green}✔${colors.reset} ${colors.bold}Configuration untouched. You're ready to roll!${colors.reset}`);
        return;
    }
    await setupGA4();
}

async function setupGA4() {
    printBoxHeader('Google Analytics 4 Setup');
    console.log('Select authentication method:');
    console.log('1. Service Account (JSON Key)');
    // console.log('2. OAuth 2.0 (Login with Google)');
    console.log('2. Back to main menu');

    const choice = await ask('\nEnter choice (1-2): ');

    if (choice === '1') {
        await setupGA4ServiceAccount();
    } else {
        return;
    }
}

async function setupGA4ServiceAccount() {
    printStep(1, 'Locate your service account JSON key file');

    // Check for existing key from GSC
    let keyPath: string | undefined;
    const config = await loadConfig();
    const gscAccount = findAccount(config.accounts, a => a.engine === 'google' && a.serviceAccountPath !== undefined);

    if (gscAccount && gscAccount.serviceAccountPath) {
        const reuse = await ask(`Found existing Service Account key for GSC (${gscAccount.alias}). Reuse it? (Y/n): `);
        if (reuse === '' || reuse.toLowerCase().startsWith('y')) {
            keyPath = gscAccount.serviceAccountPath;
        }
    }

    if (!keyPath) {
        keyPath = await ask('Enter the path to your JSON key file: ');
        if (!keyPath) {
            printError('No path provided.');
            return;
        }
    }

    const key = validateKeyFile(keyPath);
    if (!key) return;
    const serviceAccountEmail = key.client_email;
    keyPath = resolve(keyPath.replace('~', homedir()));

    printStep(2, 'Add service account to Google Analytics 4');
    console.log('You need to add this email as a user in your GA4 Property:\n');
    console.log(`  📧 ${colors.bold}${serviceAccountEmail}${colors.reset}\n`);
    console.log('Steps:');
    console.log('  1. Go to https://analytics.google.com/');
    console.log('  2. Click "Admin" (cog icon, bottom left)');
    console.log('  3. Select your Property');
    console.log('  4. Click "Property Settings" > "Property Access Management"');
    console.log(`  5. Click "+" > "Add users" and enter: ${serviceAccountEmail}`);
    console.log('  6. Set role to "Viewer" (minimum) and click "Add"\n');

    await ask('Press Enter when you\'ve added the service account to GA4...');

    const auth = new google.auth.GoogleAuth({
        keyFile: keyPath,
        scopes: ['https://www.googleapis.com/auth/analytics.readonly']
    });

    const propertyId = await selectGA4Property(auth);
    if (!propertyId) return;

    // Validate
    printInfo('Verifying access...');
    try {
        const { BetaAnalyticsDataClient } = await import('@google-analytics/data');
        const client = new BetaAnalyticsDataClient({ keyFilename: keyPath });
        await client.runReport({
            property: `properties/${propertyId}`,
            dateRanges: [{ startDate: 'today', endDate: 'today' }],
            metrics: [{ name: 'activeUsers' }],
            limit: 1
        });
        printSuccess('Connection successful!');

        const alias = await ask(`Enter an alias for this account (optional, default: GA4-${propertyId}): `) || `GA4-${propertyId}`;
        const account: AccountConfig = {
            id: `ga4_${Date.now()}`,
            engine: 'ga4',
            alias,
            serviceAccountPath: keyPath,
            ga4PropertyId: propertyId,
            websites: [propertyId]
        };
        await updateAccount(account);
        printSuccess(`Successfully added GA4 account ${alias}!`);
        showMcpConfigSnippet();

    } catch (e) {
        printError(`Failed to connect: ${(e as Error).message}`);
    }
}

async function setupGA4OAuth() {
    printStep(1, 'Browser Authorization');
    console.log('Using Secure Desktop Flow.');
    printInfo('Note: GA4 requires different Google permissions than Search Console.');
    printInfo('If you use the same email, it will appear as a separate account in the CLI.');

    const clientId = DEFAULT_CLIENT_ID;
    const clientSecret = DEFAULT_CLIENT_SECRET;
    const SCOPES = ['https://www.googleapis.com/auth/analytics.readonly', 'https://www.googleapis.com/auth/userinfo.email'];

    try {
        const tokens = await startLocalFlow(clientId, clientSecret, SCOPES);
        const email = await getUserEmail(tokens);
        console.log(`\nAuthorized as: ${colors.bold}${email}${colors.reset}`);

        const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
        oauth2Client.setCredentials(tokens);

        const propertyId = await selectGA4Property(oauth2Client);
        if (!propertyId) return;

        // Validate
        printInfo('Verifying access...');
        const { BetaAnalyticsDataClient } = await import('@google-analytics/data');

        const client = new BetaAnalyticsDataClient({ authClient: oauth2Client as any });
        await client.runReport({
            property: `properties/${propertyId}`,
            dateRanges: [{ startDate: 'today', endDate: 'today' }],
            metrics: [{ name: 'activeUsers' }],
            limit: 1
        });
        printSuccess('Connection successful!');

        const alias = await ask(`Enter an alias for this account (optional, default: ${email}-${propertyId}): `) || `${email}-${propertyId}`;

        const account: AccountConfig = {
            id: `ga4_${Date.now()}`,
            engine: 'ga4',
            alias,
            ga4PropertyId: propertyId,
            websites: [propertyId]
        };
        await updateAccount(account);
        await saveTokensForAccount(account, tokens);
        printSuccess(`Successfully added GA4 account ${alias}!`);
        showMcpConfigSnippet();
    } catch (e) {
        printError(`Failed: ${(e as Error).message}`);
    }
}

async function setupPageSpeed() {
    printBoxHeader('PageSpeed Insights Setup');
    console.log('This key is optional, but raises daily quota from ~100 to 25,000 queries/day.');
    console.log('1. Go to https://console.cloud.google.com/apis/credentials');
    console.log('2. Create an API key and enable the "PageSpeed Insights API" in your project.\n');

    const apiKey = await ask('Enter your PageSpeed API Key (leave empty to skip): ');

    if (!apiKey) {
        printInfo('PageSpeed setup skipped or cleared.');
        return;
    }

    const envPath = resolve('.env');
    let envContent = '';

    if (existsSync(envPath)) {
        envContent = readFileSync(envPath, 'utf8');
        if (envContent.includes('PAGESPEED_API_KEY=')) {
            // Replace existing line
            envContent = envContent.replace(/PAGESPEED_API_KEY=.*/, `PAGESPEED_API_KEY=${apiKey}`);
        } else {
            // Append
            envContent += `\nPAGESPEED_API_KEY=${apiKey}\n`;
        }
    } else {
        const examplePath = resolve('.env.example');
        if (existsSync(examplePath)) {
            envContent = readFileSync(examplePath, 'utf8');
            if (envContent.includes('PAGESPEED_API_KEY=')) {
                envContent = envContent.replace(/PAGESPEED_API_KEY=.*/, `PAGESPEED_API_KEY=${apiKey}`);
            } else {
                envContent += `\nPAGESPEED_API_KEY=${apiKey}\n`;
            }
        } else {
            envContent = `PAGESPEED_API_KEY=${apiKey}\n`;
        }
    }

    writeFileSync(envPath, envContent, 'utf8');
    printSuccess('Successfully wrote PAGESPEED_API_KEY to .env file!');

    console.log(`\n${colors.bold}Note for MCP Client integration:${colors.reset}`);
    console.log('If you run this server via an MCP Client (like Cursor, Claude Desktop, VS Code),');
    console.log('you must configure the environment variables in your client\'s config file.');
    console.log('See the documentation for more details:');
    console.log(`${colors.cyan}https://github.com/saurabhsharma2u/search-console-mcp#pagespeed-insights-optional-api-key${colors.reset}\n`);

    // Force reloading of env vars for current process
    process.env.PAGESPEED_API_KEY = apiKey;

    await ask('Press Enter to continue...');
}


const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
    main().catch((error) => {
        console.error('Setup failed:', error);
        process.exit(1);
    });
}
