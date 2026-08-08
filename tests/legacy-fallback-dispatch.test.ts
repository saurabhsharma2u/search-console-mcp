import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { legacyFallbackMap, shouldUseLegacyFallback } from "../src/legacy/fallback-router.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Tool names registered via registerTool(...) in src/index.ts.
 *
 * Read from source rather than hardcoded so the collision list below stays
 * accurate as tools are added or renamed.
 */
function registeredToolNames(): string[] {
  const src = readFileSync(join(__dirname, "../src/index.ts"), "utf8");
  return [...src.matchAll(/registerTool\(\s*"([^"]+)"/g)].map((m) => m[1]);
}

describe("legacy fallback dispatch order", () => {
  it("never lets a legacy shim shadow a registered tool", () => {
    for (const name of registeredToolNames()) {
      expect(
        shouldUseLegacyFallback(name, true),
        `legacy shim must not handle registered tool "${name}"`
      ).toBe(false);
    }
  });

  it("still resolves legacy-only aliases", () => {
    const registered = new Set(registeredToolNames());
    const legacyOnly = Object.keys(legacyFallbackMap).filter((n) => !registered.has(n));

    expect(legacyOnly.length).toBeGreaterThan(0);
    for (const name of legacyOnly) {
      expect(shouldUseLegacyFallback(name, false), `legacy alias "${name}" must resolve`).toBe(true);
    }
  });

  it("rejects names that are neither registered nor legacy", () => {
    expect(shouldUseLegacyFallback("definitely_not_a_tool", false)).toBe(false);
  });

  /**
   * Regression guard for the tools that regressed in 2.0.2. Each of these names
   * exists in both the registered set and the legacy map, and the legacy shim
   * takes a different argument shape:
   *
   *  - inspection_inspect reads a singular `url`; the tool takes `urls: string[]`,
   *    so the shim sent `inspectionUrl: undefined` to Google, which answered
   *    "You do not own this site, or the inspected URL is not part of this
   *    property" for sites the caller did in fact own.
   *  - analytics_query / sites_list / sitemaps_list / analytics_anomalies hardcode
   *    `engine: "google"`, so every Bing request ran against Google instead.
   */
  it("keeps the known-colliding tools on their registered handlers", () => {
    const knownCollisions = [
      "analytics_anomalies",
      "analytics_query",
      "compare_engines",
      "indexing_status",
      "inspection_inspect",
      "pagespeed_analyze",
      "sitemaps_delete",
      "sitemaps_list",
      "sitemaps_submit",
      "sites_list",
    ];

    const registered = new Set(registeredToolNames());
    for (const name of knownCollisions) {
      expect(registered.has(name), `${name} should still be a registered tool`).toBe(true);
      expect(legacyFallbackMap[name], `${name} should still exist as a legacy alias`).toBeDefined();
      expect(shouldUseLegacyFallback(name, true)).toBe(false);
    }
  });
});
