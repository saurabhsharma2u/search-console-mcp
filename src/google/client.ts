import { google, searchconsole_v1 } from 'googleapis';
import nodeMachineId from 'node-machine-id';
import { AccountConfig, loadConfig, saveConfig, updateAccount, removeAccount, assertServiceAccountKeyReadable } from '../common/auth/config.js';
import { resolveAccount } from '../common/auth/resolver.js';
import { logger } from '../utils/logger.js';
const { machineIdSync } = nodeMachineId;

const SCOPES = [
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/userinfo.email'
];
const SERVICE_NAME = 'io.github.saurabhsharma2u.search-console-mcp';
const DEFAULT_ACCOUNT = 'default';

// Default Client ID for Desktop Flow
export const DEFAULT_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '347626597503-dr6t24m0i3g1nl1suam86rs650t3fhau.apps.googleusercontent.com';
export const DEFAULT_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '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';

// Encryption logic moved to src/common/auth/config.ts

let cachedClientMap: Record<string, searchconsole_v1.Searchconsole> = {};

export async function getSearchConsoleClient(siteUrl?: string, accountId?: string): Promise<searchconsole_v1.Searchconsole> {
  // 1. Resolve Account
  let account: AccountConfig;
  if (accountId) {
    const config = await loadConfig();
    account = config.accounts[accountId];
    if (!account) throw new Error(`Account ${accountId} not found.`);
  } else if (siteUrl) {
    account = await resolveAccount(siteUrl, 'google');
  } else {
    // Try to find any Google account if no specific site requested
    account = await resolveAccount('', 'google');
  }

  const cacheKey = account.id;
  if (cachedClientMap[cacheKey]) {
    logger.debug(`Using cached client for account: ${account.alias} (${account.id})`);
    return cachedClientMap[cacheKey];
  }

  logger.debug(`Initializing Search Console client for ${account.alias} (ID: ${account.id}, Engine: ${account.engine})`);

  // 2. Load Tokens
  const tokens = await loadTokensForAccount(account);

  if (tokens) {
    try {
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID || DEFAULT_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET || DEFAULT_CLIENT_SECRET
      );
      oauth2Client.setCredentials(tokens);

      // Check for expiry (refresh if needed)
      if (tokens.expiry_date && tokens.expiry_date <= Date.now()) {
        logger.debug(`Tokens expired for ${account.alias}, refreshing...`);
        const { credentials } = await oauth2Client.refreshAccessToken();
        await saveTokensForAccount(account, credentials);
        oauth2Client.setCredentials(credentials);
      }

      const client = google.searchconsole({ version: 'v1', auth: oauth2Client });
      logger.debug(`Client successfully initialized with OAuth2 for ${account.alias}`);
      cachedClientMap[cacheKey] = client;
      return client;
    } catch (error) {
      logger.error(`Failed to use tokens for account ${account.alias}:`, (error as Error).message);
    }
  }

  // 3. Support Service Account Path (Multi-Account)
  if (account.serviceAccountPath) {
    assertServiceAccountKeyReadable(account);
    const auth = new google.auth.GoogleAuth({
      keyFilename: account.serviceAccountPath,
      scopes: SCOPES
    });
    const client = google.searchconsole({ version: 'v1', auth });
    cachedClientMap[cacheKey] = client;
    logger.debug(`Client initialized with Service Account Path for ${account.alias}`);
    return client;
  }

  // 4. Fallback to Service Account (Environment Variables) - Only if no specific account was resolved or it was a legacy fallback
  if (!accountId) {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      const auth = new google.auth.GoogleAuth({
        scopes: SCOPES
      });
      return google.searchconsole({ version: 'v1', auth });
    }

    if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
      const jwtClient = new google.auth.JWT({
        email: process.env.GOOGLE_CLIENT_EMAIL,
        key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        scopes: SCOPES
      });
      await jwtClient.authorize();
      return google.searchconsole({ version: 'v1', auth: jwtClient as any });
    }
  }

  throw new Error(`Authentication required for ${siteUrl || 'Google Search Console'}. Run setup to add an account.`);
}

const INDEXING_SCOPES = [
  'https://www.googleapis.com/auth/indexing',
  'https://www.googleapis.com/auth/userinfo.email'
];

let cachedIndexingClientMap: Record<string, any> = {};

/**
 * Get an authenticated client for the Google Indexing API.
 * Uses the `indexing` scope which is separate from the read-only `webmasters.readonly` scope.
 *
 * @param siteUrl - The site URL to resolve the account for.
 * @param accountId - Optional specific account ID to use.
 * @returns An authenticated OAuth2 client with the indexing scope.
 */
