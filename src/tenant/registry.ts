import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { TenantConfigSchema, TokenRegistrySchema, TenantContext, TokenRecord, toTenantContext } from './types.js';
import { unauthorized } from './errors.js';

let cachedTenants: Map<string, TenantContext> | null = null;
let cachedTokenRegistry: ReturnType<typeof TokenRegistrySchema.parse> | null = null;

export function resetTenantRegistryCache() {
    cachedTenants = null;
    cachedTokenRegistry = null;
}

export function getTenantsDir(): string {
    return process.env.MCP_TENANTS_DIR || '/etc/search-console-mcp/tenants';
}

export function getTokenRegistryPath(): string {
    return process.env.MCP_TOKEN_REGISTRY || '/etc/search-console-mcp/tokens/tokens.json';
}

export function hashBearerToken(token: string): string {
    return `sha256:${createHash('sha256').update(token).digest('hex')}`;
}

export function generateBearerToken(): string {
    return `scmcp_${randomBytes(32).toString('base64url')}`;
}

export function loadTenants(): Map<string, TenantContext> {
    if (cachedTenants) return cachedTenants;

    const tenants = new Map<string, TenantContext>();
    const dir = getTenantsDir();
    if (!existsSync(dir)) {
        cachedTenants = tenants;
        return tenants;
    }

    for (const file of readdirSync(dir)) {
        if (!file.endsWith('.json')) continue;
        const raw = JSON.parse(readFileSync(join(dir, file), 'utf8'));
        const parsed = TenantConfigSchema.parse(raw);
        const context = toTenantContext(parsed);
        tenants.set(context.tenantId, context);
    }

    cachedTenants = tenants;
    return tenants;
}

export function loadTokenRegistry() {
    if (cachedTokenRegistry) return cachedTokenRegistry;

    const path = getTokenRegistryPath();
    if (!existsSync(path)) {
        cachedTokenRegistry = { tokens: [] };
        return cachedTokenRegistry;
    }

    cachedTokenRegistry = TokenRegistrySchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    return cachedTokenRegistry;
}

export function resolveBearerToken(token: string): { token: TokenRecord; tenant: TenantContext } {
    const hash = hashBearerToken(token);
    const tokenRecord = loadTokenRegistry().tokens.find(t => t.token_hash === hash);

    if (!tokenRecord || !tokenRecord.enabled) {
        throw unauthorized('Invalid or disabled bearer token');
    }

    const tenant = loadTenants().get(tokenRecord.tenant_id);
    if (!tenant) {
        throw unauthorized('Bearer token tenant does not exist');
    }

    if (!isEnabledTenant(tenant)) {
        throw unauthorized('Bearer token tenant is disabled');
    }

    return { token: tokenRecord, tenant };
}

function isEnabledTenant(tenant: TenantContext): boolean {
    const raw = loadRawTenant(tenant.tenantId);
    return raw?.enabled !== false;
}

function loadRawTenant(tenantId: string): { enabled?: boolean } | null {
    const path = join(getTenantsDir(), `${tenantId}.json`);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
}

export function createTokenRecord(tenantId: string, description?: string, tokenId?: string): { plaintext: string; record: TokenRecord } {
    const plaintext = generateBearerToken();
    const id = tokenId || `${tenantId}-${Date.now()}`;
    return {
        plaintext,
        record: {
            token_id: id,
            tenant_id: tenantId,
            token_hash: hashBearerToken(plaintext),
            enabled: true,
            created_at: new Date().toISOString(),
            description
        }
    };
}

export function appendTokenRecord(record: TokenRecord) {
    const path = getTokenRegistryPath();
    const registry = loadTokenRegistry();
    const next = { tokens: [...registry.tokens, record] };
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(next, null, 2), { mode: 0o600 });
    cachedTokenRegistry = next;
}
