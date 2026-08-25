import { readFileSync, writeFileSync, existsSync, unlinkSync, statSync, accessSync, constants } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { createCipheriv, createDecipheriv, scryptSync, randomBytes } from 'crypto';
import nodeMachineId from 'node-machine-id';

const { machineIdSync } = nodeMachineId;

const CONFIG_PATH = join(homedir(), '.search-console-mcp-config.enc');
const LEGACY_TOKEN_PATH = join(homedir(), '.search-console-mcp-tokens.enc');
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

export type EngineType = 'google' | 'bing' | 'ga4' | 'adsense';

export interface AccountConfig {
    id: string;
    engine: EngineType;
    alias: string;
    websites?: string[];
    // Google specific
    tokens?: {
        refresh_token?: string | null;
        expiry_date?: number | null;
        access_token?: string | null;
    };
    serviceAccountPath?: string;
    // Bing specific
    apiKey?: string;
    // GA4 specific
    ga4PropertyId?: string;
    // AdSense specific
    adsenseAccountId?: string;
    // Metadata for migration
    isLegacy?: boolean;
}

export interface AppConfig {
    accounts: Record<string, AccountConfig>;
    /** UI state (e.g. star-ask shown once) — never contains credentials. */
    starAskShown?: boolean;
}

let cachedConfig: AppConfig | null = null;

let cachedEncryptionKey: Buffer | null = null;

export function resetConfigCache() {
    cachedConfig = null;
    cachedEncryptionKey = null;
}

function getEncryptionKey(): Buffer {
    if (cachedEncryptionKey) {
        return cachedEncryptionKey;
    }
    const mId = machineIdSync();
    const salt = process.env.USER || 'sc-mcp-salt';
    cachedEncryptionKey = scryptSync(mId, salt, 32);
    return cachedEncryptionKey;
}

