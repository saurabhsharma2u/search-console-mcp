import { AccountConfig, loadConfig, EngineType } from './config.js';

export interface ResolutionError extends Error {
    code: 'FORBIDDEN' | 'AMBIGUOUS' | 'NOT_FOUND';
    resolution?: {
        command: string;
    };
}

const PROTOCOL_REGEX = /^https?:\/\//i;
const websiteNormCache = new Map<string, { type: 'domain' | 'url-prefix'; value: string }>();

/**
 * Extracts normalized hostname from any domain, URL prefix, or sc-domain: string.
 */
export function extractHost(site: string): string {
    if (!site) return '';
    let clean = site.trim().toLowerCase();
    if (clean.startsWith('sc-domain:')) {
        clean = clean.substring(10);
    }
    clean = clean.replace(PROTOCOL_REGEX, '');
    const slashIdx = clean.indexOf('/');
    if (slashIdx !== -1) {
        clean = clean.substring(0, slashIdx);
    }
    const colonIdx = clean.indexOf(':');
    if (colonIdx !== -1) {
        clean = clean.substring(0, colonIdx);
    }
    return clean;
}

/**
 * Normalizes a website or domain string for comparison.
 */
export function normalizeWebsite(site: string): { type: 'domain' | 'url-prefix'; value: string } {
    let cached = websiteNormCache.get(site);
    if (cached) return cached;

    let value = site.toLowerCase().trim();

    // Strip common protocols for normalization
    const isUrlPrefix = PROTOCOL_REGEX.test(value) || value.includes('/');

    // Handle trailing slashes
    if (value.endsWith('/')) {
        value = value.slice(0, -1);
    }

    if (!isUrlPrefix && !value.startsWith('sc-domain:')) {
        // It's a domain
        cached = { type: 'domain', value: value.replace(PROTOCOL_REGEX, '') };
    } else {
        cached = { type: 'url-prefix', value };
    }

    if (websiteNormCache.size < 500) {
        websiteNormCache.set(site, cached);
    }
    return cached;
}

/**
 * Resolves the best account for a given siteUrl and engine.
 */
