import { describe, it, expect } from 'vitest';
import { FLOWS } from '../../src/setup/registry.js';

describe('setup flow registry', () => {
    it('registers all supported engines', () => {
        const ids = FLOWS.map(f => f.id);
        expect(ids).toEqual(['google', 'ga4', 'bing', 'adsense', 'pagespeed']);
    });

    it('has unique ids and complete flow definitions', () => {
        const ids = FLOWS.map(f => f.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const flow of FLOWS) {
            expect(flow.label).toBeTruthy();
            expect(flow.description).toBeTruthy();
            expect(typeof flow.configure).toBe('function');
            expect(typeof flow.isConfigured).toBe('function');
        }
    });

    it('flags optional integrations as advanced', () => {
        const pagespeed = FLOWS.find(f => f.id === 'pagespeed')!;
        expect(pagespeed.advanced).toBe(true);
        expect(FLOWS.filter(f => !f.advanced).map(f => f.id)).toEqual(['google', 'ga4', 'bing', 'adsense']);
    });

    it('evaluates isConfigured against config status', () => {
        const status = {
            googleAccounts: [{ id: 'g1' }],
            bingAccounts: [],
            ga4Accounts: [],
            adsenseAccounts: [],
            legacyBing: true,
            pagespeedApiKey: false,
        };
        const byId = Object.fromEntries(FLOWS.map(f => [f.id, f]));
        expect(byId.google.isConfigured(status)).toBe(true);
        expect(byId.bing.isConfigured(status)).toBe(true); // via legacyBing
        expect(byId.ga4.isConfigured(status)).toBe(false);
        expect(byId.adsense.isConfigured(status)).toBe(false);
        expect(byId.pagespeed.isConfigured(status)).toBe(false);
    });
});
