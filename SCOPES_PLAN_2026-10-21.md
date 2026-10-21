# Write-scope plan: GSC sitemaps / sites / Indexing (issue #113)

Date: 2026-10-21. Context: issue #113 reported that `sitemaps_submit`/
`sitemaps_delete` fail with *"Request had insufficient authentication scopes"*
because every Google Search Console auth path requests only
`webmasters.readonly`. The same defect affects `sites_manage`
(`sites.add` / `sites.delete`). Confirmed against `src/google/client.ts:9-12`
(`SCOPES`), `src/google/tools/sitemaps.ts`, and `src/google/tools/sites.ts`.

## Decisions made

1. **Capability multiselect at setup** (replaces the single indexing confirm
   prompt). Two checkboxes, three advertised capabilities — because Google
   only has two scopes:

   ```
   ◆ Write capabilities (optional — server stays read-only by default)
   │  ◻ Sitemap & site management (submit/delete sitemaps, add/remove     [webmasters]
   │    properties) — one Google scope covers both
   │  ◻ URL indexing — JobPosting/BroadcastEvent pages only              [indexing]
   ```

   The UI keeps the JobPosting/BroadcastEvent caveat copied from the current
   `src/setup/flows/google.ts:48-51` prompt.
2. **Read-only remains the default grant.** No read path changes. The
   permissions table in `docs/getting-started/overview.md` updates to
   "read-only unless you opt in at setup" instead of hard-readonly.
3. **Tiered runtime handling when a mutation hits a missing scope:**

   | Surface | Behavior on insufficient-scope error |
   |---|---|
   | CLI (TTY) | Inline offer: "Authorize now? [Y/n]" → `startLocalFlow` with the requested scope added → save tokens → retry the original call automatically |
   | CLI (headless `NO_BROWSER=1`/CI/SSH) | Print the consent URL + `ssh -L 3000:localhost:3000` forwarding instructions, exit 1. No browser spawn (`canOpenBrowser` governs) |
   | stdio MCP | Structured actionable error naming the missing scope and the exact remediation command. **Never spawn a browser from a tool call** — timeouts, protocol pipe hygiene, phishy UX. Rework of this path onto MRTR (`input_required`) is future work under SPEC_REVIEW items #2/#4 — out of scope here. |
   | SSE/serve | Same as stdio; headless-server surfaces never launch OAuth flows |

   `webmasters` is a superset of `webmasters.readonly`, so re-consent
   preserves existing read capability. `startLocalFlow` already sends
   `prompt: 'consent'`, which is what makes a scope upgrade on re-run work.
