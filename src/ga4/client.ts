import { BetaAnalyticsDataClient } from '@google-analytics/data';
import { google } from 'googleapis';
import { AccountConfig, loadConfig, assertServiceAccountKeyReadable } from '../common/auth/config.js';
import { resolveAccount } from '../common/auth/resolver.js';
import { loadTokensForAccount, saveTokensForAccount, DEFAULT_CLIENT_ID, DEFAULT_CLIENT_SECRET } from '../google/client.js';

export class GA4Client {
    private client: BetaAnalyticsDataClient;
    private propertyId: string;

    constructor(client: BetaAnalyticsDataClient, propertyId: string) {
        this.client = client;
        this.propertyId = propertyId;
    }

    getPropertyId(): string {
        return this.propertyId;
    }

    async runReport(options: any) {
        const [response] = await this.client.runReport({
            ...options,
            property: `properties/${this.propertyId}`
        });
        return response;
    }

    async batchRunReports(options: any) {
        const [response] = await this.client.batchRunReports({
            ...options,
            property: `properties/${this.propertyId}`
        });
        return response;
    }

    async runRealtimeReport(options: any) {
        const [response] = await this.client.runRealtimeReport({
            ...options,
            property: `properties/${this.propertyId}`
        });
        return response;
    }
}

const MAX_CLIENT_CACHE_SIZE = 10;
const cachedGA4Clients = new Map<string, GA4Client>();

export function clearGA4ClientCache() {
    cachedGA4Clients.clear();
}

export async function getGA4Client(propertyId?: string, accountId?: string): Promise<GA4Client> {
    // 1. Resolve Account
    let account: AccountConfig | undefined;
    const config = await loadConfig();

    if (accountId) {
        account = config.accounts[accountId];
        if (!account) throw new Error(`Account ${accountId} not found.`);
    } else {
        const accounts = Object.values(config.accounts).filter(a => a.engine === 'ga4');

        if (propertyId) {
            // Try to find by propertyId property
            account = accounts.find(a => a.ga4PropertyId === propertyId);

            if (!account) {
                try {
                    account = await resolveAccount(propertyId, 'ga4');
                } catch (e) {
                    // Ignore
                }
            }
        }

        // Default to single account if available and no specific account found yet
        if (!account) {
            if (accounts.length === 1) {
                account = accounts[0];
            } else if (accounts.length > 1) {
                // If we didn't specify propertyId, ambiguous.
                if (!propertyId) {
                    throw new Error("Multiple GA4 accounts found. Please specify propertyId or accountId.");
                }
                // If we did specify propertyId but didn't find match, we can't proceed.
                throw new Error(`GA4 account for Property ID ${propertyId} not found.`);
            } else {
                throw new Error("No GA4 accounts found. Run setup.");
            }
        }
    }

    const targetPropertyId = propertyId || account.ga4PropertyId;

    if (!targetPropertyId) {
        throw new Error(`No Property ID found for account ${account.alias}.`);
    }

    const cacheKey = `${account.id}:${targetPropertyId}`;
    if (cachedGA4Clients.has(cacheKey)) {
        return cachedGA4Clients.get(cacheKey)!;
    }

    let client: BetaAnalyticsDataClient;

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

            client = new BetaAnalyticsDataClient({
                // googleapis OAuth2Client extends google-auth-library's AuthClient.
                // google-gax ClientOptions expects AuthClient, but the type declarations
                // don't overlap cleanly. Validated with @google-analytics/data@5.2.1.
                authClient: oauth2Client as any
            });

            const ga4Client = new GA4Client(client, targetPropertyId);
            cacheClient(cacheKey, ga4Client);
            return ga4Client;
        } catch (error) {
            console.error(`Failed to use tokens for account ${account.alias}:`, (error as Error).message);
        }
    }

    // 3. Support Service Account Path
    if (account.serviceAccountPath) {
        assertServiceAccountKeyReadable(account);
        client = new BetaAnalyticsDataClient({
            keyFilename: account.serviceAccountPath
        });
        const ga4Client = new GA4Client(client, targetPropertyId);
        cacheClient(cacheKey, ga4Client);
        return ga4Client;
    }

    // 4. Fallback to Environment Variables (Google Application Credentials)
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        client = new BetaAnalyticsDataClient({
            keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
        });
        const ga4Client = new GA4Client(client, targetPropertyId);
        cacheClient(cacheKey, ga4Client);
        return ga4Client;
    }

    throw new Error(`Authentication configuration not found for account ${account.alias}.`);
}

function cacheClient(key: string, client: GA4Client) {
    if (cachedGA4Clients.size >= MAX_CLIENT_CACHE_SIZE) {
        // Evict oldest entry (first inserted)
        const firstKey = cachedGA4Clients.keys().next().value;
        if (firstKey) cachedGA4Clients.delete(firstKey);
    }
    cachedGA4Clients.set(key, client);
}
