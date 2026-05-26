import { AccountConfig, EngineType, loadConfig } from '../common/auth/config.js';
import { normalizeWebsite, ResolutionError } from '../common/auth/resolver.js';
import { forbidden, notFound } from './errors.js';
import { TenantContext } from './types.js';

const MUTATING_TOOLS = new Set([
    'sites_add',
    'sites_delete',
    'sitemaps_submit',
    'sitemaps_delete',
    'bing_sites_add',
    'bing_sites_delete',
    'bing_sitemaps_submit',
    'bing_sitemaps_delete',
    'bing_url_submit',
    'bing_url_submit_batch',
    'bing_index_now',
    'accounts_add_site',
    'accounts_remove'
]);

const ADMIN_TOOLS = new Set([
    'accounts_list',
    'accounts_add_site',
    'accounts_remove'
]);

export function assertToolAllowed(tenant: TenantContext, toolName: string) {
    if (ADMIN_TOOLS.has(toolName) && !tenant.admin) {
        throw forbidden('403 Forbidden: account management tools require an admin tenant');
    }

    if (matchesAny(toolName, tenant.deniedTools)) {
        throw forbidden(`403 Forbidden: tool '${toolName}' is denied for this tenant`);
    }

    if (MUTATING_TOOLS.has(toolName)) {
        if (!tenant.allowMutations || !matchesAny(toolName, tenant.allowedMutatingTools)) {
            throw forbidden(`403 Forbidden: mutating tool '${toolName}' is disabled for this tenant`);
        }
    }

    if (tenant.allowedTools.length > 0 && !matchesAny(toolName, tenant.allowedTools)) {
        throw forbidden(`403 Forbidden: tool '${toolName}' is not allowed for this tenant`);
    }
}

export function assertGoogleSiteAllowed(tenant: TenantContext, siteUrl: string) {
    if (!tenant.engines.google) throw forbidden('403 Forbidden: google engine is not allowed for this tenant');
    if (!isSiteAllowed(siteUrl, tenant.engines.google.allowedSites)) {
        throw forbidden('403 Forbidden: site is not allowed for this tenant');
    }
}

export function assertBingSiteAllowed(tenant: TenantContext, siteUrl: string) {
    if (!tenant.engines.bing) throw forbidden('403 Forbidden: bing engine is not allowed for this tenant');
    if (!isSiteAllowed(siteUrl, tenant.engines.bing.allowedSites)) {
        throw forbidden('403 Forbidden: site is not allowed for this tenant');
    }
}

export function assertGa4PropertyAllowed(tenant: TenantContext, propertyId: string) {
    if (!tenant.engines.ga4) throw forbidden('403 Forbidden: ga4 engine is not allowed for this tenant');
    if (!tenant.engines.ga4.allowedProperties.includes(propertyId)) {
        throw forbidden('403 Forbidden: GA4 property is not allowed for this tenant');
    }
}

export function assertUrlBelongsToAllowedSite(tenant: TenantContext, url: string) {
    const allowedSites = [
        ...(tenant.engines.google?.allowedSites || []),
        ...(tenant.engines.bing?.allowedSites || [])
    ];
    if (!isUrlAllowedBySites(url, allowedSites)) {
        throw forbidden('403 Forbidden: URL is not allowed for this tenant');
    }
}

export function assertSitemapBelongsToAllowedSite(tenant: TenantContext, sitemapUrl: string) {
    assertUrlBelongsToAllowedSite(tenant, sitemapUrl);
}

export function assertBatchUrlsAllowed(tenant: TenantContext, urls: string[]) {
    if (urls.length > tenant.limits.maxBatchUrls) {
        throw forbidden(`403 Forbidden: batch URL limit exceeded for this tenant`);
    }
    for (const url of urls) {
        assertUrlBelongsToAllowedSite(tenant, url);
    }
}

export async function resolveTenantAccount(tenant: TenantContext, siteUrl: string, engine: EngineType): Promise<AccountConfig> {
    if (engine === 'google') assertGoogleSiteAllowed(tenant, siteUrl);
    if (engine === 'bing') assertBingSiteAllowed(tenant, siteUrl);
    if (engine === 'ga4') assertGa4PropertyAllowed(tenant, siteUrl);

    const accountIds = engine === 'google'
        ? tenant.engines.google?.accountIds || []
        : engine === 'bing'
            ? tenant.engines.bing?.accountIds || []
            : tenant.engines.ga4?.accountIds || [];

    const config = await loadConfig();
    const accounts = accountIds
        .map(id => config.accounts[id])
        .filter((account): account is AccountConfig => !!account && account.engine === engine);

    if (accounts.length === 0) {
        const error = new Error(`No ${engine} accounts found for tenant '${tenant.tenantId}'.`) as ResolutionError;
        error.code = 'NOT_FOUND';
        throw error;
    }

    const match = accounts.find(account => accountMatchesSite(account, siteUrl, engine));
    if (match) return match;

    const error = new Error(`No ${engine} account for tenant '${tenant.tenantId}' matches '${siteUrl}'.`) as ResolutionError;
    error.code = 'NOT_FOUND';
    throw error;
}

export function assertAccountIdAllowed(tenant: TenantContext, accountId: string, engine: EngineType) {
    const allowed = engine === 'google'
        ? tenant.engines.google?.accountIds || []
        : engine === 'bing'
            ? tenant.engines.bing?.accountIds || []
            : tenant.engines.ga4?.accountIds || [];

    if (!allowed.includes(accountId)) {
        throw forbidden(`403 Forbidden: account is not allowed for this tenant`);
    }
}

