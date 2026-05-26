import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { searchconsole_v1 } from 'googleapis';
import { sanitizeForLog } from '../../utils/redaction.js';
import { TenantContext } from '../../tenant/types.js';

export const INSPECTION_TOOL_VERSION = 'gsc-url-inspection-v1';
const DEFAULT_TTL_HOURS = 24;

export type InspectionCacheMode = 'read' | 'write' | 'read_write';

export interface NormalizedInspectionResult {
  inspectionUrl: string;
  siteUrl: string;
  verdict?: string;
  coverageState?: string;
  indexingState?: string;
  lastCrawlTime?: string;
  pageFetchState?: string;
  robotsTxtState?: string;
  googleCanonical?: string;
  userCanonical?: string;
  referringUrls: string[];
  sitemap: string[];
  inspectionResultLink?: string;
  raw: searchconsole_v1.Schema$InspectUrlIndexResponse;
}

export interface InspectionCacheMetadata {
  cacheHit: boolean;
  apiCallMade: boolean;
  quotaUnitEstimate: number;
  cacheKey: string;
  fetchedAt?: string;
  expiresAt?: string;
}

export interface CachedInspectionEntry {
  tenant_id: string;
  siteUrl: string;
  inspectionUrl: string;
  tool_version: string;
  raw?: searchconsole_v1.Schema$InspectUrlIndexResponse;
  normalized?: NormalizedInspectionResult;
  fetched_at: string;
  expires_at: string;
  api_status: 'ok' | 'error';
  error_code?: string;
  error_message?: string;
}

export interface InspectionResultWithMetadata extends NormalizedInspectionResult {
  metadata: InspectionCacheMetadata;
}

export interface InspectionCacheEvent {
  timestamp: string;
  tenant_id: string;
  siteUrl: string;
  inspectionUrl?: string;
  tool_version: string;
  status: string;
  cacheHit: boolean;
  apiCallMade: boolean;
  quotaUnitEstimate: number;
  error_code?: string;
}

export interface InspectionCacheStats {
  tenantId: string;
  siteUrl?: string;
  startDate?: string;
  endDate?: string;
  totalRequests: number;
  cacheHits: number;
  apiCalls: number;
  errors: number;
  quotaUnitEstimate: number;
}

export function normalizeInspectionResponse(
  siteUrl: string,
  inspectionUrl: string,
  raw: searchconsole_v1.Schema$InspectUrlIndexResponse
): NormalizedInspectionResult {
  const inspectionResult = raw.inspectionResult || {};
  const indexStatus = inspectionResult.indexStatusResult || {};

  return {
    inspectionUrl,
    siteUrl,
    verdict: indexStatus.verdict || undefined,
    coverageState: indexStatus.coverageState || undefined,
    indexingState: indexStatus.indexingState || undefined,
    lastCrawlTime: indexStatus.lastCrawlTime || undefined,
    pageFetchState: indexStatus.pageFetchState || undefined,
    robotsTxtState: indexStatus.robotsTxtState || undefined,
    googleCanonical: indexStatus.googleCanonical || undefined,
    userCanonical: indexStatus.userCanonical || undefined,
    referringUrls: Array.isArray(indexStatus.referringUrls) ? indexStatus.referringUrls : [],
    sitemap: Array.isArray(indexStatus.sitemap) ? indexStatus.sitemap : [],
    inspectionResultLink: inspectionResult.inspectionResultLink || undefined,
    raw
  };
}

export function createInspectionCacheKey(tenantId: string, siteUrl: string, inspectionUrl: string) {
  return `${tenantId}:${siteUrl}:${inspectionUrl}:${INSPECTION_TOOL_VERSION}`;
}

export function createInspectionCacheHash(cacheKey: string) {
  return createHash('sha256').update(cacheKey).digest('hex');
}

export function getInspectionCacheDir() {
  return process.env.MCP_INSPECTION_CACHE_DIR || join(homedir(), '.search-console-mcp-inspection-cache');
}

export function resetInspectionCacheForTests() {
  // Cache storage is file-backed only; this helper exists for a stable test import surface.
}

