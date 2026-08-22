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
        const res = await this.client.accounts.list({
            pageSize: 100,
        });
        return res.data.accounts || [];
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
                await saveTokensForAccount(account, credentials);
                oauth2Client.setCredentials(credentials);
            }

            client = google.adsense({ version: ADSENSE_VERSION, auth: oauth2Client });

            const adSenseClient = new AdSenseClient(client, publisherId);
            cacheClient(cacheKey, adSenseClient);
            return adSenseClient;
        } catch (error) {
            console.error(`Failed to use tokens for account ${account.alias}:`, (error as Error).message);
        }
    }

    // 3. Support Service Account Path
    if (account.serviceAccountPath) {
        const auth = new google.auth.GoogleAuth({
            keyFile: account.serviceAccountPath,
            scopes: ['https://www.googleapis.com/auth/adsense.readonly']
        });
        client = google.adsense({ version: ADSENSE_VERSION, auth });
        const adSenseClient = new AdSenseClient(client, publisherId);
        cacheClient(cacheKey, adSenseClient);
        return adSenseClient;
    }

    // 4. Fallback to Environment Variables (Google Application Credentials)
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        const auth = new google.auth.GoogleAuth({
            keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
            scopes: ['https://www.googleapis.com/auth/adsense.readonly']
        });
        client = google.adsense({ version: ADSENSE_VERSION, auth });
        const adSenseClient = new AdSenseClient(client, publisherId);
        cacheClient(cacheKey, adSenseClient);
        return adSenseClient;
    }

    throw new Error(`Authentication configuration not found for account ${account.alias}.`);
}

function cacheClient(key: string, client: AdSenseClient) {
    if (cachedAdSenseClients.size >= MAX_CLIENT_CACHE_SIZE) {
        // Evict oldest entry (first inserted)
        const firstKey = cachedAdSenseClients.keys().next().value;
        if (firstKey) cachedAdSenseClients.delete(firstKey);
    }
    cachedAdSenseClients.set(key, client);
}
