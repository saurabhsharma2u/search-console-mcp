import { AccountConfig, loadConfig, updateAccount } from '../../common/auth/config.js';
import { startLocalFlow, getUserEmail, DEFAULT_CLIENT_ID, DEFAULT_CLIENT_SECRET, saveTokensForAccount } from '../../google/client.js';
import { google } from 'googleapis';
import { prompts, withSpinner } from '../../utils/prompts.js';
import { validateAlias } from '../../utils/validation.js';
import { colors, printBoxHeader } from '../../utils/ui.js';
import { ConfigStatus, log, printSuccess, printError, printInfo, showMcpConfigSnippet, supportProject } from '../shared.js';

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

    await setupAdSense();
}

async function setupAdSense() {
    printBoxHeader('Google AdSense Setup');
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
        printInfo('Headless server? Export this grant with: search-console-mcp adsense-export');

        await supportProject('AdSense');
    } catch (e) {
        if ((e as any).name === 'CancelledError') throw e;
        printError(`Failed: ${(e as Error).message}`);
    }
}
