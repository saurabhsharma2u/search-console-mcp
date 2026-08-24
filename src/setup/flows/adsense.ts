import { AccountConfig, loadConfig, updateAccount } from '../../common/auth/config.js';
import { startLocalFlow, getUserEmail, DEFAULT_CLIENT_ID, DEFAULT_CLIENT_SECRET, saveTokensForAccount } from '../../google/client.js';
import { google } from 'googleapis';
import { prompts, withSpinner } from '../../utils/prompts.js';
import { validateAlias, parseServiceAccountKey } from '../../utils/validation.js';
import { colors, printBoxHeader } from '../../utils/ui.js';
import { ConfigStatus, log, printSuccess, printError, printInfo, showMcpConfigSnippet, supportProject, printStep, acquireServiceAccountKey } from '../shared.js';

export async function configureAdSense(configStatus: ConfigStatus) {
    const isConnected = configStatus.adsenseAccounts && configStatus.adsenseAccounts.length > 0;

    if (isConnected) {
        printSuccess('Google AdSense is already connected!');
        const config = await loadConfig();
        const accounts = Object.values(config.accounts).filter(a => a.engine === 'adsense');

        log(`\nYour configured AdSense publisher accounts:`);
        accounts.forEach(a => log(`  • ${a.alias} (Publisher ID: ${a.adsenseAccountId})`));

        const reconf = await prompts.confirm('Would you like to reconfigure AdSense?', false);
        if (!reconf) return;
    }

    const method = await prompts.select('How would you like to connect AdSense?', [
        { value: 'oauth', label: 'Login with Google (OAuth 2.0)', hint: 'Recommended — uses your browser' },
        { value: 'sa', label: 'Service Account (JSON key)', hint: 'For servers & automation' },
    ]);

    if (method === 'oauth') {
        await setupAdSenseOAuth();
    } else {
        await setupAdSenseServiceAccount();
    }
}

async function setupAdSenseOAuth() {
    printBoxHeader('Google AdSense Setup (OAuth)');
    printInfo('AdSense uses read-only access via Secure Desktop Flow.');
    printInfo('If you use the same email as GSC, it will appear as a separate account in the CLI.');

    const clientId = DEFAULT_CLIENT_ID;
    const clientSecret = DEFAULT_CLIENT_SECRET;
    const SCOPES = ['https://www.googleapis.com/auth/adsense.readonly', 'https://www.googleapis.com/auth/userinfo.email'];

    try {
        const tokens = await withSpinner('Waiting for browser authorization...', () => startLocalFlow(clientId, clientSecret, SCOPES));
        const email = await getUserEmail(tokens);
        log(`\nAuthorized as: ${email}`);

        const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
        oauth2Client.setCredentials(tokens);

        printInfo('Fetching available AdSense publisher accounts...');
        const adsense = google.adsense({ version: 'v2', auth: oauth2Client });
        const pubAccounts: import("googleapis").adsense_v2.Schema$Account[] = [];
        let pageToken: string | undefined;
        do {
            const res = await adsense.accounts.list({ pageSize: 100, pageToken });
            pubAccounts.push(...(res.data.accounts || []));
            pageToken = res.data.nextPageToken || undefined;
        } while (pageToken);

        if (pubAccounts.length === 0) {
            printError('No AdSense publisher accounts found for this Google account.');
            log(`\n${colors.yellow}💡 Hint:${colors.reset} Ensure you have an approved AdSense account at ${colors.cyan}https://adsense.google.com${colors.reset}.`);
            return;
        }

        let selected = pubAccounts[0];
        if (pubAccounts.length > 1) {
            selected = await prompts.select(
                'Select a publisher account:',
                pubAccounts.map(a => ({ value: a, label: a.displayName || a.name || 'Unknown' }))
            );
        }
        const publisherId = selected.name!; // e.g. "accounts/pub-0000000000000000"

        // Validate
        await withSpinner('Verifying access...', () =>
            adsense.accounts.reports.generate({
                account: publisherId,
                dateRange: 'LAST_7_DAYS',
                metrics: ['ESTIMATED_EARNINGS'],
                limit: 1
            })
        );
        printSuccess('Connection successful!');

        const defaultAlias = `${email}-adsense`;
        const alias = await prompts.text('Account alias (optional — press Enter to use your email):', {
            defaultValue: defaultAlias,
            placeholder: defaultAlias,
            validate: validateAlias
        }) || defaultAlias;

        // Re-auth of an already-configured publisher account must update it,
        // not create a duplicate entry
        const config = await loadConfig();
        const existing = Object.values(config.accounts).find(
            a => a.engine === 'adsense' && a.adsenseAccountId === publisherId
        );

        if (existing) {
            const replace = await prompts.confirm(
                `Publisher ${publisherId} is already connected as "${existing.alias}" (${existing.id}). Re-authorize and update it?`,
                true
            );
            if (!replace) {
                printInfo('Setup cancelled — existing configuration left unchanged.');
                return;
            }
        }

        const account: AccountConfig = {
            ...(existing || {}),
            id: existing ? existing.id : `adsense_${Date.now()}`,
            engine: 'adsense',
            alias,
            adsenseAccountId: publisherId
        };
        // Persist tokens first so a failed token save never leaves a
        // configured account without credentials
        await saveTokensForAccount(account, tokens);
        await updateAccount(account);
        printSuccess(`Successfully added AdSense account ${alias}!`);
        showMcpConfigSnippet();

        await supportProject('AdSense');
    } catch (e) {
        if ((e as any).name === 'CancelledError') throw e;
        printError(`Failed: ${(e as Error).message}`);
    }
}

