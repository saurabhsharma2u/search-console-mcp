import { getSearchConsoleClient } from '../client.js';
import { searchconsole_v1 } from 'googleapis';
import { limitConcurrency } from '../../common/concurrency.js';
import { TenantContext } from '../../tenant/types.js';
import { sanitizeForLog } from '../../utils/redaction.js';
import {
  appendInspectionCacheEvent,
  InspectionCacheMetadata,
  InspectionCacheMode,
  InspectionResultWithMetadata,
  normalizeInspectionResponse,
  readFreshInspectionCache,
  writeInspectionCacheEntry,
  createInspectionCacheKey
} from './inspection-cache.js';

const DEFAULT_CACHE_MODE: InspectionCacheMode = 'read_write';
const DEFAULT_MAX_AGE_HOURS = 24;

/**
 * Inspects a URL for a site to see its current indexing status in Google Search.
 *
 * @param siteUrl - The URL of the site as defined in Search Console.
 * @param inspectionUrl - The specific URL to inspect.
 * @param languageCode - The language used for localized results. Defaults to 'en-US'.
 * @returns Comprehensive indexing and status information for the URL.
 */
export async function inspectUrl(
  siteUrl: string,
  inspectionUrl: string,
  languageCode: string = 'en-US'
): Promise<searchconsole_v1.Schema$InspectUrlIndexResponse> {
  const client = await getSearchConsoleClient(siteUrl);
  const res = await client.urlInspection.index.inspect({
    requestBody: {
      inspectionUrl,
      siteUrl,
      languageCode
    }
  });
  return res.data;
}

export async function inspectUrlNormalized(
  siteUrl: string,
  inspectionUrl: string,
  languageCode: string = 'en-US',
  tenant?: TenantContext,
  options: {
    cacheMode?: InspectionCacheMode;
    maxAgeHours?: number;
    forceRefresh?: boolean;
  } = {}
): Promise<InspectionResultWithMetadata> {
  const tenantId = tenant?.tenantId || 'default';
  const cacheMode = options.cacheMode || DEFAULT_CACHE_MODE;
  const maxAgeHours = options.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS;
  const cacheKey = createInspectionCacheKey(tenantId, siteUrl, inspectionUrl);

  if (!options.forceRefresh && (cacheMode === 'read' || cacheMode === 'read_write')) {
    const cached = readFreshInspectionCache(tenantId, siteUrl, inspectionUrl, maxAgeHours);
    if (cached?.entry.normalized) {
      const metadata: InspectionCacheMetadata = {
        cacheHit: true,
        apiCallMade: false,
        quotaUnitEstimate: 0,
        cacheKey,
        fetchedAt: cached.entry.fetched_at,
        expiresAt: cached.entry.expires_at
      };
      appendInspectionCacheEvent({
        timestamp: new Date().toISOString(),
        tenant_id: tenantId,
        siteUrl,
        inspectionUrl,
        tool_version: cached.entry.tool_version,
        status: 'ok',
        cacheHit: true,
        apiCallMade: false,
        quotaUnitEstimate: 0
      });
      return { ...cached.entry.normalized, metadata };
    }
  }

  if (cacheMode === 'read') {
    appendInspectionCacheEvent({
      timestamp: new Date().toISOString(),
      tenant_id: tenantId,
      siteUrl,
      inspectionUrl,
      tool_version: 'gsc-url-inspection-v1',
      status: 'cache_miss',
      cacheHit: false,
      apiCallMade: false,
      quotaUnitEstimate: 0
    });
    throw cacheMissError('Cache miss for URL Inspection result');
  }

  try {
    const raw = await inspectUrl(siteUrl, inspectionUrl, languageCode);
    const normalized = normalizeInspectionResponse(siteUrl, inspectionUrl, raw);
    const entry = cacheMode === 'write' || cacheMode === 'read_write'
      ? writeInspectionCacheEntry(tenantId, siteUrl, inspectionUrl, raw, normalized, {
        ttlHours: maxAgeHours,
        apiStatus: 'ok'
      })
      : undefined;

    const metadata: InspectionCacheMetadata = {
      cacheHit: false,
      apiCallMade: true,
      quotaUnitEstimate: 1,
      cacheKey,
      fetchedAt: entry?.fetched_at || new Date().toISOString(),
      expiresAt: entry?.expires_at
    };
    appendInspectionCacheEvent({
      timestamp: new Date().toISOString(),
      tenant_id: tenantId,
      siteUrl,
      inspectionUrl,
      tool_version: 'gsc-url-inspection-v1',
      status: 'ok',
      cacheHit: false,
      apiCallMade: true,
      quotaUnitEstimate: 1
    });

    return { ...normalized, metadata };
  } catch (error) {
    const err = error as any;
    const errorCode = String(err.code || err.status || err.reason || 'UNKNOWN');
    const errorMessage = sanitizeForLog(err.message || 'URL Inspection API call failed');
    if (cacheMode === 'write' || cacheMode === 'read_write') {
      writeInspectionCacheEntry(tenantId, siteUrl, inspectionUrl, undefined, undefined, {
        ttlHours: maxAgeHours,
        apiStatus: 'error',
        errorCode,
        errorMessage
      });
    }
    appendInspectionCacheEvent({
      timestamp: new Date().toISOString(),
      tenant_id: tenantId,
      siteUrl,
      inspectionUrl,
      tool_version: 'gsc-url-inspection-v1',
      status: 'error',
      cacheHit: false,
      apiCallMade: true,
      quotaUnitEstimate: 1,
      error_code: errorCode
    });
    throw new Error(errorMessage);
  }
}

