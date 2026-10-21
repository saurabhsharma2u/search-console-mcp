import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    extractHost,
    selectSiteProperty,
    resolveSiteProperty,
    resolveSitePropertyOrFallback,
    ResolutionError,
} from '../src/common/auth/resolver.js';

vi.mock('../src/common/auth/config.js', () => ({
    loadConfig: vi.fn(),
}));

vi.mock('../src/google/tools/sites.js', () => ({
    listSites: vi.fn().mockResolvedValue([]),
}));

import { loadConfig } from '../src/common/auth/config.js';
import { listSites } from '../src/google/tools/sites.js';

/**
 * Each mocked account gets a fresh id: the GSC authorized-sites module-level
 * cache in resolver.ts is keyed by accountId (5 min TTL), so a shared id would
 * leak one test's listSites() result into the next test.
 */
let accountCounter = 0;

function mockAccount(websites: string[], engine: 'google' | 'bing' = 'google') {
    const id = `acc-${++accountCounter}`;
    vi.mocked(loadConfig).mockResolvedValue({
        accounts: {
            [id]: { id, engine, alias: 'Acc', websites },
        },
    } as any);
    return id;
}

/** The issue #110 account shape: shared hostname across property types. */
const ISSUE_CANDIDATES = [
    'https://example.com/',
    'sc-domain:example.com',
    'https://example.com/en-gb/',
    'https://example.com/de-de/',
    'https://hosting.example.com/',
];

describe('extractHost', () => {
    it('keeps the host for every property type but never the path or port', () => {
        expect(extractHost('https://example.com/en-gb/')).toBe('example.com');
        expect(extractHost('sc-domain:Example.com')).toBe('example.com');
        expect(extractHost('example.com:8080')).toBe('example.com');
    });
});

describe('selectSiteProperty (issue #110)', () => {
    it('exact match: sc-domain input returns the domain property, never a URL-prefix sibling', () => {
        // Pre-fix behavior: loose host matching returned the first host-colliding entry ('https://example.com/').
        expect(selectSiteProperty('sc-domain:example.com', ISSUE_CANDIDATES)).toBe('sc-domain:example.com');
    });

    it('exact match: root input returns the root property, not the domain property', () => {
        expect(selectSiteProperty('https://example.com/', ISSUE_CANDIDATES)).toBe('https://example.com/');
    });

    it('exact match: a locale subfolder only ever resolves to itself', () => {
        expect(selectSiteProperty('https://example.com/en-gb/', ISSUE_CANDIDATES)).toBe('https://example.com/en-gb/');
        expect(selectSiteProperty('https://example.com/de-de/', ISSUE_CANDIDATES)).toBe('https://example.com/de-de/');
    });

    it('exact match is path-case sensitive (GSC URL prefixes are)', () => {
        const candidates = ['https://example.com/Shop/', 'https://example.com/shop/'];
        expect(selectSiteProperty('https://example.com/Shop/', candidates)).toBe('https://example.com/Shop/');
        expect(selectSiteProperty('https://EXAMPLE.com/shop/', candidates)).toBe('https://example.com/shop/');
    });

    it('bare domain ranks deterministically: sc-domain > https root > http root', () => {
        expect(selectSiteProperty('example.com', ISSUE_CANDIDATES)).toBe('sc-domain:example.com');
        expect(selectSiteProperty('example.com', ['https://example.com/', 'http://example.com/'])).toBe('https://example.com/');
        expect(selectSiteProperty('example.com', ['http://example.com/'])).toBe('http://example.com/');
    });

    it('subdomain and parent domain never resolve to each other, in either direction', () => {
        const candidates = ['https://hosting.example.com/', 'sc-domain:example.com'];
        expect(selectSiteProperty('hosting.example.com', candidates)).toBe('https://hosting.example.com/');
        // 'example.com' has no same-HTTP-host candidate and no domain property for example.com — undefined.
        expect(selectSiteProperty('sc-domain:example.com', ['https://hosting.example.com/'])).toBeUndefined();
    });

    it('bare domain with only locale-subfolder properties throws AMBIGUOUS listing the candidates', () => {
        let thrown: ResolutionError | undefined;
        try {
            selectSiteProperty('example.com', ['https://example.com/en-gb/', 'https://example.com/de-de/']);
        } catch (e) {
            thrown = e as ResolutionError;
        }
        expect(thrown?.code).toBe('AMBIGUOUS');
        expect(thrown?.message).toContain('https://example.com/en-gb/');
    });

    it('typed input with no exact match returns undefined instead of guessing (fallback, not throw)', () => {
        expect(selectSiteProperty('https://example.com/some-path/', ['sc-domain:example.com'])).toBeUndefined();
        expect(selectSiteProperty('https://unrelated.com/', ISSUE_CANDIDATES)).toBeUndefined();
    });

    it('regression: 20+ locale subfolders + root + domain property (the full #110 shape)', () => {
        const locales = ['en-gb', 'de-de', 'fr-fr', 'es-es', 'it-it', 'pt-pt', 'nl-nl', 'ja-jp', 'zh-cn', 'ko-kr',
            'ru-ru', 'pl-pl', 'sv-se', 'da-dk', 'fi-fi', 'nb-no', 'tr-tr', 'ar-sa', 'he-il', 'el-gr'];
        const candidates = ['https://example.com/', 'sc-domain:example.com', 'https://hosting.example.com/',
            ...locales.map(l => `https://example.com/${l}/`)];

        expect(selectSiteProperty('sc-domain:example.com', candidates)).toBe('sc-domain:example.com');
        expect(selectSiteProperty('https://example.com/', candidates)).toBe('https://example.com/');
        expect(selectSiteProperty('https://example.com/en-gb/', candidates)).toBe('https://example.com/en-gb/');
        expect(selectSiteProperty('https://hosting.example.com/', candidates)).toBe('https://hosting.example.com/');
        expect(selectSiteProperty('example.com', candidates)).toBe('sc-domain:example.com');
        // hosting.example.com has its own same-host root property, so it resolves to that,
        // never to a candidate under 'example.com'.
        expect(selectSiteProperty('hosting.example.com', candidates)).toBe('https://hosting.example.com/');
    });
});

