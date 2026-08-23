import { AccountConfig, loadConfig, updateAccount } from '../../common/auth/config.js';
import { google } from 'googleapis';
import { startLocalFlow, getUserEmail, DEFAULT_CLIENT_ID, DEFAULT_CLIENT_SECRET, saveTokensForAccount } from '../../google/client.js';
import { prompts, withSpinner } from '../../utils/prompts.js';
import { validateAlias, parseServiceAccountKey } from '../../utils/validation.js';
import { colors } from '../../utils/ui.js';
import { ConfigStatus, log, printStep, printSuccess, printError, printInfo, showMcpConfigSnippet, supportProject, acquireServiceAccountKey } from '../shared.js';

async function selectGA4Property(auth: any): Promise<string | undefined> {
    printInfo('Fetching available GA4 properties...');
    try {
        const admin = google.analyticsadmin('v1beta');
        const response = await admin.accountSummaries.list({ auth });

        const summaries = response.data.accountSummaries || [];
        const properties: { name: string; displayName: string }[] = [];
        for (const account of summaries) {
            for (const prop of account.propertySummaries || []) {
                if (prop.property) {
                    properties.push({
                        name: prop.property,
                        displayName: prop.displayName || prop.property
                    });
                }
            }
        }

        if (properties.length === 0) {
            printInfo('No GA4 properties found in this account.');
            log(`\n${colors.yellow}💡 Hint:${colors.reset} Ensure your Google account or Service Account has been added to the GA4 Property.`);
            log(`   Go to ${colors.cyan}GA4 Admin > Property Settings > Property Access Management${colors.reset} and add it.`);
            return await prompts.text('Enter your GA4 Property ID manually (e.g. 123456789):', { defaultValue: '' });
        }

        return await prompts.select(
            'Select your GA4 property:',
            properties.map(p => ({ value: p.name.split('/').pop()!, label: p.displayName, hint: p.name }))
        );
    } catch (e) {
        printError(`Failed to fetch properties: ${(e as Error).message}`);
        log('');
        return await prompts.text('Enter your GA4 Property ID manually:', { defaultValue: '' });
    }
}

async function setupGA4ServiceAccount() {
    printStep(1, 'Provide your service account JSON key');

    // Check for existing key from GSC
    let keyPath: string | undefined;
    let email: string | undefined;

    const config = await loadConfig();
    const gscAccount = Object.values(config.accounts).find(a => a.engine === 'google' && a.serviceAccountPath);

    if (gscAccount && gscAccount.serviceAccountPath) {
        const reuse = await prompts.confirm(
            `Found existing Service Account key for GSC (${gscAccount.alias}). Reuse it?`,
            true
        );
        if (reuse) {
            const parsed = parseServiceAccountKey(gscAccount.serviceAccountPath);
            if (parsed.key) {
                keyPath = gscAccount.serviceAccountPath;
                email = parsed.key.client_email;
            } else {
                // Key unreadable — say so and re-acquire instead of asking
                // the user to retype an email we should be able to read.
                printError(`Could not reuse the existing key: ${parsed.error}`);
                log('');
            }
        }
    }

    if (!keyPath) {
        log("If you haven't already, follow these steps:");
        log('  1. Go to https://console.cloud.google.com/iam-admin/serviceaccounts');
        log('  2. Create or select a service account');
        log('  3. Click "Keys" > "Add Key" > "Create new key" > "JSON"\n');

        const acquired = await acquireServiceAccountKey();
        if (!acquired) {
            printError('No credentials provided. Setup cancelled.');
            return;
        }
        keyPath = acquired.path;
        email = acquired.key.client_email;
    }

    // Add to GA4
    printStep(2, 'Add service account to GA4');

    log('\nSteps:');
    log('  1. Go to https://analytics.google.com');
    log('  2. Select your property > Admin > Property Access Management');
    log(`  3. Click "+" and add: ${email}`);
    log('  4. Grant at least "Viewer" access\n');

    await prompts.text("Press Enter when you've added the service account to GA4...", { defaultValue: '' });

    // Fetch properties
    printStep(3, 'Select your GA4 property');
    const auth = new google.auth.GoogleAuth({
        keyFile: keyPath,
        scopes: ['https://www.googleapis.com/auth/analytics.readonly']
    });
    const authClient = await withSpinner('Authenticating with Google APIs...', () => auth.getClient());
    // Interactive selection must run outside the spinner
    const propertyId = await selectGA4Property(authClient);

    if (!propertyId) {
        printError('No property selected. Setup cancelled.');
        return;
    }

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
    } catch (e) {
        printError(`Verification failed: ${(e as Error).message}`);
        log(`\n${colors.yellow}💡 Double-check that the service account email was added to the property with Viewer access.${colors.reset}`);
        return;
    }

    const defaultAlias = `${email}-${propertyId}`;
    const alias = await prompts.text('Account alias (optional — press Enter to use the property ID):', {
        defaultValue: defaultAlias,
        placeholder: defaultAlias,
        validate: validateAlias
    }) || defaultAlias;

    // Re-configuring an already-connected property must update it,
    // not create a duplicate entry
    const existing = Object.values(config.accounts).find(
        a => a.engine === 'ga4' && a.ga4PropertyId === propertyId
    );

    if (existing) {
        const replace = await prompts.confirm(
            `Property ${propertyId} is already connected as "${existing.alias}" (${existing.id}). Update it?`,
            true
        );
        if (!replace) {
            printInfo('Setup cancelled — existing configuration left unchanged.');
            return;
        }
    }

    const account: AccountConfig = {
        ...(existing || {}),
        id: existing ? existing.id : `ga4_${Date.now()}`,
        engine: 'ga4',
        alias,
        ga4PropertyId: propertyId,
        websites: [propertyId],
        serviceAccountPath: keyPath
    };
    await updateAccount(account);
    printSuccess(`Successfully added GA4 property ${alias}!`);

    showMcpConfigSnippet();
    await supportProject('GA4');
}

