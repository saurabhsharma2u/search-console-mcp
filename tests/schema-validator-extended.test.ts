import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateSchema } from '../src/common/tools/schema-validator.js';

// Mock Validator - matches the WAE-style wrapper format: { jsonld: { [Type]: [schemas] } }
vi.mock('@adobe/structured-data-validator', () => {
    return {
        default: class Validator {
            async validate(input: any) {
                let schemas: any[] = [];
                if (input.jsonld) {
                    for (const key of Object.keys(input.jsonld)) {
                        schemas.push(...input.jsonld[key]);
                    }
                } else {
                    schemas = [input];
                }

                for (const schema of schemas) {
                    if (schema['@type'] === 'InvalidPerson') {
                        return [{ message: 'Validation failed', type: 'error' }];
                    }
                    if (schema['@type'] === 'ThrowingPerson') {
                        throw new Error('Validation internal error');
                    }
                }
                return [];
            }
        }
    };
});

const mockFetch = vi.fn();
global.fetch = mockFetch as any;

describe('Schema Validator Extended', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should validate JSON string (valid)', async () => {
        const input = JSON.stringify({ "@type": "Person", "name": "John" });
        const result = await validateSchema(input, 'json');
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
        expect(result.schemas).toHaveLength(1);
    });

    it('should validate JSON string (invalid)', async () => {
        const input = JSON.stringify({ "@type": "InvalidPerson", "name": "John" });
        const result = await validateSchema(input, 'json');
        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(1);
    });

    it('should handle JSON parse error', async () => {
        const result = await validateSchema('invalid-json', 'json');
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('JSON Parse error');
    });

    it('should validate HTML input (extract schemas)', async () => {
        const html = `
            <html>
                <body>
                    <script type="application/ld+json">
                        { "@type": "Person", "name": "John" }
                    </script>
                    <script type="application/ld+json">
                        { "@type": "Organization", "name": "Corp" }
                    </script>
                </body>
            </html>
        `;
        const result = await validateSchema(html, 'html');
        expect(result.valid).toBe(true);
        expect(result.schemas).toHaveLength(2);
    });

    it('should handle HTML with no schemas', async () => {
        const html = '<html><body></body></html>';
        const result = await validateSchema(html, 'html');
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('No structured data (JSON-LD) found');
    });

    it('should handle HTML with invalid JSON block', async () => {
        const html = `
            <html>
                <body>
                    <script type="application/ld+json">
                        invalid-json
                    </script>
                </body>
            </html>
        `;
        const result = await validateSchema(html, 'html');
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('No structured data');
    });

    it('should validate URL input', async () => {
        const html = `
            <html>
                <body>
                    <script type="application/ld+json">
                        { "@type": "Person", "name": "John" }
                    </script>
                </body>
            </html>
        `;
        mockFetch.mockResolvedValue({
            ok: true,
            text: async () => html
        });

        const result = await validateSchema('https://example.com', 'url');
        expect(result.valid).toBe(true);
        expect(result.schemas).toHaveLength(1);
        expect(mockFetch).toHaveBeenCalledWith('https://example.com/', expect.objectContaining({
            redirect: 'follow'
        }));
    });

    it('should handle URL fetch error', async () => {
        mockFetch.mockResolvedValue({
            ok: false,
            status: 404,
            statusText: 'Not Found'
        });

        const result = await validateSchema('https://example.com', 'url');
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('Fetch error');
    });

    it('should handle URL fetch exception', async () => {
        mockFetch.mockRejectedValue(new Error('Network Error'));

        const result = await validateSchema('https://example.com', 'url');
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('Fetch error: Network Error');
    });

    it('should handle validator exception', async () => {
        const input = JSON.stringify({ "@type": "ThrowingPerson" });
        const result = await validateSchema(input, 'json');
        expect(result.valid).toBe(false);
        expect(result.errors[0].message).toContain('Validation exception');
    });
});
