import { google } from 'googleapis';
import { AccountConfig, loadConfig, updateAccount } from '../common/auth/config.js';
import { getUserEmail, loadTokensForAccount, saveTokensForAccount, DEFAULT_CLIENT_ID, DEFAULT_CLIENT_SECRET } from '../google/client.js';
import { prompts, withSpinner } from '../utils/prompts.js';
import { colors, log, printBoxHeader, printError, printInfo, printSuccess } from '../utils/ui.js';

/**
 * Headless deployment helpers.
 *
 * AdSense cannot use service accounts (the API requires user-authorized
 * OAuth), and the local config file is encrypted with a per-machine key,
 * so credentials cannot simply be copied to a server. These commands move
 * an OAuth grant between machines:
 *
 *   laptop:  search-console-mcp adsense-export
 *   server:  search-console-mcp adsense-import --token=... [--publisher-id=...]
 */

function getFlag(args: string[], name: string): string | undefined {
  const arg = args.find(a => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!arg) return undefined;
  const eq = arg.indexOf('=');
  return eq >= 0 ? arg.slice(eq + 1) : '';
}

async function listPublisherAccounts(oauth2Client: any): Promise<import('googleapis').adsense_v2.Schema$Account[]> {
  const adsense = google.adsense({ version: 'v2', auth: oauth2Client });
  const accounts: import('googleapis').adsense_v2.Schema$Account[] = [];
  let pageToken: string | undefined;
  do {
    const res = await adsense.accounts.list({ pageSize: 100, pageToken });
    accounts.push(...(res.data.accounts || []));
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);
  return accounts;
}

export async function runExport(args: string[]): Promise<number> {
  try {
    const accountIdOrAlias = getFlag(args, 'account');
    const config = await loadConfig();
    let accounts = Object.values(config.accounts).filter(a => a.engine === 'adsense');

    if (accounts.length === 0) {
      printError('No AdSense account configured.');
      log(`\nRun ${colors.cyan}search-console-mcp setup --engine=adsense${colors.reset} first.`);
      return 1;
    }

    let account: AccountConfig | undefined;
    if (accountIdOrAlias) {
      account = accounts.find(a => a.id === accountIdOrAlias || a.alias === accountIdOrAlias);
      if (!account) {
        printError(`AdSense account "${accountIdOrAlias}" not found.`);
        accounts.forEach(a => log(`  • ${a.alias} (${a.id})`));
        return 1;
      }
    } else if (accounts.length === 1) {
      account = accounts[0];
    } else {
      account = await prompts.select(
        'Which AdSense account do you want to export?',
        accounts.map(a => ({ value: a, label: `${a.alias} (${a.adsenseAccountId || a.id})` }))
      );
    }

    const tokens = await loadTokensForAccount(account!);
    if (!tokens?.refresh_token) {
      printError(`No OAuth refresh token stored for "${account!.alias}".`);
      log(`\nRe-authorize first: ${colors.cyan}search-console-mcp setup --engine=adsense${colors.reset}`);
      return 1;
    }

    const clientId = process.env.GOOGLE_CLIENT_ID || DEFAULT_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || DEFAULT_CLIENT_SECRET;

    printBoxHeader('AdSense Headless Export');
    printInfo(`Account: ${account!.alias} (${account!.adsenseAccountId})`);

    if (process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_SECRET) {
      printInfo(`Custom OAuth client detected — also set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server.`);
    }
    if (clientId !== DEFAULT_CLIENT_ID || clientSecret !== DEFAULT_CLIENT_SECRET) {
      // Unreachable unless defaults change; kept as a safety net.
      printInfo('Non-default bundled OAuth client in use — mirror it on the server.');
    }

    log('');
    log(`${colors.bold}On your headless server, run:${colors.reset}`);
    log('');
    log(`  ${colors.cyan}search-console-mcp adsense-import \\${colors.reset}`);
    log(`    ${colors.cyan}--token='${tokens.refresh_token}'${colors.reset}${account!.adsenseAccountId ? ` \\` : ''}`);
    if (account!.adsenseAccountId) {
      log(`    ${colors.cyan}--publisher-id='${account!.adsenseAccountId}'${colors.reset}`);
    }
    log('');
    log(`${colors.dim}Values, if you prefer to paste them separately:${colors.reset}`);
    log(`  refresh token : ${tokens.refresh_token}`);
    if (account!.adsenseAccountId) log(`  publisher ID  : ${account!.adsenseAccountId}`);
    log('');
    log(`${colors.yellow}⚠ Treat the refresh token like a password — it grants read-only AdSense${colors.reset}`);
    log(`${colors.yellow}  access until revoked (Google Account → Security → Third-party access).${colors.reset}`);
    return 0;
  } catch (e) {
    if ((e as any).name === 'CancelledError') return 1;
    printError(`Export failed: ${(e as Error).message}`);
    return 1;
  }
}

