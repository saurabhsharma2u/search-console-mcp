import { describe, it, expect, vi, beforeEach } from 'vitest';
import { selectSiteProperty, resolveSiteProperty, resolveSitePropertyOrFallback, ResolutionError } from './resolver.js';
import { loadConfig } from './config.js';

vi.mock('./config.js', async () => {
    const actual = await vi.importActual('./config.js');
    return {
        ...(actual as any),
        loadConfig: vi.fn(),
    };
});

vi.mock('../../google/tools/sites.js', () => ({
    listSites: vi.fn().mockResolvedValue([]),
}));

import { listSites } from '../../google/tools/sites.js';

let accountCounter = 0;

function mockConfigWithWebsites(websites: string[], engine: 'google' | 'bing' = 'google') {
    // Each call gets a fresh account id: resolveSiteProperty's step-2 GSC site
    // listing is cached per-accountId at module scope (5 min TTL), and a shared
    // id would let one test's listSites() mock leak into the next test's result.
    const id = `acc-${++accountCounter}`;
    vi.mocked(loadConfig).mockResolvedValue({
        accounts: {
            [id]: {
                id,
                engine,
                alias: 'Acc',
                websites,
            },
        },
    } as any);
}

describe('selectSiteProperty', () => {
    const issueScenarioCandidates = [
        'https://example.com/',
        'sc-domain:example.com',
        'https://hosting.example.com/',
        ...['en-gb', 'de-de', 'fr-fr', 'es-es', 'it-it', 'pt-pt', 'nl-nl', 'ja-jp', 'zh-cn', 'ko-kr',
            'ru-ru', 'pl-pl', 'sv-se', 'da-dk', 'fi-fi', 'nb-no', 'tr-tr', 'ar-sa', 'he-il', 'el-gr']
            .map(locale => `https://example.com/${locale}/`),
    ];

    it('exact match: sc-domain input returns the domain property even when URL-prefix siblings exist', () => {
        const result = selectSiteProperty('sc-domain:example.com', [
            'https://example.com/',
            'sc-domain:example.com',
            'https://example.com/en-gb/',
        ]);
        expect(result).toBe('sc-domain:example.com');
    });

    it('exact match: https root input returns the URL-prefix root property, not the domain property', () => {
        const result = selectSiteProperty('https://example.com/', [
            'https://example.com/',
            'sc-domain:example.com',
            'https://example.com/en-gb/',
        ]);
        expect(result).toBe('https://example.com/');
    });

    it('exact match: a locale-subfolder property never resolves to root or the domain property', () => {
        const candidates = ['https://example.com/', 'sc-domain:example.com', 'https://example.com/en-gb/'];
        expect(selectSiteProperty('https://example.com/en-gb/', candidates)).toBe('https://example.com/en-gb/');
        // reverse: matching root/domain input never returns the subfolder property
        expect(selectSiteProperty('https://example.com/', candidates)).not.toBe('https://example.com/en-gb/');
        expect(selectSiteProperty('sc-domain:example.com', candidates)).not.toBe('https://example.com/en-gb/');
    });

    it('bare domain: prefers sc-domain: over https root when both exist', () => {
        const result = selectSiteProperty('example.com', [
            'https://example.com/',
            'sc-domain:example.com',
            'http://example.com/',
        ]);
        expect(result).toBe('sc-domain:example.com');
    });

    it('bare domain: falls back to https root when no domain property exists', () => {
        const result = selectSiteProperty('example.com', [
            'https://example.com/',
            'http://example.com/',
        ]);
        expect(result).toBe('https://example.com/');
    });

    it('never cross-resolves a subdomain and its parent domain in either direction', () => {
        const candidates = ['https://hosting.example.com/', 'sc-domain:example.com'];
        expect(selectSiteProperty('hosting.example.com', candidates)).toBe('https://hosting.example.com/');
        expect(selectSiteProperty('example.com', candidates)).toBe('sc-domain:example.com');
    });

    it('bare domain with only locale-subfolder properties throws AMBIGUOUS listing the candidates', () => {
        const candidates = ['https://example.com/en-gb/', 'https://example.com/de-de/'];
        let thrown: ResolutionError | undefined;
        try {
            selectSiteProperty('example.com', candidates);
        } catch (e) {
            thrown = e as ResolutionError;
        }
        expect(thrown).toBeDefined();
        expect(thrown!.code).toBe('AMBIGUOUS');
        expect(thrown!.message).toContain('https://example.com/en-gb/');
        expect(thrown!.message).toContain('https://example.com/de-de/');
    });

    it('unmatched input returns undefined (caller falls back)', () => {
        expect(selectSiteProperty('https://unrelated.com/', ['sc-domain:example.com'])).toBeUndefined();
        expect(selectSiteProperty('sc-domain:unrelated.com', ['sc-domain:example.com'])).toBeUndefined();
    });

    it('protocol/sc-domain input with no exact match does not guess across property types', () => {
        // Bare-domain fuzzy matching does not apply to protocol-qualified or sc-domain: input.
        const candidates = ['sc-domain:example.com'];
        expect(selectSiteProperty('https://example.com/some-path/', candidates)).toBeUndefined();
    });

    it('regression: 20+ properties sharing a hostname (issue #110 scenario) resolves deterministically', () => {
        expect(selectSiteProperty('sc-domain:example.com', issueScenarioCandidates)).toBe('sc-domain:example.com');
        expect(selectSiteProperty('https://example.com/', issueScenarioCandidates)).toBe('https://example.com/');
        expect(selectSiteProperty('https://hosting.example.com/', issueScenarioCandidates)).toBe('https://hosting.example.com/');
        expect(selectSiteProperty('https://example.com/en-gb/', issueScenarioCandidates)).toBe('https://example.com/en-gb/');
        expect(selectSiteProperty('example.com', issueScenarioCandidates)).toBe('sc-domain:example.com');
    });
});