export function readFreshInspectionCache(
  tenantId: string,
  siteUrl: string,
  inspectionUrl: string,
  maxAgeHours = DEFAULT_TTL_HOURS
): { entry: CachedInspectionEntry; cacheKey: string } | undefined {
  const cacheKey = createInspectionCacheKey(tenantId, siteUrl, inspectionUrl);
  const path = entryPath(cacheKey);
  if (!existsSync(path)) return undefined;

  const entry = JSON.parse(readFileSync(path, 'utf8')) as CachedInspectionEntry;
  const now = Date.now();
  const fetchedAt = Date.parse(entry.fetched_at);
  const expiresAt = Date.parse(entry.expires_at);
  const maxAgeMs = Math.max(0, maxAgeHours) * 60 * 60 * 1000;
  const freshByAge = Number.isFinite(fetchedAt) && now - fetchedAt <= maxAgeMs;
  const freshByExpiry = Number.isFinite(expiresAt) && now <= expiresAt;

  if (entry.api_status === 'ok' && entry.normalized && freshByAge && freshByExpiry) {
    return { entry, cacheKey };
  }

  return undefined;
}

export function writeInspectionCacheEntry(
  tenantId: string,
  siteUrl: string,
  inspectionUrl: string,
  raw: searchconsole_v1.Schema$InspectUrlIndexResponse | undefined,
  normalized: NormalizedInspectionResult | undefined,
  options: { ttlHours?: number; apiStatus: 'ok' | 'error'; errorCode?: string; errorMessage?: string }
): CachedInspectionEntry {
  ensureCacheDirs();
  const fetchedAt = new Date();
  const ttlHours = options.ttlHours ?? DEFAULT_TTL_HOURS;
  const expiresAt = new Date(fetchedAt.getTime() + ttlHours * 60 * 60 * 1000);
  const entry: CachedInspectionEntry = {
    tenant_id: tenantId,
    siteUrl,
    inspectionUrl,
    tool_version: INSPECTION_TOOL_VERSION,
    raw,
    normalized,
    fetched_at: fetchedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    api_status: options.apiStatus,
    error_code: options.errorCode,
    error_message: options.errorMessage ? sanitizeForLog(options.errorMessage) : undefined
  };
  writeFileSync(entryPath(createInspectionCacheKey(tenantId, siteUrl, inspectionUrl)), `${JSON.stringify(entry, null, 2)}\n`, { mode: 0o600 });
  return entry;
}

export function appendInspectionCacheEvent(event: InspectionCacheEvent) {
  ensureCacheDirs();
  appendFileSync(eventsPath(), `${JSON.stringify({
    ...event,
    error_code: event.error_code ? sanitizeForLog(event.error_code) : undefined
  })}\n`, { mode: 0o600 });
}

export function getInspectionCacheStats(
  tenant: TenantContext,
  input: { siteUrl?: string; startDate?: string; endDate?: string }
): InspectionCacheStats {
  const stats: InspectionCacheStats = {
    tenantId: tenant.tenantId,
    siteUrl: input.siteUrl,
    startDate: input.startDate,
    endDate: input.endDate,
    totalRequests: 0,
    cacheHits: 0,
    apiCalls: 0,
    errors: 0,
    quotaUnitEstimate: 0
  };

  const path = eventsPath();
  if (!existsSync(path)) return stats;

  const start = input.startDate ? Date.parse(`${input.startDate}T00:00:00.000Z`) : undefined;
  const end = input.endDate ? Date.parse(`${input.endDate}T23:59:59.999Z`) : undefined;
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);

  for (const line of lines) {
    let event: InspectionCacheEvent;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    if (event.tenant_id !== tenant.tenantId) continue;
    if (input.siteUrl && event.siteUrl !== input.siteUrl) continue;

    const timestamp = Date.parse(event.timestamp);
    if (start !== undefined && timestamp < start) continue;
    if (end !== undefined && timestamp > end) continue;

    stats.totalRequests++;
    if (event.cacheHit) stats.cacheHits++;
    if (event.apiCallMade) stats.apiCalls++;
    if (event.status === 'error' || event.status === 'quota_limited') stats.errors++;
    stats.quotaUnitEstimate += event.quotaUnitEstimate || 0;
  }

  return stats;
}

export function listInspectionCacheFiles() {
  const dir = entriesDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(file => file.endsWith('.json')).map(file => join(dir, file));
}

function entryPath(cacheKey: string) {
  return join(entriesDir(), `${createInspectionCacheHash(cacheKey)}.json`);
}

function entriesDir() {
  return join(getInspectionCacheDir(), 'entries');
}

function eventsPath() {
  return join(getInspectionCacheDir(), 'events.jsonl');
}

function ensureCacheDirs() {
  mkdirSync(entriesDir(), { recursive: true, mode: 0o700 });
}
