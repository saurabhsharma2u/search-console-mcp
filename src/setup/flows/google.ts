import { resolve } from 'path';
import { google } from 'googleapis';
import { AccountConfig, loadConfig, updateAccount } from '../../common/auth/config.js';
import { startLocalFlow, getUserEmail, logout, getSearchConsoleClient, DEFAULT_CLIENT_ID, DEFAULT_CLIENT_SECRET, saveTokensForAccount } from '../../google/client.js';
import { prompts, withSpinner, CancelledError } from '../../utils/prompts.js';
import { validateAlias } from '../../utils/validation.js';
import { colors } from '../../utils/ui.js';
import { ConfigStatus, log, printBanner, printStep, printSuccess, printError, printInfo, showMcpConfigSnippet, supportProject, acquireServiceAccountKey, testConnection } from '../shared.js';

export async function runLogout() {
    printBanner();
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

function displaySiteUrl(siteUrl: string): string {
    let display = (siteUrl || '').trim();
    if (display.startsWith('sc-domain:')) display = display.substring(10);
    else if (display.startsWith('sc-ptr:')) display = display.substring(7);
    return display;
}

export async function login() {
    printBanner();
    printStep(1, 'Browser Authorization');

    log('Using Secure Desktop Flow.');
    printInfo('We will automatically fetch your email to support multiple accounts.');

    log(`\n${colors.bold}💡 Google Indexing API Rules:${colors.reset}`);
    log(`   Officially, the Google Indexing API is only supported for pages containing`);
    log(`   JobPosting or BroadcastEvent structured data. Using it for other content`);
    log(`   types may result in submissions being ignored by Google.`);

    const useIndexing = await prompts.confirm(
        'Also authorize the Google Indexing API write scope? (Officially for JobPosting/BroadcastEvent pages only)',
        false
    );
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
        const tokens = await startLocalFlow(DEFAULT_CLIENT_ID, DEFAULT_CLIENT_SECRET, scopes);

        printInfo('Fetching account information...');
        const email = await getUserEmail(tokens);

        log(`\nAuthorized as: ${email}`);

        // Fetch and select websites
        const oauth2Client = new google.auth.OAuth2(DEFAULT_CLIENT_ID, DEFAULT_CLIENT_SECRET);
        oauth2Client.setCredentials(tokens);
        const gClient = google.searchconsole({ version: 'v1', auth: oauth2Client });

        const siteResponse = await gClient.sites.list();
        const allSites = siteResponse.data?.siteEntry || [];

        let selectedWebsites: string[] | undefined;
        if (allSites.length > 0) {
            selectedWebsites = await pickSites(
                allSites.map((s: any) => s.siteUrl!),
                'Select sites to authorize (space to toggle, enter to confirm). Leave empty to authorize ALL sites.'
            );
        }

        const alias = await prompts.text('Enter an alias for this account:', {
            defaultValue: email,
            validate: validateAlias
        }) || email;

        const config = await loadConfig();
        const existingAccount = Object.values(config.accounts).find(a => a.engine === 'google' && a.alias === alias);
        const accountId = existingAccount ? existingAccount.id : `google_${Date.now()}`;

        const account: AccountConfig = {
            ...(existingAccount || {}),
            id: accountId,
            engine: 'google',
            alias,
            websites: selectedWebsites
        };
        delete (account as any).serviceAccountPath;

        await updateAccount(account);
        await saveTokensForAccount(account, tokens);

        printSuccess(`Successfully added account ${alias}!`);
        printInfo('Tokens are stored securely in your system keychain.');

        printStep(2, 'Configure your MCP client');
        showMcpConfigSnippet();

        await supportProject('Google Search Console');
    } catch (error) {
        if (error instanceof CancelledError) throw error;
        printError(`Authentication failed: ${(error as Error).message}`);
        log('\nTip: Ensure you are using a "Desktop Application" Client ID type in the Cloud Console.');
        throw error;
    }
}

/**
 * Shared site picker. Returns undefined when the user selects nothing (= authorize all).
 */
export async function pickSites(sites: string[], message: string): Promise<string[] | undefined> {
    if (sites.length === 0) return undefined;
    const selected = await prompts.multiselect<string>(
        message,
        sites.map((s, i) => ({ value: s, label: displaySiteUrl(s), hint: `#${i + 1}` })),
        false
    );
    return selected.length > 0 ? selected : undefined;
}

