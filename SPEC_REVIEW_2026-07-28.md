# MCP `2026-07-28` alignment plan

What changes this project needs for the [2026-07-28 spec](https://modelcontextprotocol.io/specification/2026-07-28/changelog). Reviewed against `@modelcontextprotocol/sdk` 1.29.0.

Context that drives every decision below:

- **Local-only, stdio-first.** No remote deployment planned. Spec best practice for local servers: use stdio so only the MCP client can reach them.
- **One tool registry, two surfaces.** MCP (stdio) and CLI share handlers via `createToolRegistrar` (`src/utils/cli.ts`). Protocol envelopes are an MCP concern; the CLI unwraps and renders (`unwrapMcpResult`, `printFormatted`).
- Doc comments currently claim 2026-07-28 compliance; the code predates it.

## Changes

### 1. Remove the HTTP/SSE mode

> **Status update (2026-10):** Issue #114 reported the mode live and exposed (all-interfaces bind, CORS `*`, no auth). Decision made: ship an interim **security hardening only** (loopback bind by default, bearer token via `--token=` / `MCP_HTTP_TOKEN`, no wildcard CORS, Host-header guard) and keep the mode through the current release. **Deprecate and remove the whole mode in the next release** per the original plan below. A deprecation warning goes into the banner at removal time; removal note in release notes.

`src/transport/http.ts` implements the deprecated HTTP+SSE transport: `SSEServerTransport`, `/sse` + `/messages`, a session map, bound to `0.0.0.0` (no host argument), CORS `*`, no Origin check. The feature is undocumented, has no bundled client, and contradicts the local-only model. Delete it rather than migrate it.

Checklist:

- [ ] Delete `src/transport/http.ts`; remove import plus `isSseMode` / `serve` / `--transport=sse` handling from `main()` in `src/index.ts`
- [ ] Delete `tests/e2e/sse.e2e.test.ts` (keep stdio e2e); update `docs/contributing/testing.md`
- [ ] Grep for leftovers before deleting: `startSseServer`, `/health`, `activeTransports`
- [ ] Check GitHub issues for unknown `serve` users; note removal in release notes
- [ ] `server.json` / `manifest.json`: already stdio-only, unchanged

If HTTP support is ever requested later, implement Streamable HTTP against the current SDK — not this code.

### 2. Replace the custom elicitation payload with MRTR

`src/common/elicitation.ts` returns an ad-hoc JSON blob (`{ isError, inputRequired, parameter, options }`) inside text content. Under 2026-07-28, server-needs-input is a Multi Round-Trip Request: return `resultType: "input_required"` with `inputRequests`; the client retries the original call with `inputResponses`. Correlate retries via `requestState`.

Apply to all callers of `ensureSiteUrlOrElicit`. Keep a human-readable line in text content as fallback. In `runCli()`, detect `input_required` and resolve interactively with `@clack/prompts` instead of printing the envelope.

### 3. Stop bypassing SDK dispatch; let the SDK emit `resultType`

`src/index.ts:415-431` replaces `tools/call` by reading `(server.server)._requestHandlers.get('tools/call')` and `(server as any)._registeredTools` to route legacy tool names. This will not survive the SDK upgrade and can drop envelope fields like the now-required `resultType`.

Implement legacy aliases at registration time instead. After the upgrade (#4), verify results carry `resultType: "complete"`.

### 4. Upgrade the SDK when it ships 2026-07-28 support

SDK `^1.29.0` predates the revision. After bumping, verify `server/discover`, `_meta` protocol-version handling, and run `pnpm test:e2e`. Do #3 first.

### 5. Add `outputSchema` / `structuredContent` to high-value tools

All tools return JSON strings embedded in text content. Declare output schemas and return `structuredContent` for `analytics_query`, `inspection_inspect`, `pagespeed_analyze`, `site_health_check`, `compare_engines`. Tighten `filters: z.array(z.any())` (`analytics_query`) into typed objects.

Caveat: strict clients validate `structuredContent` against `outputSchema` — ship both together and test.

CLI caveat: freeze the `--format json` output shape while reworking `printFormatted()`; scripts pipe it.

### 6. Lock deterministic tool ordering

Registration in `src/index.ts` is sequential today but nothing enforces it. Add a test asserting sorted order — protects LLM prompt caching and keeps CLI help stable.

### 7. Redesign CLI rendering on @clack/prompts

Depends on #2 (interactivity) and #5 (typed rows) — do not start before both land.

Decisions made:

- **Auto format:** TTY → table/human view; piped/non-TTY → JSON. Backward compatible: every existing script pipes, therefore gets JSON exactly as today.
- **Full clack UX layer, zero new dependencies.** No ink/blessed/theme system; generic renderers only.

Output contract:

| Mode | stdout | stderr |
|---|---|---|
| Machine (`--format json\|csv`) | Data only — no colors, spinners, decoration | Errors |
| Human (TTY default) | Tables / key-value views | Clack intro/outro, spinner, log lines |

Build items:

- Replace `ui.ts` hand-rolled ANSI with a small helper that respects `NO_COLOR` and `!isTTY`; use clack's `intro()`/`outro()` in place of `printBoxHeader`
- `spinner()` for long calls (`site_health_check`, batch `inspection_inspect`) with live counts ("43/120 URLs")
- One generic renderer keyed on shape: array of objects → table, object → key-value list, string → text. Prefer `structuredContent` when present (#5), fall back to `unwrapMcpResult`
- Harden `printTable` in place: truncate cells, cap width to `process.stdout.columns`
- Interactive resolution of `input_required` results (#2): `select()` when `options` exist, otherwise `text()`; in non-TTY, print the missing parameter and suggested flag to stderr, exit 1
- Group tools by domain prefix in `run --help` (~25 flat entries today)

## Small cleanups

- Use `-32602` for resource-not-found going forward (was `-32002`); audit `formatError`. Server emits none of the renamed codes today.
- Bump `server.json` `$schema` when the registry publishes a 2026-07-28-aligned version.
- Remove premature "implements 2026-07-28" wording from docs until #1–#4 land.

## Not doing

| Item | Reason |
|---|---|
| Streamable HTTP migration | Mode removed (#1); stdio covers local use |
| Origin validation / localhost binding | Moot without the HTTP endpoint |
| Tasks extension | Solves HTTP timeouts and multi-tenancy; stdio has neither |
| `subscriptions/listen` | A single local user re-reads resources |
| `ttlMs` / `cacheScope` cache hints | Local clients fetch lists once per session |
| Token store issuer keying | One hardcoded Google issuer, Bing is API-key only — requirement met by design, storage format stays as-is |
| OpenTelemetry | Nothing remote to trace across |
| DCR / Client ID Metadata Documents | OAuth client of Google only |

## Breaking changes

| Change | Impact | Mitigation |
|---|---|---|
| #1 removes `serve --transport=sse` | Undocumented feature lost | Check issues first; release note |
| #5 may tempt changing CLI `--format json` shape | Breaks piped scripts | Freeze the shape |
| #3 dispatch rewrite | Legacy tool-name aliases could regress | Covered by existing fallback tests |
| #7 default format becomes table on TTY | None — piped runs still get JSON | Auto-detection is TTY-gated |

Everything else is additive or internal.

## Order

1. Remove HTTP/SSE mode (#1)
2. Dispatch cleanup (#3), then SDK upgrade (#4)
3. MRTR elicitation (#2) — include `runCli` tests against `input_required`
4. Structured content (#5), ordering test (#6)
5. CLI redesign (#7)
6. Cleanups
