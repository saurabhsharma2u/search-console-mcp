import { queryAnalytics, detectAnomalies } from './analytics.js';

/**
 * Result of a traffic drop attribution analysis.
 */
export interface DropAttribution {
    /** The date when the drop occurred. */
    date: string;
    /** The metric analyzed (e.g., 'clicks'). */
    metric: string;
    /** The total difference between actual and expected value. */
    totalDrop: number;
    /** Estimated loss in absolute clicks/impressions per device type. */
    deviceImpact: {
        mobile: number;
        desktop: number;
        tablet: number;
    };
    /** A human-readable summary of the most likely cause based on device data. */
    primaryCause: string;
    /** If the drop correlates with a known Google Algorithm Update, its name is included here. */
    possibleAlgorithmUpdate?: string;
}

/**
 * Historical Google Algorithm Update dates (recent notable ones)
 */
export const ALGORITHM_UPDATES = [
    // 2022
    { date: '2022-09-12', name: 'September 2022 Core Update' },
    { date: '2022-09-20', name: 'September 2022 Product Review Update' },
    { date: '2022-10-19', name: 'October 2022 Spam Update' },
    { date: '2022-12-05', name: 'December 2022 Helpful Content Update' },
    { date: '2022-12-14', name: 'December 2022 Link Spam Update' },
    // 2023
    { date: '2023-02-21', name: 'February 2023 Product Reviews Update' },
    { date: '2023-03-15', name: 'March 2023 Core Update' },
    { date: '2023-04-12', name: 'April 2023 Reviews Update' },
    { date: '2023-08-22', name: 'August 2023 Core Update' },
    { date: '2023-09-14', name: 'September 2023 Helpful Content Update' },
    { date: '2023-10-04', name: 'October 2023 Spam Update' },
    { date: '2023-10-05', name: 'October 2023 Core Update' },
    { date: '2023-11-02', name: 'November 2023 Core Update' },
    { date: '2023-11-08', name: 'November 2023 Reviews Update' },
    // 2024
    { date: '2024-03-05', name: 'March 2024 Core Update' },
    { date: '2024-05-06', name: 'Site Reputation Abuse (Manual Actions)' },
    { date: '2024-05-14', name: 'AI Overviews Rollout' },
    { date: '2024-06-20', name: 'June 2024 Spam Update' },
    { date: '2024-08-15', name: 'August 2024 Core Update' },
    { date: '2024-11-11', name: 'November 2024 Core Update' },
    { date: '2024-12-12', name: 'December 2024 Core Update' },
    { date: '2024-12-19', name: 'December 2024 Spam Update' },
    // 2025
    { date: '2025-03-13', name: 'March 2025 Core Update' },
    { date: '2025-06-30', name: 'June 2025 Core Update' },
    { date: '2025-08-26', name: 'August 2025 Spam Update' },
    { date: '2025-12-11', name: 'December 2025 Core Update' },
    // 2026
    { date: '2026-02-05', name: 'February 2026 Discover Update' },
    { date: '2026-03-24', name: 'March 2026 Spam Update' },
    { date: '2026-03-27', name: 'March 2026 Core Update' },
    { date: '2026-04-10', name: 'Generative AI Manipulation (Spam Policy Update)' },
    { date: '2026-05-21', name: 'May 2026 Core Update' },
    { date: '2026-06-15', name: 'Back Button Hijacking (Spam Policy Update)' },
    { date: '2026-06-24', name: 'June 2026 Spam Update' },
    { date: '2026-08-18', name: 'August 2026 Spam Update' },
];

/**
 * Identify the cause of a significant traffic drop by analyzing device distribution and algorithm updates.
 *
 * @param siteUrl - The URL of the site to analyze.
 * @param options - Configuration including the lookback period and anomaly threshold.
 * @returns A detailed attribution object or null if no significant drop is found.
 */