function encrypt(text: string): string {
    const iv = randomBytes(12);
    const key = getEncryptionKey();
    const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(data: string): string {
    const [ivHex, authTagHex, encryptedHex] = data.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const key = getEncryptionKey();
    const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

/**
 * Load the unified configuration, including lazy migration from legacy Google tokens.
 */
export async function loadConfig(): Promise<AppConfig> {
    if (cachedConfig) {
        return cachedConfig;
    }

    let config: AppConfig = { accounts: {} };

    // 1. Try to load from new unified config
    if (existsSync(CONFIG_PATH)) {
        try {
            const encryptedData = readFileSync(CONFIG_PATH, 'utf-8');
            const decrypted = decrypt(encryptedData);
            config = JSON.parse(decrypted);
        } catch (e) {
            console.error('Failed to load unified config:', (e as Error).message);
        }
    }

    // 2. Performance Lazy Migration from legacy Google tokens
    if (existsSync(LEGACY_TOKEN_PATH)) {
        try {
            const encryptedData = readFileSync(LEGACY_TOKEN_PATH, 'utf-8');
            const decrypted = decrypt(encryptedData);
            const googleTokens = JSON.parse(decrypted);

            for (const [email, tokens] of Object.entries(googleTokens)) {
                const id = `google_${email.replace(/[^a-zA-Z0-9]/g, '_')}`;
                if (!config.accounts[id]) {
                    config.accounts[id] = {
                        id,
                        engine: 'google',
                        alias: email,
                        tokens: tokens as any,
                        isLegacy: true
                    };
                }
            }
        } catch (e) {
            // Ignore migration errors
        }
    }

    // 3. Check for Google Environment Variables (Legacy)
    const hasServiceAccount = !!process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const hasJwt = !!process.env.GOOGLE_CLIENT_EMAIL && !!process.env.GOOGLE_PRIVATE_KEY;

    if (hasServiceAccount || hasJwt) {
        const id = 'legacy_google';
        if (!config.accounts[id]) {
            config.accounts[id] = {
                id,
                engine: 'google',
                alias: process.env.GOOGLE_CLIENT_EMAIL || 'Service Account (env)',
                serviceAccountPath: process.env.GOOGLE_APPLICATION_CREDENTIALS,
                isLegacy: true
            };
        }
    }

    // 3b. Check for legacy OAuth tokens (unencrypted JSON file)
    const LEGACY_JSON_TOKEN_PATH = join(homedir(), '.search-console-mcp-tokens.json');
    if (existsSync(LEGACY_JSON_TOKEN_PATH)) {
        try {
            const raw = readFileSync(LEGACY_JSON_TOKEN_PATH, 'utf-8');
            const legacyTokens = JSON.parse(raw);
            const id = 'legacy_google_oauth';
            if (!config.accounts[id] && legacyTokens.refresh_token) {
                config.accounts[id] = {
                    id,
                    engine: 'google',
                    alias: 'OAuth Account (tokens.json)',
                    tokens: {
                        refresh_token: legacyTokens.refresh_token,
                        expiry_date: legacyTokens.expiry_date,
                        access_token: legacyTokens.access_token
                    },
                    isLegacy: true
                };
            }
        } catch (e) {
            // Ignore parse errors
        }
    }

    // 4. Check for Bing Environment Variable (Legacy)
    const bingApiKey = process.env.BING_API_KEY;
    if (bingApiKey) {
        const id = 'legacy_bing';
        if (!config.accounts[id]) {
            config.accounts[id] = {
                id,
                engine: 'bing',
                alias: 'Bing API Key (env)',
                apiKey: bingApiKey,
                isLegacy: true
            };
        }
    }

    cachedConfig = config;
    return config;
}

export async function saveConfig(config: AppConfig) {
    try {
        const encrypted = encrypt(JSON.stringify(config));
        writeFileSync(CONFIG_PATH, encrypted, { mode: 0o600 });
        cachedConfig = config;
    } catch (e) {
        console.error('Failed to save config:', (e as Error).message);
        throw e;
    }
}

export async function updateAccount(account: AccountConfig) {
    const config = await loadConfig();
    config.accounts[account.id] = account;
    await saveConfig(config);
}

/**
 * True when the account references a service account key file that no
 * longer exists on disk. Used by status display (⚠ key file missing)
 * and as a pre-flight check before client construction.
 */
export function isServiceAccountKeyMissing(account: AccountConfig): boolean {
    if (!account.serviceAccountPath) return false;
    const resolved = resolve(String(account.serviceAccountPath).replace(/^~(?=$|\/)/, homedir()));
    try {
        if (!statSync(resolved).isFile()) return true;
        // statSync doesn't test effective read access
        accessSync(resolved, constants.R_OK);
        return false;
    } catch {
        return true;
    }
}

/**
 * Throws a resolution-style error if the account's SA key file is gone,
 * so callers get actionable guidance instead of a raw ENOENT from deep
 * inside google-auth-library.
 */
export function assertServiceAccountKeyReadable(account: AccountConfig): void {
    if (!isServiceAccountKeyMissing(account)) return;
    const resolved = resolve(String(account.serviceAccountPath).replace('~', homedir()));
    const err: any = new Error(
        `Service account key file no longer exists at "${resolved}". Re-run setup to provide a new key.`
    );
    err.code = 'KEY_FILE_MISSING';
    err.resolution = { command: `search-console-mcp setup --engine=${account.engine}` };
    throw err;
}

export async function removeAccount(accountId: string) {
    const config = await loadConfig();
    delete config.accounts[accountId];
    await saveConfig(config);
}

/**
 * Resolve an account by exact ID first, then by case-insensitive alias.
 * Shared by the accounts CLI and logout so identifier semantics are
 * consistent across commands.
 */
export function findAccountByAliasOrId(accounts: Record<string, AccountConfig>, identifier: string): AccountConfig | undefined {
    if (accounts[identifier]) return accounts[identifier];
    return Object.values(accounts).find(
        a => a.alias?.toLowerCase() === identifier.toLowerCase() || a.id === identifier
    );
}
