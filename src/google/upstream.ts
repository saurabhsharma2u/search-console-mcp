import { getCurrentTenant } from '../tenant/context.js';
import { TenantContext } from '../tenant/types.js';
import { logger } from '../utils/logger.js';

const DEFAULT_GOOGLE_API_TIMEOUT_MS = 110_000;
const MIN_GOOGLE_API_TIMEOUT_MS = 1_000;
const MAX_GOOGLE_API_TIMEOUT_MS = 300_000;

export interface GoogleApiCallOptions {
  timeout: number;
}

export function getGoogleApiTimeoutMs(tenant: TenantContext | undefined = getCurrentTenant()): number {
  const override = parsePositiveInteger(process.env.MCP_GOOGLE_API_TIMEOUT_MS);
  if (override) {
    return clampTimeoutMs(override);
  }

  const tenantTimeoutSeconds = tenant?.limits.requestTimeoutSeconds;
  if (tenantTimeoutSeconds) {
    return clampTimeoutMs(tenantTimeoutSeconds * 1000);
  }

  return DEFAULT_GOOGLE_API_TIMEOUT_MS;
}

export async function runGoogleApiCall<T>(
  operation: string,
  call: (options: GoogleApiCallOptions) => Promise<T>
): Promise<T> {
  const tenant = getCurrentTenant();
  const timeoutMs = getGoogleApiTimeoutMs(tenant);
  const startedAt = Date.now();

  try {
    const result = await call({ timeout: timeoutMs });
    logger.info('Google API call completed', {
      tenantId: tenant?.tenantId || 'none',
      operation,
      durationMs: Date.now() - startedAt,
      timeoutMs,
      status: 'ok'
    });
    return result;
  } catch (error) {
    logger.warn('Google API call failed', {
      tenantId: tenant?.tenantId || 'none',
      operation,
      durationMs: Date.now() - startedAt,
      timeoutMs,
      status: 'error',
      upstreamStatus: getUpstreamStatus(error)
    });
    throw error;
  }
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

function clampTimeoutMs(value: number): number {
  return Math.min(MAX_GOOGLE_API_TIMEOUT_MS, Math.max(MIN_GOOGLE_API_TIMEOUT_MS, value));
}

function getUpstreamStatus(error: unknown): string {
  const err = error as {
    code?: string | number;
    status?: string | number;
    response?: { status?: string | number };
  };
  return String(err?.response?.status || err?.status || err?.code || 'unknown');
}