export async function analyzeDropAttribution(
    siteUrl: string,
    options: { days?: number; threshold?: number } = {}
): Promise<DropAttribution | null> {
    const anomalies = await detectAnomalies(siteUrl, { days: options.days ?? 30, threshold: options.threshold ?? 2.0 });

    // Find the most recent 'drop'
    const mostRecentDrop = anomalies.find(a => a.type === 'drop');
    if (!mostRecentDrop) return null;

    const dropDate = mostRecentDrop.date;
    const previousWeekStart = new Date(dropDate);
    previousWeekStart.setDate(previousWeekStart.getDate() - 7);
    const previousWeekEnd = new Date(dropDate);
    previousWeekEnd.setDate(previousWeekEnd.getDate() - 1);

    const [dropDayStats, baselineStats] = await Promise.all([
        queryAnalytics({
            siteUrl,
            startDate: dropDate,
            endDate: dropDate,
            dimensions: ['device']
        }),
        queryAnalytics({
            siteUrl,
            startDate: previousWeekStart.toISOString().split('T')[0],
            endDate: previousWeekEnd.toISOString().split('T')[0],
            dimensions: ['device']
        })
    ]);

    const dropMap = new Map(dropDayStats.map(r => [r.keys?.[0]?.toLowerCase(), r.clicks ?? 0]));
    const baselineMap = new Map();

    baselineStats.forEach(r => {
        const device = r.keys?.[0]?.toLowerCase();
        const current = baselineMap.get(device) || 0;
        baselineMap.set(device, current + (r.clicks ?? 0) / 7);
    });

    const impacts: any = { mobile: 0, desktop: 0, tablet: 0 };
    let primaryDevice = 'unknown';
    let maxDeficit = 0;

    ['mobile', 'desktop', 'tablet'].forEach(device => {
        const baseline = baselineMap.get(device) || 0;
        const actual = dropMap.get(device) || 0;
        const deficit = baseline - actual;
        impacts[device] = parseFloat(deficit.toFixed(2));

        if (deficit > maxDeficit) {
            maxDeficit = deficit;
            primaryDevice = device;
        }
    });

    // Check for algorithm updates within 2 days of the drop
    const possibleUpdate = ALGORITHM_UPDATES.find(u => {
        const uDate = new Date(u.date);
        const dDate = new Date(dropDate);
        const diff = Math.abs(dDate.getTime() - uDate.getTime()) / (1000 * 60 * 60 * 24);
        return diff <= 2;
    });

    return {
        date: dropDate,
        metric: mostRecentDrop.metric,
        totalDrop: mostRecentDrop.value - mostRecentDrop.expectedValue,
        deviceImpact: impacts,
        primaryCause: primaryDevice !== 'unknown' ? `Disproportionate drop on ${primaryDevice}` : 'Uniform drop across devices',
        possibleAlgorithmUpdate: possibleUpdate?.name
    };
}

/**
 * A single data point in a time series analysis.
 */
export interface TimeSeriesData {
    /** The date of the data point (for daily granularity). */
    date?: string;
    /** The start of the week (for weekly granularity). */
    week?: string;
    /** Any dimensions used for grouping (e.g., device, country). */
    dimensions?: Record<string, string>;
    /** The raw metric values for this point. */
    metrics: Record<string, number>;
    /** Calculated rolling averages for each metric. */
    rollingAverages?: Record<string, number>;
    /** Whether this point represents a detected seasonal peak. */
    isSeasonalPeak?: boolean;
}

/**
 * Summary of trend analysis and future projections.
 */
export interface ForecastResult {
    /** The detected direction of the current trend. */
    currentTrend: 'up' | 'down' | 'stable';
    /** Projected future values for each analyzed metric. */
    forecastedValues: Record<string, number[]>;
    /** The calculated regularity of patterns in the data (0 to 1). */
    seasonalityStrength: number;
}

