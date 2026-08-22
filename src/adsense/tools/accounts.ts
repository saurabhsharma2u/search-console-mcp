import { loadConfig } from '../../common/auth/config.js';
import { getAdsenseClient } from '../client.js';

/**
 * List configured AdSense publisher accounts.
 */
export async function listAdSenseAccounts(accountId?: string) {
    const config = await loadConfig();
    let accounts = Object.values(config.accounts).filter(a => a.engine === 'adsense');

    if (accountId) {
        accounts = accounts.filter(a => a.id === accountId);
        if (accounts.length === 0) {
            throw new Error(`AdSense account ${accountId} not found.`);
        }
        return accounts.map(a => ({
            id: a.id,
            alias: a.alias,
            publisherId: a.adsenseAccountId,
            siteUrl: a.adsenseAccountId // Alias for sites_list consistency
        }));
    }

    return accounts.map(a => ({
        id: a.id,
        alias: a.alias,
        publisherId: a.adsenseAccountId,
        siteUrl: a.adsenseAccountId // Alias for sites_list consistency
    }));
}

/**
 * Lists ALL AdSense publisher accounts the authenticated user has access to.
 * Useful for discovering Publisher IDs before configuring an account.
 */
export async function listAccessibleAdSenseAccounts(accountId?: string) {
    const client = await getAdsenseClient(accountId);
    const accounts = await client.listAccounts();
    return accounts.map(a => ({
        name: a.name,               // e.g. "accounts/pub-0000000000000000"
        publisherId: a.name?.replace('accounts/', ''),
        displayName: a.displayName,
        state: a.state,
        timeZone: a.timeZone,
        premium: a.premium
    }));
}
