import { getSearchConsoleClient } from '../client.js';
import { searchconsole_v1 } from 'googleapis';
import { limitConcurrency } from '../../common/concurrency.js';
import { TenantContext } from '../../tenant/types.js';
import { isUrlAllowedBySites } from '../../tenant/guard.js';
import { sanitizeForLog } from '../../utils/redaction.js';
import { runGoogleApiCall } from '../upstream.js';
import {
  appendInspectionCacheEvent,
  calculateCacheAgeHours,
  InspectionCacheMetadata,
  InspectionCacheMode,
  InspectionResultWithMetadata,
  normalizeInspectionResponse,
  normalizeInspectionUrlForCache,
  readFreshInspectionCache,
  writeInspectionCacheEntry,
  createInspectionCacheKey
} from './inspection-cache.js';

type EffectiveCacheMode = 'read_write' | 'read_only' | 'bypass' | 'write';
const DEFAULT_CACHE_MODE: EffectiveCacheMode = 'read_write';
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
  const res = await runGoogleApiCall('urlInspection.index.inspect', (requestOptions) =>
    client.urlInspection.index.inspect({
      requestBody: {
        inspectionUrl,
        siteUrl,
        languageCode
      }
    }, requestOptions)
  );
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
  const cacheMode = normalizeCacheMode(options.cacheMode);
  const maxAgeHours = options.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS;
  const cacheKey = createInspectionCacheKey(tenantId, siteUrl, inspectionUrl);
  const shouldReadCache = cacheMode === 'read_write' || cacheMode === 'read_only';
  const shouldWriteCache = cacheMode === 'read_write' || cacheMode === 'write' || options.forceRefresh === true;

  if (!options.forceRefresh && shouldReadCache) {
    const cached = readFreshInspectionCache(tenantId, siteUrl, inspectionUrl, maxAgeHours);
    if (cached?.entry.normalized) {
      const cachedAt = cached.entry.fetched_at;
      const metadata: InspectionCacheMetadata = {
        cacheHit: true,
        apiCallMade: false,
        quotaUnitEstimate: 0,
        cacheKey,
        cachedAt,
        fetchedAt: cached.entry.fetched_at,
        expiresAt: cached.entry.expires_at,
        cacheAgeHours: calculateCacheAgeHours(cachedAt)
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

  if (cacheMode === 'read_only') {
    appendInspectionCacheEvent({
      timestamp: new Date().toISOString(),
      tenant_id: tenantId,
      siteUrl,
      inspectionUrl,
      tool_version: 'gsc-url-inspection-v1',
      status: 'provider_error',
      cacheHit: false,
      apiCallMade: false,
      quotaUnitEstimate: 0
    });
    throw cacheMissError('No fresh cache entry and cacheMode is read_only');
  }

  try {
    const raw = await inspectUrl(siteUrl, inspectionUrl, languageCode);
    const normalized = normalizeInspectionResponse(siteUrl, inspectionUrl, raw);
    const entry = shouldWriteCache
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
      cachedAt: entry?.fetched_at,
      fetchedAt: entry?.fetched_at || new Date().toISOString(),
      expiresAt: entry?.expires_at,
      cacheAgeHours: entry ? 0 : undefined
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
    if (shouldWriteCache) {
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
  const cacheMode = normalizeCacheMode(options.cacheMode);
  const maxAgeHours = options.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS;
  const maxApiCallsPerRun = options.maxApiCallsPerRun ?? tenant?.limits.maxBatchUrls ?? 10;
  const shouldReadCache = cacheMode === 'read_write' || cacheMode === 'read_only';
  let apiCallsMade = 0;
  let cacheHits = 0;
  let errors = 0;
  let quotaLimited = 0;
  let invalidUrls = 0;
  let forbiddenUrls = 0;

  const results = [];

  for (const batch of chunkArray(urls, Number(process.env.MCP_INSPECTION_CHUNK_SIZE || 25))) {
    for (const url of batch) {
    try {
      const normalizedUrl = normalizeInspectionUrlForCache(url);
      if (!isInspectableUrl(url)) {
        invalidUrls++;
        results.push({
          url,
          inspectionUrl: url,
          siteUrl,
          status: 'invalid_url',
          errorCode: 'INVALID_URL',
          errorMessage: 'URL must be a valid http or https URL',
          metadata: emptyMetadata(tenantId, siteUrl, url)
        });
        appendInspectionCacheEvent({
          timestamp: new Date().toISOString(),
          tenant_id: tenantId,
          siteUrl,
          inspectionUrl: url,
          tool_version: 'gsc-url-inspection-v1',
          status: 'invalid_url',
          cacheHit: false,
          apiCallMade: false,
          quotaUnitEstimate: 0,
          error_code: 'INVALID_URL'
        });
        continue;
      }

      if (tenant && !isUrlAllowedForTenant(tenant, url)) {
        forbiddenUrls++;
        results.push({
          url: normalizedUrl,
          inspectionUrl: url,
          siteUrl,
          status: 'forbidden_url',
          errorCode: 'FORBIDDEN_URL',
          errorMessage: 'URL is not allowed for this tenant',
          metadata: emptyMetadata(tenantId, siteUrl, url)
        });
        appendInspectionCacheEvent({
          timestamp: new Date().toISOString(),
          tenant_id: tenantId,
          siteUrl,
          inspectionUrl: url,
          tool_version: 'gsc-url-inspection-v1',
          status: 'forbidden_url',
          cacheHit: false,
          apiCallMade: false,
          quotaUnitEstimate: 0,
          error_code: 'FORBIDDEN_URL'
        });
        continue;
      }

      const cached = !options.forceRefresh && shouldReadCache
        ? readFreshInspectionCache(tenantId, siteUrl, url, maxAgeHours)
        : undefined;

      if (cached?.entry.normalized) {
        cacheHits++;
        const cachedAt = cached.entry.fetched_at;
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
          status: 'cache_hit',
          ...cached.entry.normalized,
          metadata: {
            cacheHit: true,
            apiCallMade: false,
            quotaUnitEstimate: 0,
            cacheKey: createInspectionCacheKey(tenantId, siteUrl, url),
            cachedAt,
            fetchedAt: cached.entry.fetched_at,
            expiresAt: cached.entry.expires_at,
            cacheAgeHours: calculateCacheAgeHours(cachedAt)
          }
        });
        continue;
      }

      if (cacheMode === 'read_only') {
        results.push({
          url: normalizedUrl,
          inspectionUrl: url,
          siteUrl,
          status: 'provider_error',
          errorCode: 'CACHE_MISS_READ_ONLY',
          errorMessage: 'No fresh cache entry and cacheMode is read_only',
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
          status: 'provider_error',
          cacheHit: false,
          apiCallMade: false,
          quotaUnitEstimate: 0
        });
        continue;
      }

      if (apiCallsMade >= maxApiCallsPerRun) {
        quotaLimited++;
        results.push({
          url: normalizedUrl,
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
        cacheMode: cacheMode === 'bypass' ? 'bypass' : cacheMode === 'write' ? 'write' : 'read_write',
        maxAgeHours,
        forceRefresh: cacheMode === 'bypass' ? options.forceRefresh === true : true
      });
      results.push({ status: 'ok', ...result });
    } catch (error) {
      errors++;
      results.push({
        url,
        inspectionUrl: url,
        siteUrl,
        status: 'provider_error',
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
      invalidUrls,
      forbiddenUrls,
      quotaLimited,
      quotaUnitEstimate: apiCallsMade
    },
    results
  };
}

function normalizeCacheMode(cacheMode?: InspectionCacheMode): EffectiveCacheMode {
  if (cacheMode === 'read') return 'read_only';
  if (cacheMode === 'write') return 'write';
  if (cacheMode === 'read_only' || cacheMode === 'bypass' || cacheMode === 'read_write') return cacheMode;
  return DEFAULT_CACHE_MODE;
}

function isInspectableUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isUrlAllowedForTenant(tenant: TenantContext, url: string) {
  return isUrlAllowedBySites(url, [
    ...(tenant.engines.google?.allowedSites || []),
    ...(tenant.engines.bing?.allowedSites || [])
  ]);
}

function emptyMetadata(tenantId: string, siteUrl: string, url: string): InspectionCacheMetadata {
  return {
    cacheHit: false,
    apiCallMade: false,
    quotaUnitEstimate: 0,
    cacheKey: createInspectionCacheKey(tenantId, siteUrl, url)
  };
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunkSize = Math.max(1, Math.floor(size));
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function cacheMissError(message: string) {
  const error = new Error(message) as Error & { code: string };
  error.code = 'CACHE_MISS';
  return error;
}