describe('resolveSiteProperty', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('step 1: account.websites', () => {
        it('exact sc-domain input resolves to the domain property, not a URL-prefix sibling', async () => {
            mockConfigWithWebsites(['https://example.com/', 'sc-domain:example.com', 'https://example.com/en-gb/']);
            const result = await resolveSiteProperty('sc-domain:example.com', 'google');
            expect(result.siteUrl).toBe('sc-domain:example.com');
        });

        it('exact locale-subfolder input resolves only to itself', async () => {
            mockConfigWithWebsites(['https://example.com/', 'sc-domain:example.com', 'https://example.com/en-gb/']);
            const result = await resolveSiteProperty('https://example.com/en-gb/', 'google');
            expect(result.siteUrl).toBe('https://example.com/en-gb/');
        });

        it('bare domain prefers sc-domain: over URL-prefix root', async () => {
            mockConfigWithWebsites(['https://example.com/', 'sc-domain:example.com']);
            const result = await resolveSiteProperty('example.com', 'google');
            expect(result.siteUrl).toBe('sc-domain:example.com');
        });

        it('hosting.example.com and example.com never resolve to each other', async () => {
            mockConfigWithWebsites(['https://hosting.example.com/', 'sc-domain:example.com']);
            const hostingResult = await resolveSiteProperty('hosting.example.com', 'google');
            expect(hostingResult.siteUrl).toBe('https://hosting.example.com/');

            const domainResult = await resolveSiteProperty('example.com', 'google');
            expect(domainResult.siteUrl).toBe('sc-domain:example.com');
        });

        it('bare domain with only locale-subfolder properties throws AMBIGUOUS', async () => {
            mockConfigWithWebsites(['https://example.com/en-gb/', 'https://example.com/de-de/']);
            await expect(resolveSiteProperty('example.com', 'google')).rejects.toMatchObject({ code: 'AMBIGUOUS' });
        });

        it('Bing: a matched sc-domain: property is converted to https://host/', async () => {
            mockConfigWithWebsites(['sc-domain:example.com'], 'bing');
            const result = await resolveSiteProperty('sc-domain:example.com', 'bing');
            expect(result.siteUrl).toBe('https://example.com/');
        });

        it('unmatched input for a global (unrestricted) account falls through unchanged', async () => {
            // Global account (no websites boundary) so resolveAccount succeeds regardless
            // of siteUrl; selectSiteProperty then has no candidates to match against.
            mockConfigWithWebsites([], 'bing');
            const result = await resolveSiteProperty('https://totally-unrelated.com/', 'bing');
            expect(result.siteUrl).toBe('https://totally-unrelated.com/');
        });
    });

    describe('step 2: Google authorized sites listing', () => {
        it('exact match against live GSC sites resolves to the domain property, not a URL-prefix sibling', async () => {
            mockConfigWithWebsites([], 'google');
            vi.mocked(listSites).mockResolvedValue([
                { siteUrl: 'https://example.com/' },
                { siteUrl: 'sc-domain:example.com' },
                { siteUrl: 'https://example.com/en-gb/' },
            ] as any);
            const result = await resolveSiteProperty('sc-domain:example.com', 'google');
            expect(result.siteUrl).toBe('sc-domain:example.com');
        });

        it('locale-subfolder input against live GSC sites resolves only to itself', async () => {
            mockConfigWithWebsites([], 'google');
            vi.mocked(listSites).mockResolvedValue([
                { siteUrl: 'https://example.com/' },
                { siteUrl: 'sc-domain:example.com' },
                { siteUrl: 'https://example.com/en-gb/' },
            ] as any);
            const result = await resolveSiteProperty('https://example.com/en-gb/', 'google');
            expect(result.siteUrl).toBe('https://example.com/en-gb/');
        });

        it('bare domain with only locale-subfolder GSC properties throws AMBIGUOUS', async () => {
            mockConfigWithWebsites([], 'google');
            vi.mocked(listSites).mockResolvedValue([
                { siteUrl: 'https://example.com/en-gb/' },
                { siteUrl: 'https://example.com/de-de/' },
            ] as any);
            await expect(resolveSiteProperty('example.com', 'google')).rejects.toMatchObject({ code: 'AMBIGUOUS' });
        });

        it('bare domain with no matching GSC property falls back to the sc-domain: guess', async () => {
            mockConfigWithWebsites([], 'google');
            vi.mocked(listSites).mockResolvedValue([{ siteUrl: 'https://unrelated.com/' }] as any);
            const result = await resolveSiteProperty('example.com', 'google');
            expect(result.siteUrl).toBe('sc-domain:example.com');
        });

        it('hosting.example.com and example.com never resolve to each other via live GSC sites', async () => {
            mockConfigWithWebsites([], 'google');
            vi.mocked(listSites).mockResolvedValue([
                { siteUrl: 'https://hosting.example.com/' },
                { siteUrl: 'sc-domain:example.com' },
            ] as any);
            const hostingResult = await resolveSiteProperty('hosting.example.com', 'google');
            expect(hostingResult.siteUrl).toBe('https://hosting.example.com/');

            const domainResult = await resolveSiteProperty('example.com', 'google');
            expect(domainResult.siteUrl).toBe('sc-domain:example.com');
        });

        it('regression: 20+ properties sharing a hostname (issue #110 scenario) via live GSC sites', async () => {
            mockConfigWithWebsites([], 'google');
            const locales = ['en-gb', 'de-de', 'fr-fr', 'es-es', 'it-it', 'pt-pt', 'nl-nl', 'ja-jp', 'zh-cn', 'ko-kr',
                'ru-ru', 'pl-pl', 'sv-se', 'da-dk', 'fi-fi', 'nb-no', 'tr-tr', 'ar-sa', 'he-il', 'el-gr'];
            vi.mocked(listSites).mockResolvedValue([
                { siteUrl: 'https://example.com/' },
                { siteUrl: 'sc-domain:example.com' },
                { siteUrl: 'https://hosting.example.com/' },
                ...locales.map(locale => ({ siteUrl: `https://example.com/${locale}/` })),
            ] as any);

            expect((await resolveSiteProperty('sc-domain:example.com', 'google')).siteUrl).toBe('sc-domain:example.com');
            expect((await resolveSiteProperty('https://example.com/', 'google')).siteUrl).toBe('https://example.com/');
            expect((await resolveSiteProperty('https://hosting.example.com/', 'google')).siteUrl).toBe('https://hosting.example.com/');
            expect((await resolveSiteProperty('https://example.com/en-gb/', 'google')).siteUrl).toBe('https://example.com/en-gb/');
            expect((await resolveSiteProperty('example.com', 'google')).siteUrl).toBe('sc-domain:example.com');
        });
    });
});

describe('resolveSitePropertyOrFallback', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns the resolved siteUrl on success', async () => {
        mockConfigWithWebsites(['https://example.com/', 'sc-domain:example.com'], 'google');
        const result = await resolveSitePropertyOrFallback('sc-domain:example.com', 'google');
        expect(result).toBe('sc-domain:example.com');
    });

    it('re-throws an AMBIGUOUS ResolutionError instead of swallowing it', async () => {
        mockConfigWithWebsites(['https://example.com/en-gb/', 'https://example.com/de-de/'], 'google');
        await expect(resolveSitePropertyOrFallback('example.com', 'google')).rejects.toMatchObject({ code: 'AMBIGUOUS' });
    });

    it('falls back to the raw siteUrl for non-AMBIGUOUS errors (e.g. FORBIDDEN)', async () => {
        // Boundary account that doesn't cover the requested site, and no global account exists,
        // so resolveAccount throws FORBIDDEN -- that must still fall back to the raw input.
        mockConfigWithWebsites(['sc-domain:other.com'], 'bing');
        const result = await resolveSitePropertyOrFallback('https://totally-unrelated.com/', 'bing');
        expect(result).toBe('https://totally-unrelated.com/');
    });
});