export async function runImport(args: string[]): Promise<number> {
  try {
    const tokenFlag = getFlag(args, 'token');
    const publisherIdFlag = getFlag(args, 'publisher-id');
    const aliasFlag = getFlag(args, 'alias');

    let refreshToken = (tokenFlag ?? '').trim();
    if (!refreshToken) {
      refreshToken = (await prompts.text(
        "Paste the refresh token printed by 'search-console-mcp adsense-export':"
      )).trim();
    }
    if (!refreshToken) {
      printError('A refresh token is required. Run this on your laptop: search-console-mcp adsense-export');
      return 1;
    }

    const clientId = process.env.GOOGLE_CLIENT_ID || DEFAULT_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || DEFAULT_CLIENT_SECRET;

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);

    const email = await withSpinner('Validating token with Google...', async () => {
      oauth2Client.setCredentials({ refresh_token: refreshToken });
      return await getUserEmail({ refresh_token: refreshToken });
    });

    let publisherId = (publisherIdFlag ?? '').trim();
    if (!publisherId) {
      let pubAccounts: import('googleapis').adsense_v2.Schema$Account[] = [];
      await withSpinner('Detecting AdSense publisher accounts...', async () => {
        pubAccounts = await listPublisherAccounts(oauth2Client);
      });

      if (pubAccounts.length === 0) {
        printError('This Google account has no approved AdSense publisher account.');
        log(`\nSign up or check status at ${colors.cyan}https://adsense.google.com${colors.reset}`);
        return 1;
      }

      if (pubAccounts.length > 1 && !process.stdout.isTTY) {
        printError('Multiple publisher accounts found — specify one explicitly:');
        pubAccounts.forEach(a => log(`  --publisher-id=${a.name}${a.displayName ? ` (${a.displayName})` : ''}`));
        return 1;
      }

      publisherId = pubAccounts.length === 1
        ? pubAccounts[0].name!
        : await prompts.select(
            'Select a publisher account:',
            pubAccounts.map(a => ({ value: a.name!, label: a.displayName || a.name || 'Unknown' }))
          );
    }

    await withSpinner('Verifying report access...', () =>
      google.adsense({ version: 'v2', auth: oauth2Client }).accounts.reports.generate({
        account: publisherId,
        dateRange: 'LAST_7_DAYS',
        metrics: ['ESTIMATED_EARNINGS'],
        limit: 1
      })
    );

    const alias = (aliasFlag ?? '').trim() || `${email}-adsense`;

    const config = await loadConfig();
    const existing = Object.values(config.accounts).find(
      a => a.engine === 'adsense' && a.adsenseAccountId === publisherId
    );

    const account: AccountConfig = {
      ...(existing || {}),
      id: existing ? existing.id : `adsense_${Date.now()}`,
      engine: 'adsense',
      alias,
      adsenseAccountId: publisherId,
      isLegacy: false
    };

    // Persist tokens first so a failed save never leaves a configured
    // account without credentials. Only the refresh token is durable —
    // the client auto-refreshes an access token on first API use.
    await saveTokensForAccount(account, { refresh_token: refreshToken });
    await updateAccount(account);

    printSuccess(existing
      ? `Updated AdSense account "${existing.alias}" → "${alias}" (${publisherId}).`
      : `Successfully imported AdSense account "${alias}" (${publisherId})!`);
    printInfo('Token stored encrypted on this machine and auto-refreshed — no re-authorization needed until Google revokes it.');
    return 0;
  } catch (e) {
    if ((e as any).name === 'CancelledError' || (e as any).name === 'InteractiveRequiredError') return 1;
    printError(`Import failed: ${(e as Error).message}`);
    printInfo('Double-check the token was copied fully, and that any custom GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET match the exporting machine.');
    return 1;
  }
}
