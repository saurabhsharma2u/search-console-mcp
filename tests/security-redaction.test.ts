import { describe, expect, it } from 'vitest';
import { formatError } from '../src/common/errors.js';
import { sanitizeForLog } from '../src/utils/redaction.js';

describe('Secret redaction', () => {
    it('redacts bearer tokens, API keys, hashes, and private keys', () => {
        const raw = [
            'Authorization: Bearer scmcp_super_secret',
            'https://example.com/path?apikey=bing-secret&x=1',
            'token: "plain-token"',
            'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----'
        ].join(' ');

        const sanitized = sanitizeForLog(raw);

        expect(sanitized).not.toContain('scmcp_super_secret');
        expect(sanitized).not.toContain('bing-secret');
        expect(sanitized).not.toContain('plain-token');
        expect(sanitized).not.toContain('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
        expect(sanitized).not.toContain('abc');
        expect(sanitized).toContain('[REDACTED]');
    });

    it('formats MCP errors without leaking raw secret material', () => {
        const response = formatError(new Error('Fetch failed: apikey=abc123 Authorization: Bearer secret-token'));

        expect(response.isError).toBe(true);
        expect(response.content[0].text).not.toContain('abc123');
        expect(response.content[0].text).not.toContain('secret-token');
    });
});
