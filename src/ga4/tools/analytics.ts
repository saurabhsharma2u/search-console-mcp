import { getGA4Client } from '../client.js';
import { formatRows } from '../utils.js';

const CACHE_TTL_MS = 60 * 1000; // 60 seconds
const MAX_CACHE_SIZE = 100;

interface CacheValue {
    type: 'resolved';
    data: any;
    timestamp: number;
}

interface CachePending {
    type: 'pending';
    promise: Promise<any>;
}

type CacheEntry = CacheValue | CachePending;

const analyticsCache = new Map<string, CacheEntry>();

export function clearAnalyticsCache() {
    analyticsCache.clear();
}

function generateCacheKey(options: any): string {
    // Recursive stable stringify to handle nested object key ordering
    const sortObject = (obj: any): any => {
        if (obj === null || typeof obj !== 'object') {
            return obj;
        }
        if (Array.isArray(obj)) {
            return obj.map(sortObject);
        }
        const sorted: any = {};
        Object.keys(obj).sort().forEach(key => {
            sorted[key] = sortObject(obj[key]);
        });
        return sorted;
    };
    return JSON.stringify(sortObject(options));
}

export interface GA4AnalyticsOptions {
    propertyId: string;
    accountId?: string;
    startDate?: string;
    endDate?: string;
    dimensions?: string[];
    metrics?: string[];
    dimensionFilter?: any;
    metricFilter?: any;
    limit?: number;
    offset?: number;
    orderBys?: any[];
}

export interface GA4BatchAnalyticsOptions {
    propertyId: string;
    accountId?: string;
    requests: Array<{
        dateRanges?: { startDate: string; endDate: string }[];
        dimensions?: string[];
        metrics?: string[];
        dimensionFilter?: any;
        metricFilter?: any;
        limit?: number;
        offset?: number;
        orderBys?: any[];
    }>;
}

export async function batchQueryAnalytics(options: GA4BatchAnalyticsOptions) {
    const cacheKey = generateCacheKey(options);
    const now = Date.now();
    const cached = analyticsCache.get(cacheKey);

    if (cached) {
        if (cached.type === 'pending') {
            return cached.promise;
        }
        if (now - cached.timestamp < CACHE_TTL_MS) {
            // LRU: Refresh key position
            analyticsCache.delete(cacheKey);
            analyticsCache.set(cacheKey, cached);
            return cached.data;
        }
        analyticsCache.delete(cacheKey);
    }

    const fetchPromise = (async () => {
        try {
            const client = await getGA4Client(options.propertyId, options.accountId);
            const response = await client.batchRunReports({
                requests: options.requests.map(req => ({
                    dateRanges: req.dateRanges,
                    dimensions: req.dimensions?.map(name => ({ name })),
                    metrics: req.metrics?.map(name => ({ name })),
                    dimensionFilter: req.dimensionFilter,
                    metricFilter: req.metricFilter,
                    limit: req.limit,
                    offset: req.offset,
                    orderBys: req.orderBys
                }))
            });

            analyticsCache.set(cacheKey, {
                type: 'resolved',
                data: response,
                timestamp: Date.now()
            });

            if (analyticsCache.size > MAX_CACHE_SIZE) {
                const firstKey = analyticsCache.keys().next().value;
                if (firstKey) analyticsCache.delete(firstKey);
            }

            return response;
        } catch (error) {
            analyticsCache.delete(cacheKey);
            throw error;
        }
    })();

    analyticsCache.set(cacheKey, { type: 'pending', promise: fetchPromise });
    return fetchPromise;
}

export async function queryAnalytics(options: GA4AnalyticsOptions) {
    const cacheKey = generateCacheKey(options);
    const now = Date.now();
    const cached = analyticsCache.get(cacheKey);

    if (cached) {
        if (cached.type === 'pending') {
            return cached.promise;
        }
        if (now - cached.timestamp < CACHE_TTL_MS) {
            // LRU: Refresh key position
            analyticsCache.delete(cacheKey);
            analyticsCache.set(cacheKey, cached);
            return cached.data;
        }
        analyticsCache.delete(cacheKey);
    }

    const fetchPromise = (async () => {
        try {
            const client = await getGA4Client(options.propertyId, options.accountId);
            const response = await client.runReport({
                dateRanges: options.startDate ?
                    [{ startDate: options.startDate, endDate: options.endDate || 'today' }] : undefined,
                dimensions: options.dimensions?.map(name => ({ name })),
                metrics: options.metrics?.map(name => ({ name })),
                dimensionFilter: options.dimensionFilter,
                metricFilter: options.metricFilter,
                limit: options.limit,
                offset: options.offset,
                orderBys: options.orderBys
            });

            analyticsCache.set(cacheKey, {
                type: 'resolved',
                data: response,
                timestamp: Date.now()
            });

            if (analyticsCache.size > MAX_CACHE_SIZE) {
                const firstKey = analyticsCache.keys().next().value;
                if (firstKey) analyticsCache.delete(firstKey);
            }

            return response;
        } catch (error) {
            analyticsCache.delete(cacheKey);
            throw error;
        }
    })();

    analyticsCache.set(cacheKey, { type: 'pending', promise: fetchPromise });
    return fetchPromise;
}

