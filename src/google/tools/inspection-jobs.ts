import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sanitizeForLog } from '../../utils/redaction.js';
import { forbidden, notFound } from '../../tenant/errors.js';
import { TenantContext } from '../../tenant/types.js';
import { assertGoogleSiteAllowed } from '../../tenant/guard.js';
import { getInspectionCacheDir, InspectionCacheMode } from './inspection-cache.js';
import { inspectBatchWithCache } from './inspection.js';

export type InspectionBatchJobStatus = 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';

export interface InspectionBatchJob {
  jobId: string;
  tenantId: string;
  siteUrl: string;
  status: InspectionBatchJobStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  expiresAt: string;
  requestedUrls: number;
  processedUrls: number;
  cacheMode: InspectionCacheMode;
  maxAgeHours: number;
  forceRefresh: boolean;
  maxApiCallsPerRun: number;
  languageCode?: string;
  cancelRequested?: boolean;
  errorMessage?: string;
  summary: InspectionBatchJobSummary;
}

export interface InspectionBatchJobSummary {
  requested: number;
  returned: number;
  cacheHits: number;
  apiCallsMade: number;
  errors: number;
  invalidUrls: number;
  forbiddenUrls: number;
  quotaLimited: number;
  quotaUnitEstimate: number;
}

export interface InspectionBatchJobResults {
  jobId: string;
  tenantId: string;
  siteUrl: string;
  status: InspectionBatchJobStatus;
  summary: InspectionBatchJobSummary;
  results: any[];
}

export interface StartInspectionBatchJobInput {
  siteUrl: string;
  urls: string[];
  tenant: TenantContext;
  cacheMode?: InspectionCacheMode;
  maxAgeHours?: number;
  forceRefresh?: boolean;
  languageCode?: string;
  maxApiCallsPerRun?: number;
}

const DEFAULT_MAX_AGE_HOURS = 24;
const DEFAULT_CACHE_MODE: InspectionCacheMode = 'read_write';
const DEFAULT_JOB_RETENTION_HOURS = 24;
const DEFAULT_RESULTS_LIMIT = 100;
const DEFAULT_MAX_RESULTS_LIMIT = 1000;

export function startInspectionBatchJob(input: StartInspectionBatchJobInput) {
  cleanupExpiredInspectionJobs();
  assertGoogleSiteAllowed(input.tenant, input.siteUrl);

  const now = new Date().toISOString();
  const expiresAt = new Date(Date.parse(now) + jobRetentionHours() * 60 * 60 * 1000).toISOString();
  const job: InspectionBatchJob = {
    jobId: randomUUID(),
    tenantId: input.tenant.tenantId,
    siteUrl: input.siteUrl,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    expiresAt,
    requestedUrls: input.urls.length,
    processedUrls: 0,
    cacheMode: input.cacheMode || DEFAULT_CACHE_MODE,
    maxAgeHours: input.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS,
    forceRefresh: input.forceRefresh === true,
    maxApiCallsPerRun: input.maxApiCallsPerRun ?? input.tenant.limits.maxBatchUrls ?? 10,
    languageCode: input.languageCode,
    summary: emptySummary(input.urls.length)
  };

  writeJob(job);
  writeJobInput(job.jobId, input.urls);
  writeJobResults({
    jobId: job.jobId,
    tenantId: job.tenantId,
    siteUrl: job.siteUrl,
    status: job.status,
    summary: job.summary,
    results: []
  });

  void runJobSoon(job.jobId, tenantForWorker(input.tenant));

  return {
    jobId: job.jobId,
    status: job.status,
    tenantId: job.tenantId,
    siteUrl: job.siteUrl,
    requestedUrls: job.requestedUrls,
    maxApiCallsPerRun: job.maxApiCallsPerRun,
    cacheMode: job.cacheMode,
    maxAgeHours: job.maxAgeHours,
    createdAt: job.createdAt,
    expiresAt: job.expiresAt
  };
}

export function getInspectionBatchJobStatus(tenant: TenantContext, jobId: string) {
  cleanupExpiredInspectionJobs();
  const job = readAuthorizedJob(tenant, jobId);
  return {
    jobId: job.jobId,
    tenantId: job.tenantId,
    siteUrl: job.siteUrl,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    expiresAt: job.expiresAt,
    requestedUrls: job.requestedUrls,
    processedUrls: job.processedUrls,
    cacheMode: job.cacheMode,
    maxAgeHours: job.maxAgeHours,
    forceRefresh: job.forceRefresh,
    maxApiCallsPerRun: job.maxApiCallsPerRun,
    cancelRequested: job.cancelRequested === true,
    errorMessage: job.errorMessage,
    summary: job.summary
  };
}

