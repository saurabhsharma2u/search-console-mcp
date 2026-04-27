import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    appendTokenRecord,
    createTokenRecord,
    getTenantsDir,
    getTokenRegistryPath,
    loadTokenRegistry,
    resetTenantRegistryCache
} from './registry.js';
import { TenantConfig, TenantConfigSchema, TokenRegistrySchema } from './types.js';

export async function main(argv: string[]) {
    const namespace = argv[0];
    const command = argv[1];
    const args = parseArgs(argv.slice(2));

    if (namespace === 'tenants') {
        if (command === 'list') return tenantsList();
        if (command === 'validate') return tenantsValidate();
        if (command === 'add') return tenantsAdd(args);
    }

    if (namespace === 'tokens') {
        if (command === 'create') return tokensCreate(args);
        if (command === 'revoke') return tokensRevoke(args);
    }

    printUsage();
    process.exitCode = 1;
}

function tenantsList() {
    const dir = getTenantsDir();
    if (!existsSync(dir)) {
        console.log(`No tenant directory found at ${dir}`);
        return;
    }

    for (const file of readdirSync(dir).filter(file => file.endsWith('.json')).sort()) {
        const parsed = TenantConfigSchema.parse(JSON.parse(readFileSync(join(dir, file), 'utf8')));
        console.log(`${parsed.tenant_id}\t${parsed.enabled === false ? 'disabled' : 'enabled'}\t${parsed.display_name}`);
    }
}

function tenantsValidate() {
    const dir = getTenantsDir();
    let count = 0;
    if (!existsSync(dir)) {
        throw new Error(`Tenant directory does not exist: ${dir}`);
    }

    for (const file of readdirSync(dir).filter(file => file.endsWith('.json')).sort()) {
        TenantConfigSchema.parse(JSON.parse(readFileSync(join(dir, file), 'utf8')));
        count++;
    }

    TokenRegistrySchema.parse(JSON.parse(readFileSync(getTokenRegistryPath(), 'utf8')));
    console.log(`OK: validated ${count} tenant(s) and token registry`);
}

function tenantsAdd(args: Record<string, string | boolean>) {
    const tenantId = requireStringArg(args, 'tenant');
    const site = requireStringArg(args, 'site');
    const dir = getTenantsDir();
    mkdirSync(dir, { recursive: true });

    const path = join(dir, `${safeFileName(tenantId)}.json`);
    const existing: TenantConfig = existsSync(path)
        ? TenantConfigSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
        : {
            tenant_id: tenantId,
            display_name: tenantId,
            enabled: true,
            admin: false,
            engines: {
                google: {
                    account_ids: [],
                    allowed_sites: [],
                    default_site: site
                }
            },
            allowed_tools: [
                'get_started',
                'sites_list',
                'analytics_*',
                'seo_*',
                'inspection_*',
                'pagespeed_*',
                'schema_validate'
            ],
            denied_tools: [
                'sites_add',
                'sites_delete',
                'sitemaps_submit',
                'sitemaps_delete',
                'bing_index_now'
            ],
            allow_mutations: false,
            allowed_mutating_tools: [],
            limits: {
                max_rows: 25000,
                max_batch_urls: 10,
                request_timeout_seconds: 120
            }
        };

    existing.engines.google ||= { account_ids: [], allowed_sites: [], default_site: site };
    if (!existing.engines.google.allowed_sites.includes(site)) {
        existing.engines.google.allowed_sites.push(site);
    }
    existing.engines.google.default_site ||= site;

    const parsed = TenantConfigSchema.parse(existing);
    writeFileSync(path, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
    resetTenantRegistryCache();
    console.log(`Tenant ${tenantId} saved at ${path}`);
}

function tokensCreate(args: Record<string, string | boolean>) {
    const tenantId = requireStringArg(args, 'tenant');
    const description = typeof args.description === 'string' ? args.description : undefined;
    const tokenId = typeof args['token-id'] === 'string' ? args['token-id'] : undefined;
    const { plaintext, record } = createTokenRecord(tenantId, description, tokenId);

    appendTokenRecord(record);

    console.log(`token_id: ${record.token_id}`);
    console.log(`tenant_id: ${record.tenant_id}`);
    console.log(`bearer_token: ${plaintext}`);
    console.log('Store this bearer token now. It will not be shown again.');
}

function tokensRevoke(args: Record<string, string | boolean>) {
    const tokenId = requireStringArg(args, 'token-id');
    const path = getTokenRegistryPath();
    const registry = loadTokenRegistry();
    const token = registry.tokens.find(token => token.token_id === tokenId);
    if (!token) throw new Error(`Token not found: ${tokenId}`);

    const next = {
        tokens: registry.tokens.map(token => token.token_id === tokenId ? { ...token, enabled: false } : token)
    };
    writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    resetTenantRegistryCache();
    console.log(`Revoked token ${tokenId}`);
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
    const args: Record<string, string | boolean> = {};
    for (let i = 0; i < argv.length; i++) {
        const value = argv[i];
        if (!value.startsWith('--')) continue;
        const eq = value.indexOf('=');
        if (eq >= 0) {
            args[value.slice(2, eq)] = value.slice(eq + 1);
            continue;
        }
        const key = value.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
            args[key] = next;
            i++;
        } else {
            args[key] = true;
        }
    }
    return args;
}

function requireStringArg(args: Record<string, string | boolean>, key: string): string {
    const value = args[key];
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`Missing required --${key}`);
    }
    return value;
}

function safeFileName(value: string): string {
    if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
        throw new Error('Tenant ID may only contain letters, numbers, dots, underscores, and dashes');
    }
    return value;
}

function printUsage() {
    console.error(`Usage:
  search-console-mcp tenants list
  search-console-mcp tenants validate
  search-console-mcp tenants add --tenant=<id> --site=<siteUrl>
  search-console-mcp tokens create --tenant=<id> [--description=<text>] [--token-id=<id>]
  search-console-mcp tokens revoke --token-id=<id>`);
}
