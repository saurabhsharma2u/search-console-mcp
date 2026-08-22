import { existsSync, statSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';

export interface ServiceAccountKey {
    type: string;
    project_id: string;
    private_key_id: string;
    private_key: string;
    client_email: string;
    client_id: string;
    auth_uri: string;
    token_uri: string;
}

const REQUIRED_KEY_FIELDS: (keyof ServiceAccountKey)[] = [
    'type', 'project_id', 'private_key_id', 'private_key',
    'client_email', 'client_id', 'auth_uri', 'token_uri'
];

/**
 * Pure validators: return an error message, or undefined when valid.
 * Shared by interactive prompt validation and non-interactive flag parsing.
 */
export function validateAlias(value: string): string | undefined {
    const v = value.trim();
    if (!v) return 'Alias cannot be empty.';
    if (v.length > 100) return 'Alias is too long (max 100 characters).';
    if (/[\n\r]/.test(v)) return 'Alias cannot contain line breaks.';
    return undefined;
}

export function validateEmail(value: string): string | undefined {
    const v = value.trim();
    if (!v) return 'Email cannot be empty.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'That does not look like a valid email address.';
    return undefined;
}

export function validateKeyFilePath(value: string): string | undefined {
    const sanitized = value.trim().replace(/\0/g, '');
    if (!sanitized) return 'Please provide a path to your JSON key file.';
    const expandedPath = sanitized.startsWith('~') ? sanitized.replace('~', homedir()) : sanitized;
    const fullPath = resolve(expandedPath);

    if (!existsSync(fullPath)) return `File not found: ${fullPath}`;

    const stats = statSync(fullPath);
    if (!stats.isFile()) return 'Not a regular file. Please provide the path to a JSON key file.';
    if (extname(fullPath).toLowerCase() !== '.json') return 'Invalid file type. Please provide a .json file.';
    return undefined;
}

export function parseServiceAccountKey(fullPath: string): { key?: ServiceAccountKey; error?: string } {
    try {
        const content = readFileSync(fullPath, 'utf8');
        return parseServiceAccountJson(content);
    } catch (e) {
        return { error: `Could not read file: ${(e as Error).message}` };
    }
}

/**
 * Parses pasted or file-loaded service account JSON content.
 * Tolerates surrounding whitespace/newlines from terminal paste.
 */
export function parseServiceAccountJson(content: string): { key?: ServiceAccountKey; error?: string } {
    let parsed: any;
    try {
        parsed = JSON.parse(content.trim());
    } catch {
        return { error: 'Content is not valid JSON. Paste the entire key file contents.' };
    }
    if (typeof parsed !== 'object' || parsed === null) {
        return { error: 'Content is not a JSON object.' };
    }
    for (const field of REQUIRED_KEY_FIELDS) {
        if (!(field in parsed)) return { error: `Missing required field '${field}' — is this a service account key?` };
    }
    if (parsed.type !== 'service_account') return { error: `Expected type 'service_account', got '${parsed.type}'.` };
    return { key: parsed as ServiceAccountKey };
}

function extname(p: string): string {
    const base = p.split('/').pop() || p;
    const idx = base.lastIndexOf('.');
    return idx === -1 ? '' : base.slice(idx);
}