/**
 * Inspects multiple URLs for a site in batch.
 *
 * @param siteUrl - The URL of the site as defined in Search Console.
 * @param inspectionUrls - The list of URLs to inspect.
 * @param languageCode - The language used for localized results. Defaults to 'en-US'.
 * @returns An array of results, each containing the URL and its inspection result or error.
 */
export async function inspectBatch(
  siteUrl: string,
  inspectionUrls: string[],
  languageCode: string = 'en-US'
): Promise<Array<{ url: string; result?: searchconsole_v1.Schema$InspectUrlIndexResponse; error?: string }>> {
  return limitConcurrency(inspectionUrls, 5, async (url) => {
    try {
      const result = await inspectUrl(siteUrl, url, languageCode);
      return { url, result };
    } catch (error) {
      return { url, error: (error as Error).message };
    }
  });
}

export async function inspectBatchWithCache(
  siteUrl: string,
  urls: string[],
  tenant: TenantContext | undefined,
  options: {
    cacheMode?: InspectionCacheMode;
    maxAgeHours?: number;
    forceRefresh?: boolean;
    languageCode?: string;
    maxApiCallsPerRun?: number;
  } = {}
) {
  const tenantId = tenant?.tenantId || 'default';
  const cacheMode = options.cacheMode || DEFAULT_CACHE_MODE;
  const maxAgeHours = options.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS;
  const maxApiCallsPerRun = options.maxApiCallsPerRun ?? tenant?.limits.maxBatchUrls ?? 10;
  let apiCallsMade = 0;
  let cacheHits = 0;
  let errors = 0;
  let quotaLimited = 0;

  const results = [];

  for (const url of urls) {
    try {
      const cached = !options.forceRefresh && (cacheMode === 'read' || cacheMode === 'read_write')
        ? readFreshInspectionCache(tenantId, siteUrl, url, maxAgeHours)
        : undefined;

      if (cached?.entry.normalized) {
        cacheHits++;
        appendInspectionCacheEvent({
          timestamp: new Date().toISOString(),
          tenant_id: tenantId,
          siteUrl,
          inspectionUrl: url,
          tool_version: cached.entry.tool_version,
          status: 'ok',
          cacheHit: true,
          apiCallMade: false,
          quotaUnitEstimate: 0
        });
        results.push({
          status: 'ok',
          ...cached.entry.normalized,
          metadata: {
            cacheHit: true,
            apiCallMade: false,
            quotaUnitEstimate: 0,
            cacheKey: createInspectionCacheKey(tenantId, siteUrl, url),
            fetchedAt: cached.entry.fetched_at,
            expiresAt: cached.entry.expires_at
          }
        });
        continue;
      }

      if (cacheMode === 'read') {
        results.push({
          inspectionUrl: url,
          siteUrl,
          status: 'cache_miss',
          metadata: {
            cacheHit: false,
            apiCallMade: false,
            quotaUnitEstimate: 0,
            cacheKey: createInspectionCacheKey(tenantId, siteUrl, url)
          }
        });
        appendInspectionCacheEvent({
          timestamp: new Date().toISOString(),
          tenant_id: tenantId,
          siteUrl,
          inspectionUrl: url,
          tool_version: 'gsc-url-inspection-v1',
          status: 'cache_miss',
          cacheHit: false,
          apiCallMade: false,
          quotaUnitEstimate: 0
        });
        continue;
      }

      if (apiCallsMade >= maxApiCallsPerRun) {
        quotaLimited++;
        results.push({
          inspectionUrl: url,
          siteUrl,
          status: 'quota_limited',
          metadata: {
            cacheHit: false,
            apiCallMade: false,
            quotaUnitEstimate: 0,
            cacheKey: createInspectionCacheKey(tenantId, siteUrl, url)
          }
        });
        appendInspectionCacheEvent({
          timestamp: new Date().toISOString(),
          tenant_id: tenantId,
          siteUrl,
          inspectionUrl: url,
          tool_version: 'gsc-url-inspection-v1',
          status: 'quota_limited',
          cacheHit: false,
          apiCallMade: false,
          quotaUnitEstimate: 0
        });
        continue;
      }

      apiCallsMade++;
      const result = await inspectUrlNormalized(siteUrl, url, options.languageCode, tenant, {
        cacheMode: cacheMode === 'write' ? 'write' : 'read_write',
        maxAgeHours,
        forceRefresh: true
      });
      results.push({ status: 'ok', ...result });
    } catch (error) {
      errors++;
      results.push({
        inspectionUrl: url,
        siteUrl,
        status: 'error',
        errorCode: String((error as any).code || (error as any).status || 'ERROR'),
        errorMessage: sanitizeForLog((error as Error).message || 'URL Inspection failed'),
        metadata: {
          cacheHit: false,
          apiCallMade: true,
          quotaUnitEstimate: 1,
          cacheKey: createInspectionCacheKey(tenantId, siteUrl, url)
        }
      });
    }
  }

  return {
    siteUrl,
    cacheMode,
    maxAgeHours,
    maxApiCallsPerRun,
    summary: {
      requested: urls.length,
      returned: results.length,
      cacheHits,
      apiCallsMade,
      errors,
      quotaLimited,
      quotaUnitEstimate: apiCallsMade
    },
    results
  };
}

function cacheMissError(message: string) {
  const error = new Error(message) as Error & { code: string };
  error.code = 'CACHE_MISS';
  return error;
}