async function setupServiceAccount() {
    printStep(1, 'Provide your service account JSON key');

    log("If you don't have one yet, follow these steps:");
    log('  1. Go to https://console.cloud.google.com/iam-admin/serviceaccounts');
    log('  2. Create a new service account (or select existing)');
    log('  3. Click "Keys" > "Add Key" > "Create new key" > "JSON"');
    log('  4. Save the downloaded JSON file\n');

    const acquired = await acquireServiceAccountKey();
    if (!acquired) {
        printError('No credentials file provided.');
        return;
    }

    const { key, path: credentialsPath } = acquired;
    printSuccess('JSON key is valid!');
    const serviceAccountEmail = key.client_email;

    printStep(2, 'Add service account to Google Search Console');
    log('You need to add this email as a user in Google Search Console:\n');
    log(`  📧 ${serviceAccountEmail}\n`);
    log('Steps:');
    log('  1. Go to https://search.google.com/search-console');
    log('  2. Select your property');
    log('  3. Click "Settings" > "Users and permissions" > "Add user"');
    log(`  4. Enter: ${serviceAccountEmail}`);
    log('  5. Set permission to "Full" or "Restricted" and click "Add"\n');

    await prompts.text("Press Enter when you've added the service account to Search Console...", { defaultValue: '' });

    printStep(3, 'Test connection');
    const connected = await withSpinner('Testing authentication with Google APIs...', () => testConnection(credentialsPath));

    if (connected) {
        printSuccess('Authentication successful!');
    } else {
        return;
    }

    let selectedWebsites: string[] | undefined;
    try {
        const auth = new google.auth.GoogleAuth({
            keyFilename: credentialsPath,
            scopes: ['https://www.googleapis.com/auth/webmasters.readonly']
        });
        const gClient = google.searchconsole({ version: 'v1', auth });
        const siteResponse = await gClient.sites.list();
        const allSites = siteResponse.data?.siteEntry || [];

        if (allSites.length > 0) {
            selectedWebsites = await pickSites(
                allSites.map((s: any) => s.siteUrl!),
                'Select sites to authorize. Leave empty to authorize ALL sites.'
            );
        }
    } catch {
        // Silently skip if fails to fetch
    }

    const alias = await prompts.text('Account alias (optional — press Enter to use the service account email):', {
        defaultValue: serviceAccountEmail,
        placeholder: serviceAccountEmail,
        validate: validateAlias
    }) || serviceAccountEmail;

    const config = await loadConfig();
    const existingAccount = Object.values(config.accounts).find(a => a.engine === 'google' && a.alias === alias);
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
    log('\n🎉 Setup complete! You can now use Search Console MCP.\n');

    await supportProject('Google Search Console');
}

async function checkAndShowGoogleSites(configStatus: ConfigStatus): Promise<boolean> {
    if (!configStatus.googleAccounts || configStatus.googleAccounts.length === 0) return true;

    printSuccess('Google Search Console is already connected!');
    try {
        const client = await getSearchConsoleClient();
        const response = await client.sites.list();
        const sites = response.data.siteEntry || [];
        log(`\nYour verified Google sites:`);
        sites.forEach(s => log(`  • ${displaySiteUrl(s.siteUrl || '')}`));
    } catch {
        log('(Could not fetch site list)');
    }

    return await prompts.confirm('Would you like to reconfigure Google Search Console?', false);
}

export async function configureGoogle(configStatus: ConfigStatus) {
    const isConnected = configStatus.googleAccounts && configStatus.googleAccounts.length > 0;

    if (isConnected) {
        printSuccess('Google Search Console is already connected!');
        try {
            const client = await getSearchConsoleClient();
            const response = await client.sites.list();
            const sites = response.data.siteEntry || [];
            log(`\nYour verified Google sites:`);
            sites.forEach(s => log(`  • ${displaySiteUrl(s.siteUrl || '')}`));
        } catch {
            log('(Could not fetch site list)');
        }

        const reconf = await prompts.confirm('Would you like to reconfigure Google Search Console?', false);
        if (!reconf) return;
    }

    const method = await prompts.select('How would you like to connect Google Search Console?', [
        { value: 'oauth', label: 'Login with Google (OAuth 2.0)', hint: 'Recommended — uses your browser' },
        { value: 'sa', label: 'Service Account (JSON key)', hint: 'For servers & automation' },
    ]);
    if (method === 'oauth') {
        await login();
    } else {
        await setupServiceAccount();
    }
}