export function guardToolArguments(tenant: TenantContext, toolName: string, args: any) {
    assertToolAllowed(tenant, toolName);
    if (!args || typeof args !== 'object') return;

    const engine = args.engine as EngineType | undefined;
    const googleSite = args.siteUrl || args.gscSiteUrl;
    const bingSite = args.bingSiteUrl || (engine === 'bing' ? args.siteUrl : undefined);

    if (googleSite && (!engine || engine === 'google')) assertGoogleSiteAllowed(tenant, googleSite);
    if (bingSite) assertBingSiteAllowed(tenant, bingSite);
    if (args.propertyId) assertGa4PropertyAllowed(tenant, args.propertyId);
    if (args.ga4PropertyId) assertGa4PropertyAllowed(tenant, args.ga4PropertyId);
    if (args.inspectionUrl) assertUrlBelongsToAllowedSite(tenant, args.inspectionUrl);
    if (args.url) assertUrlBelongsToAllowedSite(tenant, args.url);
    if (args.page) assertUrlBelongsToAllowedSite(tenant, args.page);
    if (args.pageUrl) assertUrlBelongsToAllowedSite(tenant, args.pageUrl);
    if (args.feedpath) assertSitemapBelongsToAllowedSite(tenant, args.feedpath);
    if (args.sitemapUrl) assertSitemapBelongsToAllowedSite(tenant, args.sitemapUrl);
    if (Array.isArray(args.urlList)) assertBatchUrlsAllowed(tenant, args.urlList);
    if (Array.isArray(args.urls)) assertBatchUrlsAllowed(tenant, args.urls);

    if (toolName === 'schema_validate' && args.type === 'url') {
        assertUrlBelongsToAllowedSite(tenant, args.data);
    }

    if (toolName === 'bing_index_now') {
        if (args.key) {
            throw forbidden('403 Forbidden: IndexNow key must be configured server-side for this tenant');
        }
        if (args.host) {
            assertUrlBelongsToAllowedSite(tenant, `https://${args.host}/`);
            if (Array.isArray(args.urlList)) {
                const host = String(args.host).toLowerCase();
                for (const url of args.urlList) {
                    const parsed = new URL(url);
                    if (parsed.hostname.toLowerCase() !== host) {
                        throw forbidden('403 Forbidden: IndexNow URL host does not match requested host');
                    }
                }
            }
        }
    }
}

export function isSiteAllowed(siteUrl: string, allowedSites: string[]): boolean {
    if (allowedSites.length === 0) return false;
    const normalized = normalizeWebsite(siteUrl).value;
    return allowedSites.some(allowed => {
        const normalizedAllowed = normalizeWebsite(allowed).value;
        if (normalized === normalizedAllowed) return true;
        if (normalizedAllowed.startsWith('sc-domain:')) {
            return urlHostMatchesDomain(siteUrl, normalizedAllowed.slice('sc-domain:'.length));
        }
        return false;
    });
}

export function isUrlAllowedBySites(url: string, allowedSites: string[]): boolean {
    try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) return false;
        return allowedSites.some(allowed => {
            const normalizedAllowed = normalizeWebsite(allowed).value;
            if (normalizedAllowed.startsWith('sc-domain:')) {
                return urlHostMatchesDomain(url, normalizedAllowed.slice('sc-domain:'.length));
            }
            if (!normalizedAllowed.startsWith('http://') && !normalizedAllowed.startsWith('https://')) {
                return urlHostMatchesDomain(url, normalizedAllowed);
            }
            return urlMatchesPrefix(parsed, normalizedAllowed);
        });
    } catch {
        return false;
    }
}

function urlHostMatchesDomain(urlOrHost: string, domain: string): boolean {
    const cleanDomain = domain.toLowerCase().replace(/^sc-domain:/, '');
    try {
        const host = new URL(urlOrHost).hostname.toLowerCase();
        return host === cleanDomain || host.endsWith(`.${cleanDomain}`);
    } catch {
        const host = urlOrHost.toLowerCase().replace(/^sc-domain:/, '');
        return host === cleanDomain;
    }
}

function urlMatchesPrefix(parsed: URL, prefix: string): boolean {
    try {
        const allowed = new URL(prefix);
        if (parsed.protocol !== allowed.protocol || parsed.hostname !== allowed.hostname) return false;
        const allowedPath = allowed.pathname.endsWith('/') ? allowed.pathname : `${allowed.pathname}/`;
        const actualPath = parsed.pathname.endsWith('/') ? parsed.pathname : `${parsed.pathname}/`;
        return actualPath.startsWith(allowedPath);
    } catch {
        return false;
    }
}

function accountMatchesSite(account: AccountConfig, siteUrl: string, engine: EngineType): boolean {
    if (engine === 'ga4') {
        return account.ga4PropertyId === siteUrl || !!account.websites?.includes(siteUrl);
    }
    return !!account.websites?.some(site => isSiteAllowed(siteUrl, [site]) || isUrlAllowedBySites(siteUrl, [site]));
}

function matchesAny(value: string, patterns: string[]): boolean {
    return patterns.some(pattern => {
        if (pattern === value || pattern === '*') return true;
        if (pattern.endsWith('*')) return value.startsWith(pattern.slice(0, -1));
        return false;
    });
}

export async function tenantSitesList(tenant: TenantContext, engine: EngineType) {
    if (engine === 'google') {
        return [{ tenant: tenant.tenantId, engine, sites: tenant.engines.google?.allowedSites || [] }];
    }
    if (engine === 'bing') {
        return [{ tenant: tenant.tenantId, engine, sites: tenant.engines.bing?.allowedSites || [] }];
    }
    if (engine === 'ga4') {
        return [{ tenant: tenant.tenantId, engine, properties: tenant.engines.ga4?.allowedProperties || [] }];
    }
    return [];
}
