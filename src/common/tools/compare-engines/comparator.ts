import { NormalizedRow, ComparisonRow, ComparisonSummary, Deltas } from "./types.js";

export function compareRows(googleRows: NormalizedRow[], bingRows: NormalizedRow[]): { rows: ComparisonRow[], summary: ComparisonSummary } {
  // 1. Group rows by key
  const googleMap = new Map<string, NormalizedRow>();
  const bingMap = new Map<string, NormalizedRow>();

  for (const row of googleRows) {
    // If duplicate keys exist, we take the last one. Ideally adapter ensures uniqueness.
    googleMap.set(row.key, row);
  }

  for (const row of bingRows) {
    bingMap.set(row.key, row);
  }

  // 2. Identify all unique keys without temporary array allocations
  const allKeys = new Set<string>();
  for (const key of googleMap.keys()) allKeys.add(key);
  for (const key of bingMap.keys()) allKeys.add(key);
  const rows: ComparisonRow[] = [];

  let googleTotalClicks = 0;
  let bingTotalClicks = 0;

  for (const key of allKeys) {
    const google = googleMap.get(key) || { clicks: 0, impressions: 0, ctr: 0, position: 0 };
    const bing = bingMap.get(key) || { clicks: 0, impressions: 0, ctr: 0, position: 0 };

    googleTotalClicks += google.clicks;
    bingTotalClicks += bing.clicks;

    // 3. Compute deltas per key
    const totalClicks = google.clicks + bing.clicks;
    const googleClickShare = totalClicks > 0 ? google.clicks / totalClicks : 0;

    // Position delta: google - bing (0 usually means unranked; compared as-is)
    const deltas: Deltas = {
      position_delta: google.position - bing.position,
      ctr_delta: google.ctr - bing.ctr,
      click_share_google: googleClickShare
    };

    const row: ComparisonRow = {
      key,
      google: {
        clicks: google.clicks,
        impressions: google.impressions,
        ctr: google.ctr,
        position: google.position
      },
      bing: {
        clicks: bing.clicks,
        impressions: bing.impressions,
        ctr: bing.ctr,
        position: bing.position
      },
      deltas,
      signals: [] // Signals will be populated later
    };

    rows.push(row);
  }

  // 4. Compute summary
  const combinedTotalClicks = googleTotalClicks + bingTotalClicks;
  const googleDependencyScore = combinedTotalClicks > 0 ? googleTotalClicks / combinedTotalClicks : 0;

  const summary: ComparisonSummary = {
    total_keys: allKeys.size,
    google_total_clicks: googleTotalClicks,
    bing_total_clicks: bingTotalClicks,
    google_dependency_score: parseFloat(googleDependencyScore.toFixed(2))
  };

  return { rows, summary };
}
