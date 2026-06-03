import { AccountConfig, loadConfig, EngineType } from './config.js';
import { getCurrentTenant } from '../../tenant/context.js';
import { resolveTenantAccount } from '../../tenant/guard.js';

export interface ResolutionError extends Error {
    code: 'FORBIDDEN' | 'AMBIGUOUS' | 'NOT_FOUND';
    resolution?: {
        command: string;
    };
}

/**
 * Normalizes a website or domain string for comparison.
 */
export function normalizeWebsite(site: string): { type: 'domain' | 'url-prefix'; value: string } {
    let value = site.toLowerCase().trim();

    // Strip common protocols for normalization
    const protocolRegex = /^https?:\/\//i;
    const isUrlPrefix = protocolRegex.test(value) || value.includes('/');

    // Handle trailing slashes
    if (value.endsWith('/')) {
        value = value.slice(0, -1);
    }

    if (!isUrlPrefix && !value.startsWith('sc-domain:')) {
        // It's a domain
        return { type: 'domain', value: value.replace(protocolRegex, '') };
    }

    return { type: 'url-prefix', value };
}

/**
 * Resolves the best account for a given siteUrl and engine.
 */
export async function resolveAccount(siteUrl: string, engine: EngineType): Promise<AccountConfig> {
    const tenant = getCurrentTenant();
    if (tenant) {
        return resolveTenantAccount(tenant, siteUrl, engine);
    }

    const config = await loadConfig();
    const accounts = Object.values(config.accounts).filter(a => a.engine === engine);

    if (accounts.length === 0) {
        const error = new Error(`No ${engine} accounts found. Please run setup.`) as ResolutionError;
        error.code = 'NOT_FOUND';
        error.resolution = { command: `search-console-mcp setup --engine=${engine}` };
        throw error;
    }

    const normalizedTarget = normalizeWebsite(siteUrl);

    // 1. Exact Match
    const exactMatch = accounts.find(a =>
        a.websites?.some(w => normalizeWebsite(w).value === normalizedTarget.value)
    );
    if (exactMatch) return exactMatch;

    // 2. Domain Match (if target is a URL prefix and we have a domain boundary)
    if (normalizedTarget.type === 'url-prefix') {
        try {
            const targetHost = new URL(siteUrl).hostname.toLowerCase();
            const domainMatch = accounts.find(a =>
                a.websites?.some(w => {
                    const nw = normalizeWebsite(w);
                    return nw.type === 'domain' && (targetHost === nw.value || targetHost.endsWith('.' + nw.value));
                })
            );
            if (domainMatch) return domainMatch;
        } catch (error) {
            // If the URL is invalid, we can't do a domain match.
            // Just skip to the next resolution step.
        }
    }

    // 3. Global Accounts (Empty websites list)
    const globalAccounts = accounts.filter(a => !a.websites || a.websites.length === 0);

    if (globalAccounts.length === 1) {
        return globalAccounts[0];
    }

    // Single account fallback: If no siteUrl requested and only one account exists, use it.
    if (!siteUrl && accounts.length === 1) {
        return accounts[0];
    }

    if (globalAccounts.length > 1) {
        const error = new Error(`Multiple ${engine} accounts found. Please specify an account boundary or remove unused accounts.`) as ResolutionError;
        error.code = 'AMBIGUOUS';
        error.resolution = { command: `search-console-mcp accounts list` };
        throw error;
    }

    // 4. Forbidden
    const error = new Error(`Access restricted. Site '${siteUrl}' is not in the authorized list for any ${engine} account.`) as ResolutionError;
    error.code = 'FORBIDDEN';
    error.resolution = {
        command: `search-console-mcp accounts add-site --site=${siteUrl}`
    };
    throw error;
}
