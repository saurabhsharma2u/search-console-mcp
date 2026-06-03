import { AsyncLocalStorage } from 'node:async_hooks';
import { TenantContext } from './types.js';

const tenantStorage = new AsyncLocalStorage<TenantContext>();

export function runWithTenant<T>(tenant: TenantContext | undefined, fn: () => T): T {
    if (!tenant) return fn();
    return tenantStorage.run(tenant, fn);
}

export function getCurrentTenant(): TenantContext | undefined {
    return tenantStorage.getStore();
}

export function isTenantRequired(): boolean {
    return process.env.MCP_REQUIRE_TENANT_TOKEN === 'true' || process.env.MCP_PRODUCTION_MODE === 'true';
}