4. **Write client is scope-declared, capability-gated, never silent.**
   New scoped client for `webmasters` mutations (mirrors the existing
   `getIndexingClient` / `INDEXING_SCOPES` pattern). Service accounts work
   immediately (scopes are self-declared per request — this is what fixes
   the #113 reporter). OAuth users get the runtime error/offer above.
   Mutation tools stay registered regardless of grant (MCP tool lists are
   static); friendly errors are therefore mandatory, not optional.

## Changes

### 1. Scoped write client (`src/google/client.ts`)

- Add `WRITE_SCOPES = ['https://www.googleapis.com/auth/webmasters', 'userinfo.email']`
  (equivalent of the existing `INDEXING_SCOPES`, line 110).
- Add a `getWriteClient(siteUrl?, accountId?)` (or a `{ write: true }` variant
  of `getSearchConsoleClient`) that runs the identical four auth paths with
  `WRITE_SCOPES`; own cache map like `cachedIndexingClientMap`.
- Mutation callers only: `src/google/tools/sitemaps.ts`
  (`submitSitemap` line 27, `deleteSitemap` line 41) and `src/google/tools/sites.ts`
  (`addSite` line 23, `deleteSite` line 35). Read tools, `inspection.ts`,
  `analytics.ts`, and `diagnostics.ts` stay on the readonly client.
- Leave `getIndexingClient` as-is except for the shared error helper (below).

### 2. Capability awareness (derived from the granted scope — no new config field)

> **Refinement (2026-10-21):** the original draft proposed persisting chosen
> capabilities on `AccountConfig`. Dropped: the granted OAuth `scope` string
> already carries that information — persist it on the stored tokens instead
> (additive field in `saveTokensForAccount`) and `hasCapability(account, cap)`
> in `src/common/auth/scope-error.ts` derives everything from it. One source
> of truth, no drift between bookkeeping and the real grant. Service accounts
> are write-capable by construction (scopes self-declared per request), so
> the SA setup branch needs no record at all.

- `src/common/auth/config.ts`: `tokens.scope` added (additive blob field).
- `src/setup/flows/google.ts`: replace the `useIndexing` confirm (line 48)
  with `prompts.multiselect` (helper already exists in `src/utils/prompts.ts`
  and is used at line 128; driver gained an `initialValues` pre-select
  argument). Scope list sent to `startLocalFlow` = readonly base + one scope
  per selected capability. Nothing capability-specific is persisted — the
  consent response's `scope` string is the record.
- On re-setup, pre-select by diffing each existing Google account's
  `tokens.scope` (legacy accounts pre-select nothing — correct, they hold
  only readonly).

### 3. Shared insufficient-scope handling (`src/common/auth/scope-error.ts` — new)

- `getMissingScope(err)` / `getMissingCapability(account, capability)`.
- Wraps mutation handlers (sitemaps, sites) and the indexing tool
  (`src/google/tools/indexing.ts`) so a Google 403/401 *"insufficient
  authentication scopes"* becomes a typed, actionable result naming the
  capability and remediation.
- Also fixes the pre-existing defect surfaced during review: an OAuth user
  who declined the old indexing prompt gets the same silent failure from
  `getIndexingClient` (client.ts:154-171 reuses readonly tokens) — same
  mechanism now catches it.

### 4. CLI runtime re-auth offer (`src/utils/cli.ts` run path)

- On insufficient-scope interception, if TTY: offer inline re-consent →
  `startLocalFlow` with the requested scope → `saveTokensForAccount`
  (persists the new `scope` grant) → invalidate scoped client caches →
  retry the tool call once. Honor `canOpenBrowser` for headless variants.
- Non-TTY runs never auto-consent — remediation is printed and the run
  exits 1.
- Attempt-limited (single retry) to avoid loops on users without property
  access (that failure shape is different: keep Google's wording for it).

### 5. Docs + release

- `docs/getting-started/overview.md`: permissions table (lines 19-21) →
  "read-only by default; optional write scopes shown once at setup".
- Update the current permissions-we-request copy on the docs site.
- Release note: behavior change for `sitemaps_submit`/`sitemaps_delete`/
  `sites_manage` — existing read-only accounts get an optical error and a
  one-step remediation (re-run setup, tick the box). Minor version bump.

## Order

1. #1 write client + caller swaps (fixes every SA user immediately)
2. #3 shared scope-error helper (wire actionable errors everywhere)
3. #2 capabilities + setup multiselect
4. #4 CLI re-auth offer
5. #5 docs + note

(#1+#3 are independently shippable and fix issue #113's reported repro;
#2/#4 are the UX layer.)

## Tests

- Scope constants: `WRITE_SCOPES` / `INDEXING_SCOPES` contain the right URLs;
  read client keeps requesting readonly only.
- Mutation tool handlers resolve through the write client (handler-level).
- `translateScopeError` / capability gate: map Google's exact error text to the
  typed error for the three mutation surfaces + indexing.
- Capability derivation: `getGrantedScopes` / `hasCapability` from token
  `scope` strings; SA accounts derive both capabilities; legacy accounts
  (no scope) derive read-only.
- Setup: multiselect selection → scope list sent to `startLocalFlow`
  (mock); pre-selection derived from the granted scopes.
- CLI re-auth offer: TTY path retries once after mocked consensus; headless
  path prints URL and exits 1; no browser spawn when `canOpenBrowser` is false.

## Breaking changes

| Change | Impact | Mitigation |
|---|---|---|
| Mutation calls on read-only OAuth accounts | Previously failed with Google's raw error | Now typed error + optional inline re-auth; behavior (failing) unchanged |
| Docs promise "only read-only scope" | Consent screen may now show write scopes if opted in | Docs updated in the same release; defaults unchanged |
| None for service accounts | They gain working mutations with no re-auth | Release note headline |