export async function getPagePerformance(
    propertyId: string,
    startDate: string,
    endDate: string,
    pagePath?: string,
    limit: number = 50,
    accountId?: string,
    offset?: number
) {
    const dimensionFilter = pagePath ? {
        filter: {
            fieldName: 'pagePath',
            stringFilter: {
                matchType: 'CONTAINS',
                value: pagePath
            }
        }
    } : undefined;

    const response = await queryAnalytics({
        propertyId,
        accountId,
        startDate,
        endDate,
        dimensions: ['pagePath'],
        metrics: [
            'sessions',
            'screenPageViews',
            'bounceRate',
            'averageSessionDuration',
            'conversions',
            'newUsers',
            'engagementRate'
        ],
        dimensionFilter,
        limit,
        offset,
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }]
    });

    return formatRows(response);
}

export async function getTrafficSources(
    propertyId: string,
    startDate: string,
    endDate: string,
    channelGroup?: string,
    limit: number = 50,
    accountId?: string,
    offset?: number
) {
    const dimensionFilter = channelGroup ? {
        filter: {
            fieldName: 'sessionDefaultChannelGroup',
            stringFilter: {
                matchType: 'EXACT',
                value: channelGroup,
                caseSensitive: false
            }
        }
    } : undefined;

    const response = await queryAnalytics({
        propertyId,
        accountId,
        startDate,
        endDate,
        dimensions: ['sessionDefaultChannelGroup', 'sessionSource', 'sessionMedium'],
        metrics: ['sessions'],
        dimensionFilter,
        limit,
        offset,
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }]
    });

    return formatRows(response);
}

export async function getOrganicLandingPages(
    propertyId: string,
    startDate: string,
    endDate: string,
    limit: number = 50,
    accountId?: string,
    offset?: number
) {
    const response = await queryAnalytics({
        propertyId,
        accountId,
        startDate,
        endDate,
        dimensions: ['landingPagePlusQueryString'],
        metrics: [
            'sessions',
            'bounceRate',
            'conversions',
            'engagementRate',
            'averageSessionDuration'
        ],
        dimensionFilter: {
            filter: {
                fieldName: 'sessionDefaultChannelGroup',
                stringFilter: {
                    matchType: 'CONTAINS',
                    value: 'Organic Search',
                    caseSensitive: false
                }
            }
        },
        limit,
        offset,
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }]
    });

    return formatRows(response);
}

export async function getContentPerformance(
    propertyId: string,
    startDate: string,
    endDate: string,
    limit: number = 50,
    accountId?: string,
    offset?: number
) {
    // contentGroup is a standard GA4 dimension; properties not using it report "(not set)".
    const response = await queryAnalytics({
        propertyId,
        accountId,
        startDate,
        endDate,
        dimensions: ['contentGroup'], // Fallback to pagePath if needed? No, separate tool or option.
        metrics: ['sessions', 'averageSessionDuration', 'conversions'],
        limit,
        offset,
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }]
    });

    const rows = formatRows(response);

    if (rows.length > 0 && rows.every((r: any) => r.contentGroup === '(not set)')) {
        return {
            warning: "All rows returned '(not set)'. This usually means Content Groups are not configured in your GA4 property.",
            rows
        };
    }

    return rows;
}

export async function getEcommerce(
    propertyId: string,
    startDate: string,
    endDate: string,
    limit: number = 50,
    accountId?: string,
    offset?: number
) {
    const response = await queryAnalytics({
        propertyId,
        accountId,
        startDate,
        endDate,
        dimensions: ['itemName'],
        metrics: ['itemRevenue', 'itemsPurchased', 'ecommercePurchases'],
        limit,
        offset,
        orderBys: [{ metric: { metricName: 'itemRevenue' }, desc: true }]
    });

    // No revenue data: return a warning instead of empty rows
    const rows = formatRows(response);
    if (rows.length === 0 || (rows.length > 0 && rows.every((r: Record<string, number>) => r.itemRevenue === 0 && r.itemsPurchased === 0))) {
        return {
            warning: "No ecommerce data found for this property.",
            rows: []
        };
    }

    return rows;
}