/**
 * Advanced time series analysis for smoothing, seasonality, and forecasting.
 * Supports dynamic dimensions, multiple metrics, granularities, and custom filtering.
 *
 * @param siteUrl - The URL of the site to analyze.
 * @param options - Analysis configuration including metrics, granularity, and forecast length.
 * @returns Historical data points with rolling averages and a forecast object.
 */
export async function getTimeSeriesInsights(
    siteUrl: string,
    options: {
        days?: number;
        startDate?: string;
        endDate?: string;
        dimensions?: string[];
        metrics?: ('clicks' | 'impressions' | 'ctr' | 'position')[];
        granularity?: 'daily' | 'weekly';
        filters?: Array<{
            dimension: string;
            operator: string;
            expression: string;
        }>;
        window?: number;
        forecastDays?: number;
    } = {}
): Promise<{ history: TimeSeriesData[]; forecast: ForecastResult }> {
    const metrics = options.metrics || ['clicks'];
    const granularity = options.granularity || 'daily';
    const windowSize = options.window || 7;
    const forecastDays = options.forecastDays ?? 7;
    const dimensions = options.dimensions || ['date'];

    // Ensure 'date' is included in dimensions for time series if not already there
    if (!dimensions.includes('date')) {
        dimensions.unshift('date');
    }

    let startDate: string;
    let endDate: string;

    if (options.startDate && options.endDate) {
        startDate = options.startDate;
        endDate = options.endDate;
    } else {
        const days = options.days ?? 60;
        const end = new Date();
        end.setDate(end.getDate() - 3); // GSC delay
        const start = new Date(end);
        start.setDate(start.getDate() - days);
        startDate = start.toISOString().split('T')[0];
        endDate = end.toISOString().split('T')[0];
    }

    const rows = await queryAnalytics({
        siteUrl,
        startDate,
        endDate,
        dimensions,
        filters: options.filters
    });

    // Handle data parsing and grouping
    let data: {
        date: string;
        dimensions: Record<string, string>;
        metrics: Record<string, number>;
        original?: any;
    }[] = rows.map(r => {
        const dimObj: Record<string, string> = {};
        dimensions.forEach((d, i) => {
            if (d !== 'date') dimObj[d] = r.keys?.[i] || '';
        });

        const metricObj: Record<string, number> = {};
        metrics.forEach(m => {
            metricObj[m] = (r[m] as number) ?? 0;
        });

        return {
            date: r.keys?.[dimensions.indexOf('date')] || '',
            dimensions: dimObj,
            metrics: metricObj,
            original: r
        };
    }).sort((a, b) => a.date.localeCompare(b.date));

    // Support weekly granularity
    if (granularity === 'weekly') {
        const weeklyData: Record<string, {
            date: string;
            dimensions: Record<string, string>;
            metrics: Record<string, number>;
            accumulators: { clicks: number; impressions: number; weightedPos: number; count: number; };
        }> = {};

        data.forEach(d => {
            const date = new Date(d.date);
            const day = date.getUTCDay();
            const diff = date.getUTCDate() - day + (day === 0 ? -6 : 1); // Adjust to Monday
            const monday = new Date(date);
            monday.setUTCDate(diff);
            const weekKey = monday.toISOString().split('T')[0];

            if (!weeklyData[weekKey]) {
                const initMetrics: Record<string, number> = {};
                metrics.forEach(m => initMetrics[m] = 0);
                weeklyData[weekKey] = {
                    date: weekKey,
                    dimensions: d.dimensions,
                    metrics: initMetrics,
                    accumulators: { clicks: 0, impressions: 0, weightedPos: 0, count: 0 }
                };
            }

            // Accumulate raw values
            const entry = weeklyData[weekKey];
            const r = d.original;
            const clicks = r.clicks ?? 0;
            const impressions = r.impressions ?? 0;
            const position = r.position ?? 0;

            entry.accumulators.clicks += clicks;
            entry.accumulators.impressions += impressions;
            entry.accumulators.weightedPos += (position * impressions);
            entry.accumulators.count += 1;
        });

        // Compute final weekly metrics
        data = Object.values(weeklyData).map(w => {
            const m = w.metrics;
            const acc = w.accumulators;

            const finalClicks = acc.clicks;
            const finalImpressions = acc.impressions;
            const finalCtr = finalImpressions > 0 ? finalClicks / finalImpressions : 0;
            const finalPos = finalImpressions > 0 ? acc.weightedPos / finalImpressions : 0;

            metrics.forEach(metric => {
                if (metric === 'clicks') m[metric] = finalClicks;
                else if (metric === 'impressions') m[metric] = finalImpressions;
                else if (metric === 'ctr') m[metric] = finalCtr;
                else if (metric === 'position') m[metric] = parseFloat(finalPos.toFixed(2));
            });

            return {
                date: w.date,
                dimensions: w.dimensions,
                metrics: m
            };
        }).sort((a, b) => a.date.localeCompare(b.date));
    }

    // 1. Calculate Rolling Averages for EACH metric
    const history: TimeSeriesData[] = data.map((d, i) => {
        const win = data.slice(Math.max(0, i - (windowSize - 1)), i + 1);
        const rollingAvgObj: Record<string, number> = {};

        metrics.forEach(m => {
            const avg = win.reduce((sum, curr) => sum + curr.metrics[m], 0) / win.length;
            rollingAvgObj[m] = parseFloat(avg.toFixed(2));
        });

        return {
            date: granularity === 'daily' ? d.date : undefined,
            week: granularity === 'weekly' ? d.date : undefined,
            dimensions: Object.keys(d.dimensions).length > 0 ? d.dimensions : undefined,
            metrics: d.metrics,
            rollingAverages: rollingAvgObj,
            isSeasonalPeak: false
        };
    });

    // 2. Identify Seasonality (only makes sense for daily data)
    let seasonalityStrength = 0;
    if (granularity === 'daily' && data.length >= 14) {
        const firstMetric = metrics[0];
        const dowStats: number[][] = [[], [], [], [], [], [], []];
        data.forEach(d => {
            const day = new Date(d.date).getDay();
            dowStats[day].push(d.metrics[firstMetric]);
        });

        const dowAverages = dowStats.map(vals => vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0);
        const globalAvg = dowAverages.reduce((a, b) => a + b, 0) / 7;

        const variance = dowAverages.reduce((a, b) => a + Math.pow(b - globalAvg, 2), 0) / 7;
        const stdDev = Math.sqrt(variance);
        seasonalityStrength = parseFloat(Math.min(1, stdDev / (globalAvg || 1)).toFixed(2));

        const peakDay = dowAverages.indexOf(Math.max(...dowAverages));
        history.forEach(h => {
            if (h.date && new Date(h.date).getDay() === peakDay) h.isSeasonalPeak = true;
        });
    }

    // 3. Simple Linear Regression for Forecasting for EACH metric
    const forecastResults: Record<string, number[]> = {};
    let overallTrend: 'up' | 'down' | 'stable' = 'stable';

    metrics.forEach(m => {
        const n = data.length;
        if (n < 2) {
            forecastResults[m] = [];
            return;
        }

        let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
        for (let i = 0; i < n; i++) {
            sumX += i;
            sumY += data[i].metrics[m];
            sumXY += i * data[i].metrics[m];
            sumXX += i * i;
        }

        const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;

        if (m === metrics[0]) {
            overallTrend = slope > 0.05 ? 'up' : (slope < -0.05 ? 'down' : 'stable');
        }

        const forecastPoints: number[] = [];
        for (let i = n; i < n + forecastDays; i++) {
            const rawForecast = slope * i + intercept;
            forecastPoints.push(Math.max(0, Math.round(rawForecast)));
        }
        forecastResults[m] = forecastPoints;
    });

    return {
        history,
        forecast: {
            currentTrend: overallTrend,
            forecastedValues: forecastResults,
            seasonalityStrength
        }
    };
}
