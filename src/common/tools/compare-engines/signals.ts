import { ComparisonRow } from "./types.js";

export function generateSignals(row: ComparisonRow): string[] {
  const signals: string[] = [];

  const google = row.google;
  const bing = row.bing;
  const deltas = row.deltas;

  const totalClicks = google.clicks + bing.clicks;
  const googleClickShare = deltas.click_share_google; // already computed

  // bing_opportunity: strong on Google (top 5, >50 clicks), weak/absent on Bing
  if (google.position > 0 && google.position <= 5 && (bing.position >= 10 || bing.position === 0) && google.clicks > 50) {
    signals.push("bing_opportunity");
  }

  // google_dependency_risk: one engine supplies ≥85% of clicks across meaningful volume
  if (googleClickShare >= 0.85 && totalClicks > 100) {
    signals.push("google_dependency_risk");
  }

  // ctr_mismatch: CTR differs meaningfully while rankings are nearly identical
  if (Math.abs(deltas.ctr_delta) >= 0.05 && Math.abs(deltas.position_delta) <= 2) {
    signals.push("ctr_mismatch");
  }

  // ranking_divergence
  if (Math.abs(deltas.position_delta) >= 7) {
    signals.push("ranking_divergence");
  }

  return signals;
}
