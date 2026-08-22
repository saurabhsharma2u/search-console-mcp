import { loadConfig } from './auth/config.js';
import { getSearchConsoleClient } from '../google/client.js';
import { getBingClient } from '../bing/client.js';
import { logger } from '../utils/logger.js';

export interface DiagnosticResult {
    engine: string;
    account: string;
    status: 'ok' | 'error';
    message: string;
    details?: any;
}

/**
 * Runs a set of diagnostic checks to verify API connectivity and account health.
 * Covers all configured engines (google, bing, ga4, adsense) plus the
 * optional PageSpeed API key.
 */
export async function runDiagnostics(): Promise<DiagnosticResult[]> {
    const config = await loadConfig();
    const accounts = Object.values(config.accounts);
    const results: DiagnosticResult[] = [];

    logger.info(`Starting diagnostics for ${accounts.length} accounts...`);
    logger.info(`System Time: ${new Date().toISOString()}`);
    logger.info(`Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);

    for (const account of accounts) {
        logger.debug(`Checking account: ${account.alias} (${account.engine})`);

        try {
            if (account.engine === 'google') {
                const client = await getSearchConsoleClient(undefined, account.id);
                // Test call: list sites (limited to 1 for quick check)
                const res = await client.sites.list();
                results.push({
                    engine: 'google',
                    account: account.alias,
                    status: 'ok',
                    message: `Successfully connected. Account has access to ${res.data.siteEntry?.length || 0} sites.`,
                    details: { sitesCount: res.data.siteEntry?.length || 0 }
                });
            } else if (account.engine === 'bing') {
                const client = await getBingClient(undefined, account.id);
                const res = await client.getSiteList();
                results.push({
                    engine: 'bing',
                    account: account.alias,
                    status: 'ok',
                    message: `Successfully connected. Account has access to ${res.length} sites.`,
                    details: { sitesCount: res.length }
                });
            } else if (account.engine === 'ga4') {
                const { getGA4Client } = await import('../ga4/client.js');
                const client = await getGA4Client(undefined, account.id);
                // Minimal billable-free read: 1 row, today's active users
                await client.runReport({
                    dateRanges: [{ startDate: 'today', endDate: 'today' }],
                    metrics: [{ name: 'activeUsers' }],
                    limit: 1
                });
                results.push({
                    engine: 'ga4',
                    account: account.alias,
                    status: 'ok',
                    message: `Successfully connected to property ${account.ga4PropertyId}.`
                });
            } else if (account.engine === 'adsense') {
                const { getAdsenseClient } = await import('../adsense/client.js');
                const client = await getAdsenseClient(account.id);
                // Minimal report read: 1 row, earnings only
                await client.generateReport({
                    dateRange: 'LAST_7_DAYS',
                    metrics: ['ESTIMATED_EARNINGS'],
                    limit: 1
                } as any);
                results.push({
                    engine: 'adsense',
                    account: account.alias,
                    status: 'ok',
                    message: `Successfully connected to publisher ${account.adsenseAccountId}.`
                });
            }
        } catch (e) {
            const error = e as Error;
            logger.error(`Diagnostic failed for ${account.alias}: ${error.message}`);
            results.push({
                engine: account.engine,
                account: account.alias,
                status: 'error',
                message: error.message
            });
        }
    }

    if (process.env.PAGESPEED_API_KEY) {
        results.push({
            engine: 'pagespeed',
            account: 'api-key',
            status: 'ok',
            message: 'API key configured.'
        });
    }

    if (results.length === 0) {
        results.push({
            engine: 'system',
            account: 'none',
            status: 'error',
            message: 'No accounts configured. Run setup first.'
        });
    }

    return results;
}
