import { getAdsenseClient } from '../client.js';

const DEFAULT_METRICS = ['ESTIMATED_EARNINGS', 'PAGE_VIEWS', 'IMPRESSIONS', 'CLICKS', 'PAGE_VIEWS_RPM'];

export interface ReportArgs {
    accountId?: string;
    dateRange?: string;
    startDate?: string;
    endDate?: string;
    dimensions?: string[];
    metrics?: string[];
    rowLimit?: number;
    orderBy?: string;
}

function toDateParts(dateStr: string): { year: number; month: number; day: number } {
    const [year, month, day] = dateStr.split('-').map(Number);
    if (!year || !month || !day || month < 1 || month > 12 || day < 1 || day > 31) {
        throw new Error(`Invalid date '${dateStr}'. Use YYYY-MM-DD format.`);
    }
    return { year, month, day };
}

function formatDateParts(parts: { year: number; month: number; day: number }): string {
    return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

/**
 * Generates an AdSense performance/earnings report.
 * Defaults to estimated earnings, page views, impressions, clicks and RPM over the last 7 days.
 */
export async function generateReport(args: ReportArgs) {
    const client = await getAdsenseClient(args.accountId);

    const hasCustomDates = args.startDate !== undefined || args.endDate !== undefined;
    const dateRange = hasCustomDates ? 'CUSTOM' : (args.dateRange ?? 'LAST_7_DAYS');

    if (dateRange === 'CUSTOM' && (!args.startDate || !args.endDate)) {
        throw new Error('CUSTOM dateRange requires both startDate and endDate (YYYY-MM-DD).');
    }

    const params: Record<string, any> = {
        dateRange,
        metrics: args.metrics?.length ? args.metrics : DEFAULT_METRICS,
        limit: Math.min(args.rowLimit ?? 100, 200)
    };

    let startDateStr: string | undefined;
    let endDateStr: string | undefined;

    if (dateRange === 'CUSTOM') {
        const start = toDateParts(args.startDate!);
        const end = toDateParts(args.endDate!);
        params['startDate.year'] = start.year;
        params['startDate.month'] = start.month;
        params['startDate.day'] = start.day;
        params['endDate.year'] = end.year;
        params['endDate.month'] = end.month;
        params['endDate.day'] = end.day;
        startDateStr = formatDateParts(start);
        endDateStr = formatDateParts(end);
    }

    if (args.dimensions?.length) {
        params.dimensions = args.dimensions;
    }
    if (args.orderBy) {
        // Format: "+METRIC_NAME" or "-METRIC_NAME" for descending
        params.orderBy = [args.orderBy];
    }

    const report = await client.generateReport(params as any);

    return {
        publisherId: client.getPublisherId(),
        dateRange,
        ...(startDateStr ? { startDate: startDateStr } : {}),
        ...(endDateStr ? { endDate: endDateStr } : {}),
        headers: (report.headers || []).map(h => h.name),
        rows: (report.rows || []).map(r => (r.cells || []).map(c => c.value ?? '')),
        ...(report.totals && report.totals.cells ? { totals: report.totals.cells.map(c => c.value ?? '') } : {}),
        ...(report.averages && report.averages.cells ? { averages: report.averages.cells.map(c => c.value ?? '') } : {})
    };
}

/**
 * Lists outstanding payments for the AdSense account.
 */
export async function listPayments(accountId?: string) {
    const client = await getAdsenseClient(accountId);
    const payments = await client.listPayments();
    return payments.map(p => ({
        id: p.name,
        date: p.date ? `${p.date.year}-${p.date.month}-${p.date.day}` : undefined,
        amount: p.amount
    }));
}

/**
 * Lists active alerts (policy issues, payment holds, etc.) for the AdSense account.
 */
export async function listAlerts(accountId?: string) {
    const client = await getAdsenseClient(accountId);
    const alerts = await client.listAlerts();
    return alerts.map(a => ({
        id: a.name,
        type: a.type,
        severity: a.severity,
        message: a.message
    }));
}
