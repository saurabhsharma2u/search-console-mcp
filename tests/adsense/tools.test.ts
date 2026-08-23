import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateReport, listPayments, listAlerts } from '../../src/adsense/tools/reports.js';
import { getAdsenseClient } from '../../src/adsense/client.js';

vi.mock('../../src/adsense/client.js', () => ({
    getAdsenseClient: vi.fn(),
    AdSenseClient: class {}
}));

const mockGenerate = vi.fn();
const mockListPayments = vi.fn();
const mockListAlerts = vi.fn();

beforeEach(() => {
    vi.clearAllMocks();
    (getAdsenseClient as any).mockResolvedValue({
        getPublisherId: () => 'accounts/pub-123',
        generateReport: mockGenerate,
        listPayments: mockListPayments,
        listAlerts: mockListAlerts
    });
});

describe('generateReport', () => {
    it('applies LAST_7_DAYS default with default metrics', async () => {
        mockGenerate.mockResolvedValue({
            headers: [{ name: 'ESTIMATED_EARNINGS' }],
            rows: [{ cells: [{ value: '12.34' }] }]
        });

        const result = await generateReport({});

        expect(mockGenerate).toHaveBeenCalledWith(expect.objectContaining({
            dateRange: 'LAST_7_DAYS',
            metrics: ['ESTIMATED_EARNINGS', 'PAGE_VIEWS', 'IMPRESSIONS', 'CLICKS', 'PAGE_VIEWS_RPM'],
            limit: 100
        }));
        expect(result.headers).toEqual(['ESTIMATED_EARNINGS']);
        expect(result.rows).toEqual([['12.34']]);
    });

    it('converts CUSTOM dates to flat API params', async () => {
        mockGenerate.mockResolvedValue({ headers: [], rows: [] });

        await generateReport({ startDate: '2026-02-01', endDate: '2026-02-28' });

        expect(mockGenerate).toHaveBeenCalledWith(expect.objectContaining({
            dateRange: 'CUSTOM',
            'startDate.year': 2026,
            'startDate.month': 2,
            'startDate.day': 1,
            'endDate.year': 2026,
            'endDate.month': 2,
            'endDate.day': 28
        }));
    });

    it('rejects CUSTOM without both dates', async () => {
        await expect(generateReport({ startDate: '2026-02-01' })).rejects.toThrow(/requires both startDate and endDate/);
    });

    it('rejects malformed dates', async () => {
        await expect(generateReport({ startDate: 'not-a-date', endDate: '2026-02-01' })).rejects.toThrow(/Invalid date/);
    });

    it('passes dimensions, orderBy, rowLimit and custom metrics through', async () => {
        mockGenerate.mockResolvedValue({ headers: [], rows: [] });

        await generateReport({
            dimensions: ['DATE', 'DOMAIN_NAME'],
            orderBy: '-ESTIMATED_EARNINGS',
            rowLimit: 25,
            metrics: ['CLICKS']
        });

        const call = mockGenerate.mock.calls[0][0];
        expect(call.dimensions).toEqual(['DATE', 'DOMAIN_NAME']);
        expect(call.orderBy).toEqual(['-ESTIMATED_EARNINGS']);
        expect(call.limit).toBe(25);
        expect(call.metrics).toEqual(['CLICKS']);
    });

    it('custom dates override a preset dateRange', async () => {
        mockGenerate.mockResolvedValue({ headers: [], rows: [] });

        await generateReport({ dateRange: 'LAST_7_DAYS', startDate: '2026-02-01', endDate: '2026-02-28' });

        expect(mockGenerate).toHaveBeenCalledWith(expect.objectContaining({
            dateRange: 'CUSTOM',
            'startDate.year': 2026,
            'endDate.day': 28
        }));
    });

    it('includes totals and averages when present', async () => {
        mockGenerate.mockResolvedValue({
            headers: [{ name: 'ESTIMATED_EARNINGS' }],
            rows: [{ cells: [{ value: '1' }] }, { cells: [{}] }],
            totals: { cells: [{ value: '9.99' }] },
            averages: { cells: [{ value: '5' }] }
        });

        const result = await generateReport({});

        expect(result.totals).toEqual(['9.99']);
        expect(result.averages).toEqual(['5']);
        // Missing cell value falls back to empty string
        expect(result.rows[1]).toEqual(['']);
    });
});

describe('listPayments / listAlerts', () => {
    it('maps payment fields', async () => {
        mockListPayments.mockResolvedValue([
            { name: 'accounts/pub-123/payments/1', date: { year: 2026, month: 2, day: 21 }, amount: '$123.45' },
            { name: 'accounts/pub-123/payments/2', amount: '$10.00' }
        ]);

        const payments = await listPayments();

        expect(payments[0]).toEqual({ id: 'accounts/pub-123/payments/1', date: '2026-2-21', amount: '$123.45' });
        expect(payments[1].date).toBeUndefined();
    });

    it('maps alert fields', async () => {
        mockListAlerts.mockResolvedValue([
            { name: 'alerts/1', type: 'POLICY', severity: 'SEVERE', message: 'Policy issue detected' }
        ]);

        const alerts = await listAlerts();

        expect(alerts[0].severity).toBe('SEVERE');
        expect(alerts[0].message).toBe('Policy issue detected');
    });
});