/**
 * GA4 OAuth flow — DORMANT.
 *
 * Disabled in 86e1d27 ("hide: disable GA4 OAuth setup until app approval")
 * because the shared OAuth client is not yet verified for the
 * analytics.readonly scope. The implementation is kept intact; to re-enable
 * after Google app approval, offer 'oauth' in configureGA4's method select:
 *
 *   const method = await prompts.select('How would you like to connect GA4?', [
 *     { value: 'oauth', label: 'Login with Google (OAuth 2.0)' },
 *     { value: 'sa', label: 'Service Account (JSON key)' },
 *   ]);
 */
async function setupGA4OAuth() {
    printStep(1, 'Browser Authorization');
    log('Using Secure Desktop Flow.');
    printInfo('Note: GA4 requires different Google permissions than Search Console.');
    printInfo('If you use the same email, it will appear as a separate account in the CLI.');

    const clientId = DEFAULT_CLIENT_ID;
    const clientSecret = DEFAULT_CLIENT_SECRET;
    const SCOPES = ['https://www.googleapis.com/auth/analytics.readonly', 'https://www.googleapis.com/auth/userinfo.email'];

    try {
        const tokens = await startLocalFlow(clientId, clientSecret, SCOPES);
        const email = await getUserEmail(tokens);
        log(`\nAuthorized as: ${email}`);

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

        const defaultAlias = `${email}-${propertyId}`;
        const alias = await prompts.text('Account alias (optional — press Enter to use the property ID):', {
            defaultValue: defaultAlias,
            placeholder: defaultAlias,
            validate: validateAlias
        }) || defaultAlias;

        // Re-auth of an already-connected property must update it,
        // not create a duplicate entry
        const config = await loadConfig();
        const existing = Object.values(config.accounts).find(
            a => a.engine === 'ga4' && a.ga4PropertyId === propertyId
        );

        if (existing) {
            const replace = await prompts.confirm(
                `Property ${propertyId} is already connected as "${existing.alias}" (${existing.id}). Re-authorize and update it?`,
                true
            );
            if (!replace) {
                printInfo('Setup cancelled — existing configuration left unchanged.');
                return;
            }
        }

        const account: AccountConfig = {
            ...(existing || {}),
            id: existing ? existing.id : `ga4_${Date.now()}`,
            engine: 'ga4',
            alias,
            ga4PropertyId: propertyId,
            websites: [propertyId]
        };
        await updateAccount(account);
        await saveTokensForAccount(account, tokens);
        printSuccess(`Successfully added GA4 account ${alias}!`);
        showMcpConfigSnippet();
        await supportProject('GA4');
    } catch (e) {
        if ((e as any).name === 'CancelledError') throw e;
        printError(`Failed: ${(e as Error).message}`);
    }
}

export async function configureGA4(configStatus: ConfigStatus) {
    const isConnected = configStatus.ga4Accounts && configStatus.ga4Accounts.length > 0;

    if (isConnected) {
        printSuccess('Google Analytics 4 is already connected!');
        const config = await loadConfig();
        const accounts = Object.values(config.accounts).filter(a => a.engine === 'ga4');

        log(`\nYour configured GA4 properties:`);
        accounts.forEach(a => log(`  • ${a.alias} (Property ID: ${a.ga4PropertyId})`));

        const reconf = await prompts.confirm('Would you like to reconfigure GA4?', false);
        if (!reconf) return;
    }

    await setupGA4ServiceAccount();
}
