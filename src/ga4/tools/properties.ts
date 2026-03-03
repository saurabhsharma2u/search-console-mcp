import { loadConfig } from '../../common/auth/config.js';

export async function listProperties(accountId?: string) {
    const config = await loadConfig();
    const accounts = Object.values(config.accounts).filter(a => a.engine === 'ga4');

    if (accountId) {
        const account = accounts.find(a => a.id === accountId);
        if (!account) {
            throw new Error(`GA4 account ${accountId} not found.`);
        }
        return [{
            id: account.id,
            alias: account.alias,
            propertyId: account.ga4PropertyId
        }];
    }

    return accounts.map(a => ({
        id: a.id,
        alias: a.alias,
        propertyId: a.ga4PropertyId
    }));
}