export function getInspectionBatchJobResults(
  tenant: TenantContext,
  jobId: string,
  options: { offset?: number; limit?: number } = {}
) {
  cleanupExpiredInspectionJobs();
  const job = readAuthorizedJob(tenant, jobId);
  const stored = readJobResults(jobId);
  const offset = Math.max(0, options.offset ?? 0);
  const limit = normalizeResultsLimit(options.limit);
  const results = stored.results.slice(offset, offset + limit);
  return {
    jobId: job.jobId,
    tenantId: job.tenantId,
    siteUrl: job.siteUrl,
    status: job.status,
    summary: job.summary,
    pagination: {
      offset,
      limit,
      returned: results.length,
      total: stored.results.length,
      hasMore: offset + results.length < stored.results.length
    },
    results
  };
}

export function cancelInspectionBatchJob(tenant: TenantContext, jobId: string) {
  cleanupExpiredInspectionJobs();
  const job = readAuthorizedJob(tenant, jobId);
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
    return {
      jobId: job.jobId,
      status: job.status,
      cancelAccepted: false
    };
  }

  const now = new Date().toISOString();
  job.cancelRequested = true;
  if (job.status === 'queued') {
    job.status = 'cancelled';
    job.completedAt = now;
  }
  job.updatedAt = now;
  writeJob(job);
  return {
    jobId: job.jobId,
    status: job.status,
    cancelAccepted: true
  };
}

async function runJobSoon(jobId: string, tenant: TenantContext) {
  setTimeout(() => {
    runInspectionBatchJob(jobId, tenant).catch(error => failJob(jobId, error));
  }, 0);
}

async function runInspectionBatchJob(jobId: string, tenant: TenantContext) {
  let job = readJob(jobId);
  if (job.status === 'cancelled' || job.cancelRequested) return;

  const urls = readJobInput(jobId);
  const results = readJobResults(jobId);
  const now = new Date().toISOString();
  job.status = 'running';
  job.startedAt = job.startedAt || now;
  job.updatedAt = now;
  writeJob(job);

  const chunkSize = Number(process.env.MCP_INSPECTION_JOB_CHUNK_SIZE || process.env.MCP_INSPECTION_CHUNK_SIZE || 25);
  for (const chunk of chunkArray(urls, chunkSize)) {
    job = readJob(jobId);
    if (job.cancelRequested || job.status === 'cancelled') {
      job.status = 'cancelled';
      job.completedAt = new Date().toISOString();
      job.updatedAt = job.completedAt;
      writeJob(job);
      results.status = job.status;
      writeJobResults(results);
      return;
    }

    const remainingApiCalls = Math.max(0, job.maxApiCallsPerRun - job.summary.apiCallsMade);
    const batch = await inspectBatchWithCache(job.siteUrl, chunk, tenant, {
      cacheMode: job.cacheMode,
      maxAgeHours: job.maxAgeHours,
      forceRefresh: job.forceRefresh,
      languageCode: job.languageCode,
      maxApiCallsPerRun: remainingApiCalls
    });

    results.results.push(...batch.results);
    mergeSummary(job.summary, batch.summary);
    job.processedUrls = results.results.length;
    job.updatedAt = new Date().toISOString();
    results.status = job.status;
    results.summary = job.summary;
    writeJob(job);
    writeJobResults(results);
  }

  job.status = 'completed';
  job.completedAt = new Date().toISOString();
  job.updatedAt = job.completedAt;
  results.status = job.status;
  results.summary = job.summary;
  writeJob(job);
  writeJobResults(results);
}

function failJob(jobId: string, error: unknown) {
  try {
    const job = readJob(jobId);
    job.status = 'failed';
    job.errorMessage = sanitizeForLog((error as Error).message || 'Inspection batch job failed');
    job.completedAt = new Date().toISOString();
    job.updatedAt = job.completedAt;
    writeJob(job);
    const results = readJobResults(jobId);
    results.status = 'failed';
    results.summary = job.summary;
    writeJobResults(results);
  } catch {
    // Nothing useful to do if the job files disappeared while the worker was failing.
  }
}

function readAuthorizedJob(tenant: TenantContext, jobId: string) {
  const job = readJob(jobId);
  if (job.tenantId !== tenant.tenantId) {
    throw forbidden('403 Forbidden: job is not allowed for this tenant');
  }
  return job;
}

function readJob(jobId: string): InspectionBatchJob {
  const path = jobPath(jobId);
  if (!existsSync(path)) throw notFound('404 Not Found: inspection batch job was not found');
  return JSON.parse(readFileSync(path, 'utf8')) as InspectionBatchJob;
}

