import { afterEach, describe, expect, it, vi } from 'vitest';
import { getGoogleApiTimeoutMs, runGoogleApiCall } from '../src/google/upstream.js';

describe('Google upstream timeout handling', () => {
  afterEach(() => {
    delete process.env.MCP_GOOGLE_API_TIMEOUT_MS;
    vi.restoreAllMocks();
  });

  it('uses explicit environment timeout when configured', () => {
    process.env.MCP_GOOGLE_API_TIMEOUT_MS = '45000';
    expect(getGoogleApiTimeoutMs()).toBe(45000);
  });

  it('falls back to tenant request timeout when no override is configured', () => {
    expect(getGoogleApiTimeoutMs({
      tenantId: 'tenant-a',
      displayName: 'Tenant A',
      admin: false,
      allowedTools: [],
      deniedTools: [],
      allowMutations: false,
      allowedMutatingTools: [],
      engines: {},
      limits: {
        maxRows: 100,
        maxBatchUrls: 10,
        requestTimeoutSeconds: 42
      },
      indexNowKeys: {}
    })).toBe(42000);
  });

  it('passes timeout options to wrapped provider call', async () => {
    process.env.MCP_GOOGLE_API_TIMEOUT_MS = '12345';
    const call = vi.fn().mockResolvedValue('ok');

    const result = await runGoogleApiCall('test.operation', call);

    expect(result).toBe('ok');
    expect(call).toHaveBeenCalledWith({ timeout: 12345 });
  });
});
