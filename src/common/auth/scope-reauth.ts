/**
 * Runtime scope remediation for the CLI (issue #113).
 *
 * When a mutation tool fails with an insufficient-scope error and the CLI
 * has an interactive terminal, offer inline re-authorization: open the
 * Google consent flow with the requested scope added, persist the new
 * tokens to the account, record the capability, and let the caller retry
 * the tool call once.
 *
 * Non-interactive and stdio/SSE surfaces never get here: consent must be
 * user-initiated, and servers must not spawn OAuth flows from tool calls.
 */

import { CAPABILITY_LABEL, CAPABILITY_SCOPE, MissingScopeError, WriteCapability } from './scope-error.js';
import { startLocalFlow, saveTokensForAccount, invalidateScopedClients, SCOPES, DEFAULT_CLIENT_ID, DEFAULT_CLIENT_SECRET } from '../../google/client.js';
import { AccountConfig, loadConfig } from './config.js';
import { prompts, CancelledError } from '../../utils/prompts.js';

export async function offerScopeReauth(error: MissingScopeError): Promise<boolean> {
  const { capability, accountId } = error;

  // Non-interactive runs never auto-consent: print the remediation and fail
  // (the CLI then exits 1). Matches the setup flows' TTY/non-TTY split.
  if (!process.stdout.isTTY) {
    console.error(error.resolution);
    return false;
  }

  if (!accountId) {
    // Env-based service accounts (GOOGLE_APPLICATION_CREDENTIALS / env JWT)
    // self-declare scopes per request, so this error means a real Google-side
    // permission problem, not a stored-grant gap.
    console.error(error.resolution);
    return false;
  }

  let proceed = false;
  try {
    proceed = await prompts.confirm(
      `Authorize ${CAPABILITY_LABEL[capability]} now? (opens Google consent in your browser)`,
      true
    );
  } catch (e) {
    if (e instanceof CancelledError) throw e;
    proceed = false;
  }
  if (!proceed) return false;

  await upgradeAccountScopes(accountId, capability);
  return true;
}

/**
 * Run the consent flow with the extra scope, persist tokens + capability
 * for the account, and invalidate any cached clients implicitly (new
 * process-local caches read the fresh grant).
 */
export async function upgradeAccountScopes(accountId: string, capability: WriteCapability): Promise<void> {
  let account: AccountConfig;
  const config = await loadConfig();
  const found = config.accounts[accountId];
  if (!found) {
    throw new Error(`Account ${accountId} not found; run \`search-console-mcp setup --engine=google\`.`);
  }
  account = found;

  console.log(`\nAuthorizing ${CAPABILITY_LABEL[capability]}...`);
  const tokens = await startLocalFlow(
    DEFAULT_CLIENT_ID,
    DEFAULT_CLIENT_SECRET,
    [...new Set([...SCOPES, CAPABILITY_SCOPE[capability]])]
  );

  // saveTokensForAccount persists the new grant (including its `scope`
  // string — the authoritative capability record) and the account record.
  await saveTokensForAccount(account, tokens);
  invalidateScopedClients(accountId);
}