export async function getIndexingClient(siteUrl?: string, accountId?: string): Promise<any> {
  // 1. Resolve Account
  let account: AccountConfig;
  if (accountId) {
    const config = await loadConfig();
    account = config.accounts[accountId];
    if (!account) throw new Error(`Account ${accountId} not found.`);
  } else if (siteUrl) {
    account = await resolveAccount(siteUrl, 'google');
  } else {
    account = await resolveAccount('', 'google');
  }

  const cacheKey = `indexing_${account.id}`;
  if (cachedIndexingClientMap[cacheKey]) {
    logger.debug(`Using cached indexing client for account: ${account.alias} (${account.id})`);
    return cachedIndexingClientMap[cacheKey];
  }

  logger.debug(`Initializing Indexing API client for ${account.alias} (ID: ${account.id})`);

  // 2. Load Tokens
  const tokens = await loadTokensForAccount(account);

  if (tokens) {
    try {
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID || DEFAULT_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET || DEFAULT_CLIENT_SECRET
      );
      oauth2Client.setCredentials(tokens);

      // Check for expiry
      if (tokens.expiry_date && tokens.expiry_date <= Date.now()) {
        logger.debug(`Tokens expired for ${account.alias}, refreshing...`);
        const { credentials } = await oauth2Client.refreshAccessToken();
        await saveTokensForAccount(account, credentials);
        oauth2Client.setCredentials(credentials);
      }

      logger.debug(`Indexing client initialized with OAuth2 for ${account.alias}`);
      cachedIndexingClientMap[cacheKey] = oauth2Client;
      return oauth2Client;
    } catch (error) {
      logger.error(`Failed to use tokens for indexing client ${account.alias}:`, (error as Error).message);
    }
  }

  // 3. Support Service Account Path
  if (account.serviceAccountPath) {
    assertServiceAccountKeyReadable(account);
    const auth = new google.auth.GoogleAuth({
      keyFilename: account.serviceAccountPath,
      scopes: INDEXING_SCOPES
    });
    const client = await auth.getClient();
    cachedIndexingClientMap[cacheKey] = client;
    logger.debug(`Indexing client initialized with Service Account for ${account.alias}`);
    return client;
  }

  // 4. Fallback to env-based Service Account
  if (!accountId) {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      const auth = new google.auth.GoogleAuth({
        scopes: INDEXING_SCOPES
      });
      return auth.getClient();
    }

    if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
      const jwtClient = new google.auth.JWT({
        email: process.env.GOOGLE_CLIENT_EMAIL,
        key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        scopes: INDEXING_SCOPES
      });
      await jwtClient.authorize();
      cachedIndexingClientMap[cacheKey] = jwtClient;
      return jwtClient;
    }
  }

  throw new Error(`Authentication required for Google Indexing API. Ensure your account has the 'indexing' scope.`);
}

export async function getUserEmail(tokens: any): Promise<string> {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID || DEFAULT_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET || DEFAULT_CLIENT_SECRET
  );
  oauth2Client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const userInfo = await oauth2.userinfo.get();
  return userInfo.data.email || DEFAULT_ACCOUNT;
}

export async function loadTokensForAccount(account: AccountConfig): Promise<any> {
  // 1. Try Keychain (using alias/email as key for backward compatibility if it's an email)
  const target = account.alias;
  try {
    const { Entry } = await import('@napi-rs/keyring');
    const entry = new Entry(SERVICE_NAME, target);
    const secret = await entry.getPassword();
    if (secret) {
      return JSON.parse(secret);
    }
  } catch (e) { }

  // 2. Fallback to tokens stored in account config
  return account.tokens || null;
}

export async function saveTokensForAccount(account: AccountConfig, tokens: any) {
  const minimalTokens = {
    refresh_token: tokens.refresh_token || account.tokens?.refresh_token,
    expiry_date: tokens.expiry_date,
    access_token: tokens.access_token
  };

  // Update account in config
  account.tokens = minimalTokens;
  await updateAccount(account);

  // Sync to keychain
  const target = account.alias;
  try {
    const { Entry } = await import('@napi-rs/keyring');
    const entry = new Entry(SERVICE_NAME, target);
    await entry.setPassword(JSON.stringify(minimalTokens));
  } catch (e) { }
}

export async function logout(accountId: string) {
  const config = await loadConfig();
  const account = config.accounts[accountId];
  if (!account) return;

  // 1. Try Keychain
  try {
    const { Entry } = await import('@napi-rs/keyring');
    const entry = new Entry(SERVICE_NAME, account.alias);
    await entry.deletePassword();
  } catch (e) { }

  // 2. Remove from config
  await removeAccount(accountId);
}

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_url: string;
  expires_in: number;
  interval: number;
}

export async function initiateDeviceFlow(clientId: string, scopes: string[] = SCOPES): Promise<DeviceCodeResponse> {
  const response = await fetch('https://oauth2.googleapis.com/device/code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      scope: scopes.join(' ')
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to initiate device flow: ${error}`);
  }

  return await response.json() as DeviceCodeResponse;
}

export async function pollForTokens(clientId: string, clientSecret: string, deviceCode: string, interval: number): Promise<any> {
  // This is now deprecated as Device Flow doesn't support Search Console scopes
  throw new Error("Device Flow is not supported for Search Console API.");
}

export async function startLocalFlow(clientId: string, clientSecret: string, scopes: string[] = SCOPES): Promise<any> {
  const { createServer } = await import('http');
  const { google } = await import('googleapis');
  const open = (await import('open')).default;

  const REDIRECT_URI = 'http://localhost:3000/oauth2callback';
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent'
  });

  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      try {
        if (req.url?.startsWith('/oauth2callback')) {
          const url = new URL(req.url, `http://${req.headers.host}`);
          const code = url.searchParams.get('code');

          if (code) {
            const { tokens } = await oauth2Client.getToken(code);
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<h1>Authentication Successful!</h1><p>You can close this tab now and return to your terminal.</p>');
            server.close();
            resolve(tokens);
          }
        }
      } catch (e) {
        res.writeHead(500);
        res.end('<h1>Authentication Failed</h1>');
        server.close();
        reject(e);
      }
    }).listen(3000);

    console.log('\nOpening your browser to authorize Search Console access...');
    open(authUrl);
  });
}
