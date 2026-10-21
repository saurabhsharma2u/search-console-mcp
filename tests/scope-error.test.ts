import { describe, it, expect } from 'vitest';
import {
    MissingScopeError,
    isInsufficientScopeError,
    translateScopeError,
    hasCapability,
    getGrantedScopes,
    CAPABILITY_SCOPE,
} from '../src/common/auth/scope-error.js';
import { SCOPES, WRITE_SCOPES, INDEXING_SCOPES } from '../src/google/client.js';

describe('Google scope constants (issue #113)', () => {
    it('read client keeps requesting webmasters.readonly only', () => {
        expect(SCOPES).toContain('https://www.googleapis.com/auth/webmasters.readonly');
        expect(SCOPES).not.toContain('https://www.googleapis.com/auth/webmasters');
        expect(SCOPES).toContain('https://www.googleapis.com/auth/userinfo.email');
    });

    it('write client requests the full webmasters scope', () => {
        expect(WRITE_SCOPES).toContain('https://www.googleapis.com/auth/webmasters');
        expect(WRITE_SCOPES).not.toContain('https://www.googleapis.com/auth/webmasters.readonly');
        expect(WRITE_SCOPES).toContain('https://www.googleapis.com/auth/userinfo.email');
    });

    it('capability → scope mapping matches what each API requires', () => {
        expect(CAPABILITY_SCOPE.gsc_write).toBe('https://www.googleapis.com/auth/webmasters');
        expect(CAPABILITY_SCOPE.indexing).toBe('https://www.googleapis.com/auth/indexing');
        expect(INDEXING_SCOPES).toContain(CAPABILITY_SCOPE.indexing);
    });
});

describe('isInsufficientScopeError', () => {
    it('matches Google direct-API insufficient-scopes errors', () => {
        expect(isInsufficientScopeError(new Error('Request had insufficient authentication scopes.'))).toBe(true);
    });

    it('matches Indexing API fetch errors with the JSON body embedded', () => {
        const body = JSON.stringify({
            error: { code: 403, message: 'Request had insufficient authentication scopes.', status: 'PERMISSION_DENIED' }
        });
        expect(isInsufficientScopeError(new Error(`Google Indexing API error: 403 ${body}`))).toBe(true);
    });

    it('does not claim unrelated 403 permission errors are scope gaps', () => {
        expect(isInsufficientScopeError(new Error('Permission denied for property sc-domain:example.com'))).toBe(false);
        expect(isInsufficientScopeError(new Error('Random failure'))).toBe(false);
    });
});

describe('translateScopeError', () => {
    it('converts insufficient-scope failures into a typed error with the account id', () => {
        const original = new Error('Request had insufficient authentication scopes.');
        const translated = translateScopeError(original, 'gsc_write', 'google_123') as MissingScopeError;

        expect(translated).toBeInstanceOf(MissingScopeError);
        expect(translated.capability).toBe('gsc_write');
        expect(translated.accountId).toBe('google_123');
        expect(translated.message).toContain('webmasters');
        expect(translated.resolution).toContain('setup --engine=google');
    });

    it('passes non-scope errors through untouched for normal handling', () => {
        const original = new Error('Property not found');
        expect(translateScopeError(original, 'gsc_write')).toBe(original);
    });

    it('MissingScopeError covers indexing with its own scope label', () => {
        const err = new MissingScopeError('indexing');
        expect(err.message).toContain('https://www.googleapis.com/auth/indexing');
    });
});

describe('capability derivation from the granted scope (issue #113)', () => {
    it('derives capabilities from the persisted token scope string', () => {
        const account = {
            tokens: { scope: 'https://www.googleapis.com/auth/webmasters https://www.googleapis.com/auth/userinfo.email' }
        };
        expect(hasCapability(account, 'gsc_write')).toBe(true);
        expect(hasCapability(account, 'indexing')).toBe(false);
    });

    it('treats legacy accounts (no persisted scope, no SA path) as read-only', () => {
        expect(hasCapability(undefined, 'gsc_write')).toBe(false);
        expect(hasCapability({}, 'gsc_write')).toBe(false);
        expect(hasCapability({ tokens: { scope: null } }, 'indexing')).toBe(false);
    });

    it('service accounts are write-capable by construction (scopes self-declared)', () => {
        const account = { serviceAccountPath: '/keys/sa.json' };
        expect(hasCapability(account, 'gsc_write')).toBe(true);
        expect(hasCapability(account, 'indexing')).toBe(true);
        expect(getGrantedScopes(account).has('https://www.googleapis.com/auth/webmasters.readonly')).toBe(true);
    });
});
