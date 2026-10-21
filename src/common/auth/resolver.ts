import { AccountConfig, loadConfig, EngineType } from './config.js';

export interface ResolutionError extends Error {
    code: 'FORBIDDEN' | 'AMBIGUOUS' | 'NOT_FOUND';
    resolution?: {
        command: string;
    };
}

const PROTOCOL_REGEX = /^https?:\/\//i;
const websiteNormCache = new Map<string, { type: 'domain' | 'url-prefix'; value: string }>();
const canonicalKeyCache = new Map<string, string>();

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
 * Canonical comparison key for a domain, URL prefix, or `sc-domain:` string.
 *
 * Unlike {@link normalizeWebsite} (which lowercases the ENTIRE value), this
 * lowercase is applied selectively:
 * - `sc-domain:` → type-tagged (`sc-domain:<host>`), fully lowercased
 * - URL prefix    → lowercased scheme+host, path case PRESERVED, trailing
 *   slashes stripped (GSC URL-prefix paths are case-sensitive, and
 *   `https://example.com/Shop/` and `https://example.com/shop/` are distinct
 *   properties)
 * - bare domain   → lowercased host, port stripped
 *
 * Because the key is type-tagged, a `sc-domain:` property can never compare
 * equal to a URL-prefix or bare-domain string of the same host.
 */
function canonicalPropertyKey(site: string): string {
    if (!site) return '';
    const cached = canonicalKeyCache.get(site);
    if (cached !== undefined) return cached;

    const trimmed = site.trim();
    const lower = trimmed.toLowerCase();
    let key: string;

    if (lower.startsWith('sc-domain:')) {
        key = 'sc-domain:' + lower.substring(10).trim().replace(/\/+$/, '');
    } else {
        const m = /^([a-z]+:\/\/)([^/]*)(\/?.*)$/i.exec(trimmed);
        if (m) {
            key = m[1].toLowerCase() + m[2].toLowerCase() + m[3].replace(/\/+$/, '');
        } else if (trimmed.includes('/')) {
            // Scheme-less prefix, e.g. "example.com/shop"
            const slashIdx = trimmed.indexOf('/');
            key = trimmed.substring(0, slashIdx).toLowerCase() + trimmed.substring(slashIdx).replace(/\/+$/, '');
        } else {
            key = extractHost(trimmed);
        }
    }

    if (canonicalKeyCache.size < 500) {
        canonicalKeyCache.set(site, key);
    }
    return key;
}

/**
 * Selects the single best-matching registered property from `candidates` for a
 * caller-supplied `target` (bare domain, URL prefix, or `sc-domain:` string).
 *
 * Rules, in order:
 *
 * 1. **Exact match** — canonical comparison that preserves property type and
 *    URL-prefix path case ({@link canonicalPropertyKey}). An exact match is
 *    returned verbatim, so asking for `sc-domain:example.com` never resolves to
 *    a URL-prefix sibling, and a locale-subfolder property only matches itself.
 *
 * 2. **Fuzzy match, only for bare-domain input** (`example.com` — no protocol,
 *    `sc-domain:` prefix, or path). Candidates sharing the target host EXACTLY
 *    (no subdomain matching in either direction — `hosting.example.com` never
 *    matches `example.com`) are ranked deterministically:
 *    `sc-domain:<host>` > `https://<host>/` > `http://<host>/`.
 *    If same-host candidates exist but none is a domain or root property
 *    (e.g. only locale subfolders), the choice is ambiguous: this throws a
 *    {@link ResolutionError} with code `'AMBIGUOUS'` listing the candidates
 *    instead of silently picking one and returning another property's data.
 *
 * 3. Anything else (a typed input with no exact match, or a bare domain with no
 *    same-host candidate) returns `undefined` — callers fall back to their own
 *    defaults rather than guessing across property types (issue #110).
 */
export function selectSiteProperty(target: string, candidates: string[]): string | undefined {
    if (!target || !candidates || candidates.length === 0) return undefined;

    const targetKey = canonicalPropertyKey(target);
    if (!targetKey) return undefined;

    // 1. Exact match
    for (const candidate of candidates) {
        if (candidate && canonicalPropertyKey(candidate) === targetKey) {
            return candidate;
        }
    }

    // 2. Fuzzy match only applies to bare-domain input. A typed target
    //    (URL prefix or sc-domain:) must match exactly or not at all —
    //    guessing across property types is what caused issue #110.
    const lowerTarget = target.trim().toLowerCase();
    if (lowerTarget.startsWith('sc-domain:') || PROTOCOL_REGEX.test(target) || target.includes('/')) {
        return undefined;
    }

    const targetHost = extractHost(target);
    if (!targetHost) return undefined;

    const sameHost = candidates.filter(c => c && extractHost(c) === targetHost);
    if (sameHost.length === 0) return undefined;

    const domainProperty = sameHost.find(c =>
        canonicalPropertyKey(c) === `sc-domain:${targetHost}`
    );
    if (domainProperty) return domainProperty;

    const httpsRoot = sameHost.find(c => canonicalPropertyKey(c) === `https://${targetHost}`);
    if (httpsRoot) return httpsRoot;

    const httpRoot = sameHost.find(c => canonicalPropertyKey(c) === `http://${targetHost}`);
    if (httpRoot) return httpRoot;

    // Same host, but every candidate is a non-root URL prefix (locale
    // subfolders, path-scoped properties) — refuse to guess.
    const error = new Error(
        `Ambiguous site '${target}': ${sameHost.length} registered properties share the host '${targetHost}' ` +
        `and none of them is a domain or root property: ${sameHost.join(', ')}. ` +
        `Pass the exact property string instead (e.g. "sc-domain:${targetHost}" or a specific URL prefix).`
    ) as ResolutionError;
    error.code = 'AMBIGUOUS';
    throw error;
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

    // 1. Look for the exact registered property string in account.websites.
    //    selectSiteProperty never guesses across property types (issue #110)
    //    and throws AMBIGUOUS for a bare domain colliding with non-root
    //    properties instead of silently picking one.
    if (account.websites && account.websites.length > 0 && targetHost) {
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
 * Call-site wrapper around {@link resolveSiteProperty} that preserves the
 * historic `.catch(() => ({ siteUrl }))` behavior for operational failures
 * (no account configured, site outside an account boundary, GSC listing
 * errors): the raw `siteUrl` is returned unchanged, exactly as the swallow
 * previously did.
 *
 * The one exception is a `ResolutionError` with code `'AMBIGUOUS'`: resolution
 * found a host collision and deliberately refused to guess (issue #110) —
 * swallowing it would send the raw, unresolved property string to the API and
 * hide the actionable message from the user, so it is re-thrown instead.
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
