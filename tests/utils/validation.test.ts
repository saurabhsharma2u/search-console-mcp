import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
    validateAlias, validateEmail, validateKeyFilePath,
    parseServiceAccountKey, parseServiceAccountJson,
} from '../../src/utils/validation.js';

const tmpDir = mkdtempSync(join(tmpdir(), 'validation-test-'));

describe('validation helpers', () => {
    afterAll(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    describe('validateAlias', () => {
        it('accepts normal aliases', () => {
            expect(validateAlias('my-site')).toBeUndefined();
            expect(validateAlias('Example Site 123')).toBeUndefined();
        });

        it('rejects empty and whitespace-only', () => {
            expect(validateAlias('')).toBeDefined();
            expect(validateAlias('   ')).toBeDefined();
        });

        it('rejects overly long aliases and line breaks', () => {
            expect(validateAlias('x'.repeat(101))).toBeDefined();
            expect(validateAlias('bad\nalias')).toBeDefined();
        });
    });

    describe('validateEmail', () => {
        it('accepts valid emails', () => {
            expect(validateEmail('user@example.com')).toBeUndefined();
        });

        it('rejects malformed emails', () => {
            expect(validateEmail('nope')).toBeDefined();
            expect(validateEmail('a@b')).toBeDefined();
            expect(validateEmail('')).toBeDefined();
        });
    });

    describe('validateKeyFilePath + parseServiceAccountKey', () => {
        const validKey = {
            type: 'service_account',
            project_id: 'p',
            private_key_id: 'pkid',
            private_key: 'pk',
            client_email: 'sa@test.com',
            client_id: 'cid',
            auth_uri: 'https://auth',
            token_uri: 'https://token'
        };

        it('rejects missing files', () => {
            expect(validateKeyFilePath(join(tmpDir, 'missing.json'))).toMatch(/File not found/);
        });

        it('rejects non-JSON extensions', () => {
            const p = join(tmpDir, 'key.txt');
            writeFileSync(p, '{}');
            expect(validateKeyFilePath(p)).toMatch(/Invalid file type/);
        });

        it('rejects invalid JSON content', () => {
            const p = join(tmpDir, 'bad.json');
            writeFileSync(p, 'not json');
            expect(parseServiceAccountKey(p).error).toMatch(/valid JSON/);
        });

        it('rejects keys missing required fields or wrong type', () => {
            const p1 = join(tmpDir, 'partial.json');
            writeFileSync(p1, JSON.stringify({ type: 'service_account' }));
            expect(parseServiceAccountKey(p1).error).toMatch(/Missing required field/);

            const p2 = join(tmpDir, 'wrongtype.json');
            writeFileSync(p2, JSON.stringify({ ...validKey, type: 'authorized_user' }));
            expect(parseServiceAccountKey(p2).error).toMatch(/Expected type 'service_account'/);
        });

        it('parses a valid key', () => {
            const p = join(tmpDir, 'good.json');
            writeFileSync(p, JSON.stringify(validKey));
            const { key, error } = parseServiceAccountKey(p);
            expect(error).toBeUndefined();
            expect(key?.client_email).toBe('sa@test.com');
        });
    });
});

describe('parseServiceAccountJson (pasted content)', () => {
    const fullKey = {
        type: 'service_account',
        project_id: 'p',
        private_key_id: 'pkid',
        private_key: 'pk',
        client_email: 'sa@test.com',
        client_id: 'cid',
        auth_uri: 'https://auth',
        token_uri: 'https://token'
    };

    it('parses compact pasted JSON', () => {
        const { key, error } = parseServiceAccountJson(JSON.stringify(fullKey));
        expect(error).toBeUndefined();
        expect(key?.client_email).toBe('sa@test.com');
    });

    it('tolerates surrounding whitespace/newlines from terminal paste', () => {
        const { key, error } = parseServiceAccountJson('\n  ' + JSON.stringify(fullKey) + '\n');
        expect(error).toBeUndefined();
        expect(key?.type).toBe('service_account');
    });

    it('rejects non-JSON paste', () => {
        expect(parseServiceAccountJson('oops').error).toMatch(/not valid JSON/);
    });
});
