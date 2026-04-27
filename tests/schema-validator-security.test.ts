import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateSchema } from '../src/common/tools/schema-validator.js';

describe('Schema validator URL safety', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('blocks localhost and private network URL fetches', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');

        const localhost = await validateSchema('http://127.0.0.1:8080/schema', 'url');
        const metadata = await validateSchema('http://169.254.169.254/latest/meta-data', 'url');

        expect(localhost.valid).toBe(false);
        expect(localhost.errors[0]).toContain('URL host is not allowed');
        expect(metadata.valid).toBe(false);
        expect(metadata.errors[0]).toContain('URL host is not allowed');
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('rejects non-http schemes before fetching', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');

        const result = await validateSchema('file:///etc/passwd', 'url');

        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('Only http and https URLs are allowed');
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('rejects oversized responses', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('too large', {
            status: 200,
            headers: {
                'content-length': '1000001'
            }
        }));

        const result = await validateSchema('https://example.com/schema', 'url');

        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('Response is too large');
    });
});
