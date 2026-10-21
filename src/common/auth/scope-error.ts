/**
 * Shared handling for Google "insufficient authentication scopes" failures
 * on mutation calls (issue #113).
 *
 * The server requests read-only scopes by default; write capabilities
 * (sitemaps submit/delete, sites add/remove, URL indexing) are granted
 * separately at setup. This module turns Google's raw 403 into an
 * actionable `MissingScopeError` that:
 *  - names the missing capability and scope,
 *  - carries the account id so the CLI can offer an inline re-auth,
 *  - exposes a `resolution` field that `formatError` forwards to MCP
 *    clients for agents to relay to users.
 */

export type WriteCapability = 'gsc_write' | 'indexing';

/** The concrete Google OAuth scope each capability requires. */
export const CAPABILITY_SCOPE: Record<WriteCapability, string> = {
  gsc_write: 'https://www.googleapis.com/auth/webmasters',
  indexing: 'https://www.googleapis.com/auth/indexing',
};

export const CAPABILITY_LABEL: Record<WriteCapability, string> = {
  gsc_write: 'Search Console write access (sitemaps submit/delete, sites add/remove)',
  indexing: 'Google Indexing API (URL indexing — JobPosting/BroadcastEvent pages only)',
};

/**
 * Thrown when a mutation call fails because the account's grant lacks the
 * write scope. The message is user-facing; `resolution` is the exact
 * remediation for CLI output and MCP error envelopes.
 */
export class MissingScopeError extends Error {
  readonly capability: WriteCapability;
  readonly accountId?: string;
  readonly resolution: string;

  constructor(capability: WriteCapability, accountId?: string) {
    const scope = CAPABILITY_SCOPE[capability];
    super(`${CAPABILITY_LABEL[capability]} requires additional authorization (Google scope: ${scope}).`);
    this.name = 'MissingScopeError';
    this.capability = capability;
    this.accountId = accountId;
    this.resolution =
      'Run `search-console-mcp setup --engine=google` and select the write capability ' +
      '(CLI runs of this command also offer to authorize inline when the error appears).';
  }
}

/**
 * True when the error is Google's 403 insufficient-scopes failure. The
 * message text varies slightly between direct googleapis calls and the
 * Indexing API's raw fetch responses, where the JSON body (containing the
 * message) is embedded in the error text.
 */
export function isInsufficientScopeError(error: unknown): boolean {
  const anyError = error as any;
  const message = String(anyError?.message ?? '');
  return /insufficient authentication scopes|insufficientPermissions/i.test(message);
}

/**
 * Converts an insufficient-scope failure into a typed `MissingScopeError`;
 * passes any other error through untouched for normal handling upstream.
 */
export function translateScopeError(
  error: unknown,
  capability: WriteCapability,
  accountId?: string,
): unknown {
  if (isInsufficientScopeError(error)) {
    return new MissingScopeError(capability, accountId);
  }
  return error;
}

/**
 * Returns the set of Google scopes the account's grant covers.
 *
 * - OAuth accounts: parsed from the persisted token `scope` string (the
 *   authoritative record of what Google granted at consent/refresh time).
 * - Service accounts: scopes are self-declared per request by the auth
 *   client, so everything we request is granted by construction.
 *
 * Single source of truth for capability checks (issue #113) — no parallel
 * bookkeeping is kept in config.
 */
export function getGrantedScopes(
  account: { serviceAccountPath?: string; tokens?: { scope?: string | null } } | undefined,
): Set<string> {
  if (!account) return new Set();
  if (account.serviceAccountPath) {
    return new Set([
      CAPABILITY_SCOPE.gsc_write,
      CAPABILITY_SCOPE.indexing,
      'https://www.googleapis.com/auth/webmasters.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
    ]);
  }
  return new Set(String(account.tokens?.scope ?? '').split(/[\s]+/).filter(Boolean));
}

/**
 * Derived capability check: granted scopes ⊇ the scope the capability
 * requires. Legacy accounts (no persisted `scope`) read as read-only,
 * which is what they are.
 */
export function hasCapability(
  account:
    | { serviceAccountPath?: string; tokens?: { scope?: string | null } }
    | undefined,
  capability: WriteCapability,
): boolean {
  return getGrantedScopes(account).has(CAPABILITY_SCOPE[capability]);
}
