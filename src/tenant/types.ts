import { z } from 'zod';

export const EnginePolicySchema = z.object({
    account_ids: z.array(z.string()).default([]),
    allowed_sites: z.array(z.string()).default([]),
    default_site: z.string().optional()
});

export const GA4PolicySchema = z.object({
    account_ids: z.array(z.string()).default([]),
    allowed_properties: z.array(z.string()).default([])
});

export const TenantConfigSchema = z.object({
    tenant_id: z.string().min(1),
    display_name: z.string().min(1),
    enabled: z.boolean().default(true),
    admin: z.boolean().optional().default(false),
    engines: z.object({
        google: EnginePolicySchema.optional(),
        bing: EnginePolicySchema.optional(),
        ga4: GA4PolicySchema.optional()
    }).default({}),
    allowed_tools: z.array(z.string()).default([]),
    denied_tools: z.array(z.string()).default([]),
    allow_mutations: z.boolean().optional().default(false),
    allowed_mutating_tools: z.array(z.string()).optional().default([]),
    limits: z.object({
        max_rows: z.number().int().positive().default(25000),
        max_batch_urls: z.number().int().positive().default(10),
        request_timeout_seconds: z.number().int().positive().default(120)
    }).default({
        max_rows: 25000,
        max_batch_urls: 10,
        request_timeout_seconds: 120
    }),
    indexnow: z.object({
        keys: z.record(z.string(), z.object({
            key: z.string(),
            key_location: z.string().optional()
        })).default({})
    }).optional()
});

export const TokenRecordSchema = z.object({
    token_id: z.string().min(1),
    tenant_id: z.string().min(1),
    token_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    enabled: z.boolean().default(true),
    created_at: z.string().optional(),
    description: z.string().optional()
});

export const TokenRegistrySchema = z.object({
    tokens: z.array(TokenRecordSchema).default([])
});

export type TenantConfig = z.infer<typeof TenantConfigSchema>;
export type TokenRecord = z.infer<typeof TokenRecordSchema>;
export type TokenRegistry = z.infer<typeof TokenRegistrySchema>;

export interface TenantContext {
    tenantId: string;
    displayName: string;
    admin: boolean;
    allowedTools: string[];
    deniedTools: string[];
    allowMutations: boolean;
    allowedMutatingTools: string[];
    engines: {
        google?: {
            accountIds: string[];
            allowedSites: string[];
            defaultSite?: string;
        };
        bing?: {
            accountIds: string[];
            allowedSites: string[];
            defaultSite?: string;
        };
        ga4?: {
            accountIds: string[];
            allowedProperties: string[];
        };
    };
    limits: {
        maxRows: number;
        maxBatchUrls: number;
        requestTimeoutSeconds: number;
    };
    indexNowKeys: Record<string, { key: string; keyLocation?: string }>;
}

export function toTenantContext(config: TenantConfig): TenantContext {
    return {
        tenantId: config.tenant_id,
        displayName: config.display_name,
        admin: !!config.admin,
        allowedTools: config.allowed_tools,
        deniedTools: config.denied_tools,
        allowMutations: !!config.allow_mutations,
        allowedMutatingTools: config.allowed_mutating_tools || [],
        engines: {
            google: config.engines.google ? {
                accountIds: config.engines.google.account_ids,
                allowedSites: config.engines.google.allowed_sites,
                defaultSite: config.engines.google.default_site
            } : undefined,
            bing: config.engines.bing ? {
                accountIds: config.engines.bing.account_ids,
                allowedSites: config.engines.bing.allowed_sites,
                defaultSite: config.engines.bing.default_site
            } : undefined,
            ga4: config.engines.ga4 ? {
                accountIds: config.engines.ga4.account_ids,
                allowedProperties: config.engines.ga4.allowed_properties
            } : undefined
        },
        limits: {
            maxRows: config.limits.max_rows,
            maxBatchUrls: config.limits.max_batch_urls,
            requestTimeoutSeconds: config.limits.request_timeout_seconds
        },
        indexNowKeys: Object.fromEntries(
            Object.entries(config.indexnow?.keys || {}).map(([host, value]) => [
                host.toLowerCase(),
                { key: value.key, keyLocation: value.key_location }
            ])
        )
    };
}
