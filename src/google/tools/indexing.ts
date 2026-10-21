import { getIndexingClient, resolveIndexingAccount } from '../client.js';
import { limitConcurrency } from '../../common/concurrency.js';
import { resolveFullWebUrl } from '../../common/auth/resolver.js';
import { translateScopeError } from '../../common/auth/scope-error.js';

/**
 * Notification type for the Google Indexing API.
 */
export type NotificationType = 'URL_UPDATED' | 'URL_DELETED';

/**
 * Response from a URL notification publish request.
 */
export interface PublishNotificationResult {
    /** The URL that was notified. */
    url: string;
    /** The type of notification sent. */
    type: NotificationType;
    /** The time the notification was received by Google. */
    notifyTime: string;
}

/**
 * Response from a URL notification metadata (status) request.
 */
export interface NotificationStatusResult {
    /** The URL queried. */
    url: string;
    /** Metadata for the latest URL_UPDATED notification. */
    latestUpdate?: {
        url: string;
        type: string;
        notifyTime: string;
    };
    /** Metadata for the latest URL_DELETED notification. */
    latestRemove?: {
        url: string;
        type: string;
        notifyTime: string;
    };
}

/**
 * Result of a batch notification publish request.
 */
export interface BatchPublishResult {
    url: string;
    result?: PublishNotificationResult;
    error?: string;
}

const INDEXING_API_BASE = 'https://indexing.googleapis.com/v3/urlNotifications';

/**
 * Publish a URL notification to Google's Indexing API.
 *
 * @param siteUrl - The site URL for account resolution.
 * @param url - The URL to notify about.
 * @param type - The notification type: URL_UPDATED or URL_DELETED.
 * @returns The publish notification result.
 */
export async function publishNotification(
    siteUrl: string,
    url: string,
    type: NotificationType,
    existingToken?: string
): Promise<PublishNotificationResult> {
    const fullUrl = resolveFullWebUrl(url);
    let accountId: string | undefined;
    let token = existingToken;
    try {
        if (!token) {
            const account = await resolveIndexingAccount(siteUrl);
            accountId = account.id;
            const auth = await getIndexingClient(siteUrl);
            const accessToken = await auth.getAccessToken();
            token = typeof accessToken === 'string' ? accessToken : accessToken.token;
        }

        const response = await fetch(`${INDEXING_API_BASE}:publish`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ url: fullUrl, type })
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Google Indexing API error: ${response.status} ${errorBody}`);
        }

        const data = await response.json() as any;
        return {
            url: data.urlNotificationMetadata?.url || url,
            type,
            notifyTime: data.urlNotificationMetadata?.latestUpdate?.notifyTime ||
                         data.urlNotificationMetadata?.latestRemove?.notifyTime ||
                         new Date().toISOString()
        };
    } catch (error) {
        throw translateScopeError(error, 'indexing', accountId);
    }
}

/**
 * Get the notification status for a URL from Google's Indexing API.
 *
 * @param siteUrl - The site URL for account resolution.
 * @param url - The URL to check the status of.
 * @returns The notification status result.
 */
export async function getNotificationStatus(
    siteUrl: string,
    url: string
): Promise<NotificationStatusResult> {
    let accountId: string | undefined;
    try {
        const account = await resolveIndexingAccount(siteUrl);
        accountId = account.id;
        const auth = await getIndexingClient(siteUrl);
        const accessToken = await auth.getAccessToken();
        const token = typeof accessToken === 'string' ? accessToken : accessToken.token;

        const requestUrl = new URL(`${INDEXING_API_BASE}/metadata`);
        requestUrl.searchParams.set('url', url);

        const response = await fetch(requestUrl.toString(), {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Google Indexing API error: ${response.status} ${errorBody}`);
        }

        const data = await response.json() as any;
        return {
            url: data.url || url,
            latestUpdate: data.latestUpdate || undefined,
            latestRemove: data.latestRemove || undefined
        };
    } catch (error) {
        throw translateScopeError(error, 'indexing', accountId);
    }
}

/**
 * Publish URL notifications in batch using concurrency control.
 *
 * Google Indexing API does not have a native batch endpoint for v3,
 * so we use concurrent individual requests with rate limiting.
 *
 * @param siteUrl - The site URL for account resolution.
 * @param urls - The list of URLs to notify about.
 * @param type - The notification type for all URLs.
 * @returns An array of results for each URL.
 */
export async function batchPublishNotifications(
    siteUrl: string,
    urls: string[],
    type: NotificationType
): Promise<BatchPublishResult[]> {
    if (urls.length === 0) return [];
    if (urls.length > 200) {
        throw new Error('Batch limited to 200 URLs (Google Indexing API daily quota). Please submit in smaller batches.');
    }

    let token: string | undefined;
    try {
        const auth = await getIndexingClient(siteUrl);
        const accessToken = await auth.getAccessToken();
        token = typeof accessToken === 'string' ? accessToken : accessToken.token;
    } catch {
        // Fallback to per-request resolution if token resolution fails
    }

    return limitConcurrency(urls, 5, async (url) => {
        try {
            const result = await publishNotification(siteUrl, url, type, token);
            return { url, result };
        } catch (error) {
            return { url, error: (error as Error).message };
        }
    });
}