async function setupAdSenseServiceAccount() {
    printBoxHeader('Google AdSense Setup (Service Account)');
    printStep(1, 'Provide your service account JSON key');

    let keyPath: string | undefined;
    let email: string | undefined;

    const config = await loadConfig();
    const gscAccount = Object.values(config.accounts).find(a => (a.engine === 'google' || a.engine === 'ga4') && a.serviceAccountPath);

    if (gscAccount && gscAccount.serviceAccountPath) {
        const reuse = await prompts.confirm(
            `Found existing Service Account key for ${gscAccount.engine.toUpperCase()} (${gscAccount.alias}). Reuse it?`,
            true
        );
        if (reuse) {
            const parsed = parseServiceAccountKey(gscAccount.serviceAccountPath);
            if (parsed.key) {
                keyPath = gscAccount.serviceAccountPath;
                email = parsed.key.client_email;
            } else {
                printError(`Could not reuse the existing key: ${parsed.error}`);
                log('');
            }
        }
    }

    if (!keyPath) {
        const acquired = await acquireServiceAccountKey();
        if (!acquired) {
            printError('No credentials provided. Setup cancelled.');
            return;
        }
        keyPath = acquired.path;
        email = acquired.key.client_email;
    }

    printStep(2, 'Add service account to AdSense');
    log('\nSteps:');
    log('  1. Go to https://adsense.google.com');
    log('  2. Select Account > Access and authorization > User management');
    log(`  3. Click "New User" and add: ${email}`);
    log('  4. They must have at least "Read-only" access\n');

    await prompts.text("Press Enter when you've added the service account to AdSense...", { defaultValue: '' });

    printStep(3, 'Select your AdSense publisher account');
    const auth = new google.auth.GoogleAuth({
        keyFile: keyPath,
        scopes: ['https://www.googleapis.com/auth/adsense.readonly']
    });

    const authClient = await withSpinner('Authenticating with Google APIs...', () => auth.getClient());
    const adsense = google.adsense({ version: 'v2', auth: authClient as any });

    printInfo('Fetching available AdSense publisher accounts...');
    const pubAccounts: import("googleapis").adsense_v2.Schema$Account[] = [];
    let pageToken: string | undefined;

    try {
        do {
            const res = await adsense.accounts.list({ pageSize: 100, pageToken });
            pubAccounts.push(...(res.data.accounts || []));
            pageToken = res.data.nextPageToken || undefined;
        } while (pageToken);
    } catch (e) {
        printError(`Failed to fetch AdSense accounts: ${(e as Error).message}`);
        log(`\n${colors.yellow}💡 Double-check that the service account email was added to AdSense.${colors.reset}`);
        return;
    }

    if (pubAccounts.length === 0) {
        printError('No AdSense publisher accounts found for this Service Account.');
        return;
    }

    let selected = pubAccounts[0];
    if (pubAccounts.length > 1) {
        selected = await prompts.select(
            'Select a publisher account:',
            pubAccounts.map(a => ({ value: a, label: a.displayName || a.name || 'Unknown' }))
        );
    }
    const publisherId = selected.name!;

    printInfo('Verifying access...');
    try {
        await adsense.accounts.reports.generate({
            account: publisherId,
            dateRange: 'LAST_7_DAYS',
            metrics: ['ESTIMATED_EARNINGS'],
            limit: 1
        });
        printSuccess('Connection successful!');
    } catch (e) {
        printError(`Verification failed: ${(e as Error).message}`);
        return;
    }

    const defaultAlias = `${email}-adsense`;
    const alias = await prompts.text('Account alias (optional — press Enter to use the email):', {
        defaultValue: defaultAlias,
        placeholder: defaultAlias,
        validate: validateAlias
    }) || defaultAlias;

    const existing = Object.values(config.accounts).find(
        a => a.engine === 'adsense' && a.adsenseAccountId === publisherId
    );

    if (existing) {
        const replace = await prompts.confirm(
            `Publisher ${publisherId} is already connected as "${existing.alias}" (${existing.id}). Update it?`,
            true
        );
        if (!replace) {
            printInfo('Setup cancelled — existing configuration left unchanged.');
            return;
        }
    }

    const account: AccountConfig = {
        ...(existing || {}),
        id: existing ? existing.id : `adsense_${Date.now()}`,
        engine: 'adsense',
        alias,
        adsenseAccountId: publisherId,
        serviceAccountPath: keyPath
    };

    await updateAccount(account);
    printSuccess(`Successfully added AdSense account ${alias}!`);
    showMcpConfigSnippet();
    await supportProject('AdSense');
}