export async function resolveAccount(siteUrl: string, engine: EngineType): Promise<AccountConfig> {
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

    // 2. Host / Domain Match (Matches any domain, URL prefix, or sc-domain: format)
    const targetHost = extractHost(siteUrl);
    if (targetHost) {
        const domainMatch = accounts.find(a =>
            a.websites?.some(w => {
                const wHost = extractHost(w);
                return wHost && (targetHost === wHost || targetHost.endsWith('.' + wHost) || wHost.endsWith('.' + targetHost));
            })
        );
        if (domainMatch) return domainMatch;
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

/**
 * Selects the single best-matching registered property string from `candidates`
 * for a caller-supplied `target` (a domain, URL prefix, or `sc-domain:` string).
 *
 * Matching rules, in order:
 *
 * 1. Exact match. Both sides are run through {@link normalizeWebsite} (case,
 *    trailing slash) and compared. An exact match is returned verbatim, so a
 *    `sc-domain:` property can never resolve to a URL-prefix property (or vice
 *    versa) when the caller already named the exact property string, and a
 *    URL-prefix property with a path (e.g. `https://example.com/en-gb/`) only
 *    ever resolves to itself.
 *
 * 2. Fuzzy match, ONLY when `target` is a bare domain (no protocol, no
 *    `sc-domain:` prefix, no path — e.g. `example.com`). Candidates whose host
 *    (via {@link extractHost}) equals the target host EXACTLY are considered
 *    (no subdomain-suffix matching in either direction: `hosting.example.com`
 *    never matches `example.com`). Among same-host candidates, preference is:
 *    `sc-domain:<host>` > `https://<host>/` (root) > `http://<host>/` (root).
 *    If same-host candidates exist but none of them are a domain property or a
 *    root URL-prefix property (e.g. only locale-subfolder properties like
 *    `https://example.com/en-gb/` and `https://example.com/de-de/`), the match
 *    is ambiguous: this throws a {@link ResolutionError} with code
 *    `'AMBIGUOUS'` listing the candidates and telling the caller to pass the
 *    full property string instead.
 *
 * 3. Anything else (protocol-qualified or `sc-domain:`-prefixed input with no
 *    exact match, or a bare domain with no same-host candidate at all) returns
 *    `undefined` — callers should not guess across property types and should
 *    fall back to their own default behavior.
 */
export function selectSiteProperty(target: string, candidates: string[]): string | undefined {
    if (!target || !candidates || candidates.length === 0) return undefined;

    const normalizedTarget = normalizeWebsite(target);

    // 1. Exact match — compare normalized values so type/path are preserved.
    for (const candidate of candidates) {
        if (normalizeWebsite(candidate).value === normalizedTarget.value) {
            return candidate;
        }
    }

    // 2. Fuzzy match only applies to bare-domain input (no protocol/path/sc-domain:).
    if (normalizedTarget.type !== 'domain') {
        return undefined;
    }

    const targetHost = extractHost(target);
    if (!targetHost) return undefined;

    const sameHost = candidates.filter(c => extractHost(c) === targetHost);
    if (sameHost.length === 0) return undefined;

    const domainProperty = sameHost.find(c => normalizeWebsite(c).value === `sc-domain:${targetHost}`);
    if (domainProperty) return domainProperty;

    const httpsRoot = sameHost.find(c => normalizeWebsite(c).value === `https://${targetHost}`);
    if (httpsRoot) return httpsRoot;

    const httpRoot = sameHost.find(c => normalizeWebsite(c).value === `http://${targetHost}`);
    if (httpRoot) return httpRoot;

    // Same host, but only non-root URL-prefix properties (e.g. locale subfolders) — ambiguous.
    const error = new Error(
        `Ambiguous site '${target}': multiple properties match this domain (${sameHost.join(', ')}). ` +
        `Pass the full property string (e.g. "sc-domain:${targetHost}" or a specific URL-prefix property) instead.`
    ) as ResolutionError;
    error.code = 'AMBIGUOUS';
    throw error;
}

const gscSitesCache = new Map<string, { sites: string[]; timestamp: number }>();

async function getGoogleAuthorizedSites(accountId?: string): Promise<string[]> {
    const key = accountId || 'default';
    const cached = gscSitesCache.get(key);
    if (cached && Date.now() - cached.timestamp < 300000) {
        return cached.sites;
    }
    try {
        const { listSites } = await import('../../google/tools/sites.js');
        const siteEntries = await listSites(accountId);
        const sites = siteEntries.map(s => s.siteUrl).filter(Boolean) as string[];
        gscSitesCache.set(key, { sites, timestamp: Date.now() });
        return sites;
    } catch {
        return [];
    }
}

/**
 * Result of resolving an account and its engine-specific site property identifier.
 */
export interface ResolvedSiteProperty {
    account: AccountConfig;
    siteUrl: string;
}

/**
 * Resolves both the AccountConfig AND the engine-specific registered property identifier.
 *
 * Uses {@link selectSiteProperty} against `account.websites` (step 1) and then, for
 * Google, against the live list of authorized GSC properties (step 2) — see its doc
 * comment for the exact/fuzzy matching rules and the AMBIGUOUS error it can throw.
 * Neither step guesses across property types (a `sc-domain:` input will never be
 * satisfied by a URL-prefix candidate or vice versa) unless the input is a bare
 * domain, in which case same-host candidates are ranked deterministically.
 *
 * For example:
 * Input "example.com" for Google  -> { account, siteUrl: "sc-domain:example.com" }
 * Input "sc-domain:example.com" for Bing -> { account, siteUrl: "https://example.com/" }
 */
export async function resolveSiteProperty(siteUrl: string, engine: EngineType): Promise<ResolvedSiteProperty> {
    const account = await resolveAccount(siteUrl, engine);
    if (!siteUrl) {
        return { account, siteUrl };
    }

    const targetHost = extractHost(siteUrl);

    // 1. Look for exact/fuzzy registered property string in account.websites
    if (account.websites && account.websites.length > 0) {
        const matchingWebsite = selectSiteProperty(siteUrl, account.websites);

        if (matchingWebsite) {
            let finalUrl = matchingWebsite;
            if (engine === 'bing' && finalUrl.startsWith('sc-domain:')) {
                finalUrl = 'https://' + finalUrl.substring(10) + '/';
            }
            return { account, siteUrl: finalUrl };
        }
    }

    // 2. Dynamic GSC site listing lookup for Google if not in account.websites list
    if (engine === 'google' && targetHost) {
        const authorizedSites = await getGoogleAuthorizedSites(account.id);
        if (authorizedSites.length > 0) {
            const matchedSite = selectSiteProperty(siteUrl, authorizedSites);
            if (matchedSite) {
                return { account, siteUrl: matchedSite };
            }
        }

        // Default domain format fallback for Google if bare domain passed
        if (!siteUrl.startsWith('sc-domain:') && !siteUrl.includes('://')) {
            return { account, siteUrl: `sc-domain:${targetHost}` };
        }
    }

    // 3. Fallback normalization if not directly matched
    let fallbackUrl = siteUrl;
    if (engine === 'bing' && fallbackUrl.startsWith('sc-domain:')) {
        fallbackUrl = 'https://' + fallbackUrl.substring(10) + '/';
    }

    return { account, siteUrl: fallbackUrl };
}

/**
 * Convenience wrapper around {@link resolveSiteProperty} for call sites that only need
 * the resolved property string and want today's historic fallback behavior: if resolution
 * fails for an operational reason (no account found, the site isn't in any account's
 * authorized boundary, a network/API error listing GSC properties, etc.) the raw `siteUrl`
 * is returned unchanged, exactly like the `.catch(() => ({ siteUrl }))` pattern these call
 * sites used before.
 *
 * The one exception is a `ResolutionError` with `code === 'AMBIGUOUS'`: that error means
 * {@link selectSiteProperty} found multiple candidate properties and deliberately refused to
 * guess, with a message telling the caller which property string to pass instead. Swallowing
 * it would silently send the wrong (raw, unresolved) site to the API and hide that message
 * from the user, so it is re-thrown instead of falling back.
 */
export async function resolveSitePropertyOrFallback(siteUrl: string, engine: EngineType): Promise<string> {
    try {
        const { siteUrl: resolved } = await resolveSiteProperty(siteUrl, engine);
        return resolved;
    } catch (err) {
        if ((err as ResolutionError)?.code === 'AMBIGUOUS') {
            throw err;
        }
        return siteUrl;
    }
}

/**
 * Resolves a given URL into a valid public HTTPS web URL.
 *
 * For example:
 * "sc-domain:example.com/blog/page-1" -> "https://example.com/blog/page-1"
 * "example.com/blog"                  -> "https://example.com/blog"
 * "https://example.com/blog"          -> "https://example.com/blog"
 */
export function resolveFullWebUrl(url: string): string {
    if (!url) return '';
    let clean = url.trim();
    if (clean.startsWith('sc-domain:')) {
        clean = clean.substring(10);
    }
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
        clean = 'https://' + clean;
    }
    return clean;
}
