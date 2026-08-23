import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listProperties } from '../../src/ga4/tools/properties.js';
import * as configModule from '../../src/common/auth/config.js';

// Mock dependencies
vi.mock('../../src/common/auth/config.js', () => ({
    assertServiceAccountKeyReadable: vi.fn(),
    isServiceAccountKeyMissing: vi.fn(() => false),
    loadConfig: vi.fn(),
}));

describe('GA4 Properties Tool', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('listProperties should return configured GA4 properties', async () => {
        (configModule.loadConfig as any).mockResolvedValue({
            accounts: {
                ga4_test_1: {
                    id: 'ga4_test_1',
                    engine: 'ga4',
                    alias: 'GA4 Test Account 1',
                    ga4PropertyId: '123456'
                },
                google_test: {
                    id: 'google_test',
                    engine: 'google',
                    alias: 'Google Account'
                },
                ga4_test_2: {
                    id: 'ga4_test_2',
                    engine: 'ga4',
                    alias: 'GA4 Test Account 2',
                    ga4PropertyId: '789012'
                }
            }
        });

        const properties = await listProperties();
        expect(properties).toHaveLength(2);
        expect(properties[0]).toEqual({
            id: 'ga4_test_1',
            alias: 'GA4 Test Account 1',
            propertyId: '123456',
            siteUrl: '123456'
        });
        expect(properties[1]).toEqual({
            id: 'ga4_test_2',
            alias: 'GA4 Test Account 2',
            propertyId: '789012',
            siteUrl: '789012'
        });
    });

    it('listProperties should filter by accountId if provided', async () => {
        (configModule.loadConfig as any).mockResolvedValue({
            accounts: {
                ga4_test_1: {
                    id: 'ga4_test_1',
                    engine: 'ga4',
                    alias: 'GA4 Test Account 1',
                    ga4PropertyId: '123456',
                    websites: ['123456']
                },
                ga4_test_2: {
                    id: 'ga4_test_2',
                    engine: 'ga4',
                    alias: 'GA4 Test Account 2',
                    ga4PropertyId: '789012',
                    websites: ['789012']
                }
            }
        });

        const properties = await listProperties('ga4_test_2');
        expect(properties).toHaveLength(1);
        expect(properties[0].propertyId).toBe('789012');
    });

    it('listProperties should throw error if accountId not found', async () => {
        (configModule.loadConfig as any).mockResolvedValue({
            accounts: {
                ga4_test_1: {
                    id: 'ga4_test_1',
                    engine: 'ga4',
                    alias: 'GA4 Test Account 1',
                    ga4PropertyId: '123456'
                }
            }
        });

        await expect(listProperties('ga4_invalid')).rejects.toThrow('GA4 account ga4_invalid not found.');
    });
});
