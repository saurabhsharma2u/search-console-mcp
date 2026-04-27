// @ts-ignore
import Validator from '@adobe/structured-data-validator';
import * as cheerio from 'cheerio';
import { sanitizeForLog } from '../../utils/redaction.js';

/**
 * Result of a structured data (schema) validation check.
 */
export interface ValidationResult {
    /** Whether all schemas were found and valid. */
    valid: boolean;
    /** A list of validation errors found across all detected schemas. */
    errors: any[];
    /** The original JSON-LD schemas extracted from the input. */
    schemas: any[];
}

/**
 * Validates structured data (JSON-LD) from a URL, raw HTML, or a JSON string.
 *
 * @param input - The source to validate (URL, HTML string, or JSON string).
 * @param type - The type of input being provided.
 * @returns A result object indicating validity and listing any errors found.
 */
export async function validateSchema(
    input: string,
    type: 'url' | 'html' | 'json'
): Promise<ValidationResult> {
    let schemas: any[] = [];
    const errors: any[] = [];

    try {
        if (type === 'url') {
            try {
                const response = await fetchSchemaUrl(input);
                if (!response.ok) {
                    throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
                }
                const html = await readLimitedText(response, 1_000_000);
                schemas = extractSchemas(html);
            } catch (e: any) {
                return { valid: false, errors: [`Fetch error: ${sanitizeForLog(e.message)}`], schemas: [] };
            }
        } else if (type === 'html') {
            schemas = extractSchemas(input);
        } else if (type === 'json') {
            try {
                const parsed = JSON.parse(input);
                schemas = Array.isArray(parsed) ? parsed : [parsed];
            } catch (e: any) {
                return { valid: false, errors: [`JSON Parse error: ${e.message}`], schemas: [] };
            }
        }

        if (schemas.length === 0) {
            return { valid: false, errors: ["No structured data (JSON-LD) found"], schemas: [] };
        }

        const validator = new Validator();
        const validationPromises = schemas.map(async (schema) => {
            try {
                let type = schema['@type'];
                if (Array.isArray(type)) {
                    type = type[0];
                }
                const wrapper = {
                    jsonld: {
                        [type || 'Thing']: [schema]
                    }
                };
                const result = await validator.validate(wrapper);

                if (result && Array.isArray(result) && result.length > 0) {
                    // result is array of errors
                    return result.map((err: any) => ({
                        ...err,
                        schemaType: schema['@type'] || 'Unknown'
                    }));
                }
                return [];
            } catch (e: any) {
                return [{ message: `Validation exception: ${e.message}`, schemaType: schema['@type'] || 'Unknown' }];
            }
        });

        const results = await Promise.all(validationPromises);
        errors.push(...results.flat());

        return {
            valid: errors.length === 0,
            errors,
            schemas
        };

    } catch (err: any) {
        return { valid: false, errors: [err.message], schemas: [] };
    }
}

async function fetchSchemaUrl(input: string): Promise<Response> {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('Only http and https URLs are allowed');
    }
    if (isBlockedHost(url.hostname)) {
        throw new Error('URL host is not allowed');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
        return await fetch(url.toString(), {
            redirect: 'follow',
            signal: controller.signal
        });
    } finally {
        clearTimeout(timeout);
    }
}

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
    const contentLength = response.headers?.get?.('content-length');
    if (contentLength && Number(contentLength) > maxBytes) {
        throw new Error('Response is too large');
    }

    const reader = response.body?.getReader();
    if (!reader) return response.text();

    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > maxBytes) {
            throw new Error('Response is too large');
        }
        chunks.push(value);
    }

    return new TextDecoder().decode(concatChunks(chunks, total));
}

function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return output;
}

function isBlockedHost(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.localhost')) return true;
    if (host === 'metadata.google.internal') return true;

    if (host.includes(':')) {
        if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true;
        return false;
    }

    const parts = host.split('.').map(part => Number(part));
    if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
        return false;
    }

    const [a, b] = parts;
    return (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168)
    );
}

function extractSchemas(html: string): any[] {
    const $ = cheerio.load(html);
    const schemas: any[] = [];
    $('script[type="application/ld+json"]').each((_, el) => {
        try {
            const content = $(el).html();
            if (content) {
                const parsed = JSON.parse(content);
                if (Array.isArray(parsed)) {
                    schemas.push(...parsed);
                } else {
                    schemas.push(parsed);
                }
            }
        } catch (e) {
            // ignore invalid json blocks
        }
    });
    return schemas;
}
