import { google } from 'googleapis';
import type { adsense_v2 } from 'googleapis';
import { AccountConfig, loadConfig } from '../common/auth/config.js';
import { loadTokensForAccount, saveTokensForAccount, DEFAULT_CLIENT_ID, DEFAULT_CLIENT_SECRET } from '../google/client.js';

const ADSENSE_VERSION = 'v2';

export class AdSenseClient {
    private client: adsense_v2.Adsense;
    private publisherId: string;

    constructor(client: adsense_v2.Adsense, publisherId: string) {
        this.client = client;
        this.publisherId = publisherId;
    }

    getPublisherId(): string {
        return this.publisherId;
    }

    async listAccounts() {
        const accounts: adsense_v2.Schema$Account[] = [];
        let pageToken: string | undefined;
        do {
            const res = await this.client.accounts.list({
                pageSize: 100,
                pageToken,
            });
            accounts.push(...(res.data.accounts || []));
            pageToken = res.data.nextPageToken || undefined;
        } while (pageToken);
        return accounts;
    }

    async generateReport(options: adsense_v2.Params$Resource$Accounts$Reports$Generate) {
        const res = await this.client.accounts.reports.generate({
            ...options,
            account: this.publisherId,
        });
        return res.data;
    }

    async listPayments() {
        const res = await this.client.accounts.payments.list({
            parent: this.publisherId,
        });
        return res.data.payments || [];
    }

    async listAlerts() {
        const res = await this.client.accounts.alerts.list({
            parent: this.publisherId,
        });
        return res.data.alerts || [];
    }
}

const MAX_CLIENT_CACHE_SIZE = 10;
const cachedAdSenseClients = new Map<string, AdSenseClient>();

export function clearAdSenseClientCache() {
    cachedAdSenseClients.clear();
}

export async function getAdsenseClient(accountId?: string): Promise<AdSenseClient> {
    // 1. Resolve Account
    let account: AccountConfig | undefined;
    const config = await loadConfig();

    if (accountId) {
        account = config.accounts[accountId];
        if (!account) throw new Error(`Account ${accountId} not found.`);
        if (account.engine !== 'adsense') throw new Error(`Account ${account.alias} is not an AdSense account.`);
    } else {
        const accounts = Object.values(config.accounts).filter(a => a.engine === 'adsense');

        if (accounts.length === 1) {
            account = accounts[0];
        } else if (accounts.length > 1) {
            throw new Error("Multiple AdSense accounts found. Please specify accountId.");
        } else {
            throw new Error("No AdSense accounts found. Run: search-console-mcp setup --engine=adsense");
        }
    }

    // Determine Publisher Account ID to use
    const publisherId = account.adsenseAccountId;
    if (!publisherId) {
        throw new Error(`No AdSense Publisher ID found for account ${account.alias}. Re-run setup.`);
    }

    const cacheKey = `${account.id}:${publisherId}`;
    if (cachedAdSenseClients.has(cacheKey)) {
        return cachedAdSenseClients.get(cacheKey)!;
    }

    let client: adsense_v2.Adsense | undefined;

    // 2. Load Tokens (OAuth)
    const tokens = await loadTokensForAccount(account);

    if (tokens) {
        try {
            const oauth2Client = new google.auth.OAuth2(
                process.env.GOOGLE_CLIENT_ID || DEFAULT_CLIENT_ID,
                process.env.GOOGLE_CLIENT_SECRET || DEFAULT_CLIENT_SECRET
            );
            oauth2Client.setCredentials(tokens);

            // Check for expiry (refresh if needed)
            if (tokens.expiry_date && tokens.expiry_date <= Date.now()) {
                const { credentials } = await oauth2Client.refreshAccessToken();
                // Google may omit refresh_token on refresh; keep the stored one
                const merged = {
                    ...tokens,
                    ...credentials,
                    refresh_token: credentials.refresh_token || tokens.refresh_token,
                };
                await saveTokensForAccount(account, merged);
                oauth2Client.setCredentials(merged);
            }

            client = google.adsense({ version: ADSENSE_VERSION, auth: oauth2Client });

            const adSenseClient = new AdSenseClient(client, publisherId);
            cacheClient(cacheKey, adSenseClient);
            return adSenseClient;
        } catch (error) {
            console.error(`Failed to use tokens for account ${account.alias}:`, (error as Error).message);
        }
    }

    throw new Error(
        `AdSense requires user-authorized OAuth 2.0 (the AdSense Management API does not support service accounts). ` +
        `Re-authorize account "${account.alias}" with: search-console-mcp setup --engine=adsense`
    );
}

function cacheClient(key: string, client: AdSenseClient) {
    if (cachedAdSenseClients.size >= MAX_CLIENT_CACHE_SIZE) {
        // Evict oldest entry (first inserted)
        const firstKey = cachedAdSenseClients.keys().next().value;
        if (firstKey) cachedAdSenseClients.delete(firstKey);
    }
    cachedAdSenseClients.set(key, client);
}