function writeJob(job: InspectionBatchJob) {
  ensureJobDir();
  writeFileSync(jobPath(job.jobId), `${JSON.stringify(job, null, 2)}\n`, { mode: 0o600 });
}

function readJobInput(jobId: string): string[] {
  return JSON.parse(readFileSync(inputPath(jobId), 'utf8')) as string[];
}

function writeJobInput(jobId: string, urls: string[]) {
  ensureJobDir();
  writeFileSync(inputPath(jobId), `${JSON.stringify(urls)}\n`, { mode: 0o600 });
}

function readJobResults(jobId: string): InspectionBatchJobResults {
  const path = resultsPath(jobId);
  if (!existsSync(path)) {
    const job = readJob(jobId);
    return {
      jobId: job.jobId,
      tenantId: job.tenantId,
      siteUrl: job.siteUrl,
      status: job.status,
      summary: job.summary,
      results: []
    };
  }
  return JSON.parse(readFileSync(path, 'utf8')) as InspectionBatchJobResults;
}

function writeJobResults(results: InspectionBatchJobResults) {
  ensureJobDir();
  writeFileSync(resultsPath(results.jobId), `${JSON.stringify(results, null, 2)}\n`, { mode: 0o600 });
}

export function cleanupExpiredInspectionJobs(now = Date.now()) {
  const dir = jobsDir();
  if (!existsSync(dir)) return;

  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json') || file.endsWith('.input.json') || file.endsWith('.results.json')) continue;
    const jobId = file.slice(0, -'.json'.length);
    try {
      const job = readJob(jobId);
      if (!isTerminalJob(job)) continue;
      const expiresAt = Date.parse(job.expiresAt || '');
      if (Number.isFinite(expiresAt) && now >= expiresAt) {
        deleteJobFiles(job.jobId);
      }
    } catch {
      continue;
    }
  }
}

function jobPath(jobId: string) {
  return join(jobsDir(), `${safeJobId(jobId)}.json`);
}

function inputPath(jobId: string) {
  return join(jobsDir(), `${safeJobId(jobId)}.input.json`);
}

function resultsPath(jobId: string) {
  return join(jobsDir(), `${safeJobId(jobId)}.results.json`);
}

function jobsDir() {
  return join(getInspectionCacheDir(), 'jobs');
}

function ensureJobDir() {
  mkdirSync(jobsDir(), { recursive: true, mode: 0o700 });
}

function deleteJobFiles(jobId: string) {
  for (const path of [jobPath(jobId), inputPath(jobId), resultsPath(jobId)]) {
    try {
      if (existsSync(path)) unlinkSync(path);
    } catch {
      // Best-effort cleanup should never affect active tool calls.
    }
  }
}

function safeJobId(jobId: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(jobId)) {
    throw notFound('404 Not Found: inspection batch job was not found');
  }
  return jobId;
}

function emptySummary(requested: number): InspectionBatchJobSummary {
  return {
    requested,
    returned: 0,
    cacheHits: 0,
    apiCallsMade: 0,
    errors: 0,
    invalidUrls: 0,
    forbiddenUrls: 0,
    quotaLimited: 0,
    quotaUnitEstimate: 0
  };
}

function normalizeResultsLimit(limit?: number) {
  const maxLimit = Math.max(1, Number(process.env.MCP_INSPECTION_JOB_MAX_RESULTS_LIMIT || DEFAULT_MAX_RESULTS_LIMIT));
  const requested = limit === undefined ? DEFAULT_RESULTS_LIMIT : Math.max(0, Math.floor(limit));
  return Math.min(requested, maxLimit);
}

function jobRetentionHours() {
  const configured = Number(process.env.MCP_INSPECTION_JOB_RETENTION_HOURS || DEFAULT_JOB_RETENTION_HOURS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_JOB_RETENTION_HOURS;
}

function isTerminalJob(job: InspectionBatchJob) {
  return job.status === 'completed' || job.status === 'cancelled' || job.status === 'failed';
}

function tenantForWorker(tenant: TenantContext): TenantContext {
  return {
    ...tenant,
    indexNowKeys: {}
  };
}

function mergeSummary(target: InspectionBatchJobSummary, source: InspectionBatchJobSummary) {
  target.returned += source.returned;
  target.cacheHits += source.cacheHits;
  target.apiCallsMade += source.apiCallsMade;
  target.errors += source.errors;
  target.invalidUrls += source.invalidUrls;
  target.forbiddenUrls += source.forbiddenUrls;
  target.quotaLimited += source.quotaLimited;
  target.quotaUnitEstimate += source.quotaUnitEstimate;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunkSize = Math.max(1, Math.floor(size));
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}
