import { AccountConfig, AppConfig, loadConfig, updateAccount } from '../../common/auth/config.js';
import { getBingClient, BingClient } from '../../bing/client.js';
import { prompts, withSpinner } from '../../utils/prompts.js';
import { validateAlias } from '../../utils/validation.js';
import { ConfigStatus, log, printStep, printSuccess, printError, printInfo, showMcpConfigSnippet, supportProject } from '../shared.js';
import { pickSites } from './google.js';

async function setupBing() {
    printStep(1, 'Get your Bing Webmaster Tools API Key');
    log('If you don\'t have one yet:');
    log('  1. Go to https://www.bing.com/webmasters/settings/api');
    log('  2. Log in with your Microsoft account');
    log('  3. Click "API Key" and copy it\n');

    const rawApiKey = await prompts.text('Enter your Bing API Key:', {
        validate: (v) => v.trim() ? undefined : 'No API Key provided.'
    });
    const apiKey = rawApiKey.trim();

    printInfo('Verifying API key and fetching sites...');
    let allSites: any[] = [];
    try {
        const tempClient = new BingClient(apiKey);
        allSites = await withSpinner('Fetching Bing sites...', () => tempClient.getSiteList());
    } catch (e) {
        printError(`Failed to verify Bing key: ${(e as Error).message}`);
        return;
    }

    let selectedWebsites: string[] | undefined;
    if (allSites.length > 0) {
        selectedWebsites = await pickSites(
            allSites.map(s => s.Url),
            'Select sites to authorize. Leave empty to authorize ALL sites.'
        );
    }

    const defaultAlias = selectedWebsites && selectedWebsites.length > 0 ? selectedWebsites[0] : 'Bing Account';
    const alias = await prompts.text('Account alias (optional — press Enter to use the website):', {
        defaultValue: defaultAlias,
        placeholder: defaultAlias,
        validate: validateAlias
    }) || defaultAlias;

    // Re-entering an already-configured API key must update the account,
    // not create a duplicate entry
    const config = await loadConfig();
    const existing = Object.values(config.accounts).find(
        a => a.engine === 'bing' && a.apiKey === apiKey
    );

    if (existing) {
        const replace = await prompts.confirm(
            `This API key is already connected as "${existing.alias}" (${existing.id}). Update it?`,
            true
        );
        if (!replace) {
            printInfo('Setup cancelled — existing configuration left unchanged.');
            return;
        }
    }

    const account: AccountConfig = {
        ...(existing || {}),
        id: existing ? existing.id : `bing_${Date.now()}`,
        engine: 'bing',
        alias,
        apiKey,
        websites: selectedWebsites
    };

    await updateAccount(account);
    printSuccess(`Successfully added Bing account ${alias}!`);

    printStep(2, 'Configure your MCP client');
    showMcpConfigSnippet();

    log('\n🎉 Setup complete! You can now use Search Console MCP.\n');

    await supportProject('Bing Webmaster Tools');
}

export async function configureBing(configStatus: ConfigStatus) {
    const isConnected = (configStatus.bingAccounts && configStatus.bingAccounts.length > 0) || configStatus.legacyBing;

    if (isConnected) {
        printSuccess('Bing Webmaster Tools is already connected!');
        try {
            const client = await getBingClient();
            const sites = await client.getSiteList();
            log(`\nYour verified Bing sites:`);
            sites.forEach(s => log(`  • ${s.Url}`));
        } catch {
            log('(Could not fetch site list)');
        }

        const reconf = await prompts.confirm('Would you like to reconfigure Bing?', false);
        if (!reconf) return;
    }

    await setupBing();
}