describe('resolveSiteProperty with the new selector', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('step 1 (account.websites): exact-type match wins over host collision', async () => {
        const id = mockAccount(['https://example.com/', 'sc-domain:example.com', 'https://example.com/en-gb/']);
        const result = await resolveSiteProperty('sc-domain:example.com', 'google');
        expect(result.account.id).toBe(id);
        expect(result.siteUrl).toBe('sc-domain:example.com');
    });

    it('step 1 (Bing): a matched sc-domain property is converted to https://host/', async () => {
        mockAccount(['sc-domain:example.com'], 'bing');
        const result = await resolveSiteProperty('sc-domain:example.com', 'bing');
        expect(result.siteUrl).toBe('https://example.com/');
    });

    it('step 2 (live GSC listing): resolving the domain property returns the domain property', async () => {
        const id = mockAccount([]);
        vi.mocked(listSites).mockResolvedValue(ISSUE_CANDIDATES.map(s => ({ siteUrl: s })) as any);
        const result = await resolveSiteProperty('sc-domain:example.com', 'google');
        expect(result.account.id).toBe(id);
        expect(result.siteUrl).toBe('sc-domain:example.com');
    });

    it('step 2: locale subfolder resolves only to itself against the live listing', async () => {
        mockAccount([]);
        vi.mocked(listSites).mockResolvedValue([
            { siteUrl: 'https://example.com/en-gb/' },
            { siteUrl: 'https://example.com/' },
        ] as any);
        const result = await resolveSiteProperty('https://example.com/en-gb/', 'google');
        expect(result.siteUrl).toBe('https://example.com/en-gb/');
    });

    it('step 2: bare domain with only locale subfolders throws AMBIGUOUS', async () => {
        mockAccount([]);
        vi.mocked(listSites).mockResolvedValue([
            { siteUrl: 'https://example.com/en-gb/' },
            { siteUrl: 'https://example.com/de-de/' },
        ] as any);
        await expect(resolveSiteProperty('example.com', 'google')).rejects.toMatchObject({ code: 'AMBIGUOUS' });
    });

    it('bare domain still hits the sc-domain fallback when nothing matches at all', async () => {
        mockAccount([]);
        vi.mocked(listSites).mockResolvedValue([{ siteUrl: 'https://unrelated.com/' }] as any);
        const result = await resolveSiteProperty('example.com', 'google');
        expect(result.siteUrl).toBe('sc-domain:example.com');
    });
});

describe('resolveSitePropertyOrFallback', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns the resolved property on success', async () => {
        mockAccount(['https://example.com/', 'sc-domain:example.com']);
        const result = await resolveSitePropertyOrFallback('sc-domain:example.com', 'google');
        expect(result).toBe('sc-domain:example.com');
    });

    it('re-throws AMBIGUOUS instead of swallowing it (a wrong-property query must not degrade silently)', async () => {
        mockAccount(['https://example.com/en-gb/', 'https://example.com/de-de/']);
        await expect(resolveSitePropertyOrFallback('example.com', 'google')).rejects.toMatchObject({ code: 'AMBIGUOUS' });
    });

    it('falls back to the raw input for operational failures (historic catch behavior)', async () => {
        // Boundary account that does not cover the site, no global account:
        // resolveAccount throws FORBIDDEN, which must still fall back to raw input.
        mockAccount(['sc-domain:other.com'], 'bing');
        const result = await resolveSitePropertyOrFallback('https://totally-unrelated.com/', 'bing');
        expect(result).toBe('https://totally-unrelated.com/');
    });
});
