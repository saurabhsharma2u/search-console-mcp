import { resolveAccount } from '../common/auth/resolver.js';
import { loadConfig } from '../common/auth/config.js';
import { getCurrentTenant } from '../tenant/context.js';
import { assertAccountIdAllowed } from '../tenant/guard.js';
import { sanitizeForLog } from '../utils/redaction.js';

export interface BingSite {
    Url: string;
    State: string;
    Role: string;
}

export interface BingQueryStats {
    Query: string;
    Clicks: number;
    Impressions: number;
    CTR: number;
    AvgPosition: number;
    Date: string;
}

export interface BingPageStats {
    Query: string; // The API returns URL in the 'Query' field for GetPageStats
    Clicks: number;
    Impressions: number;
    CTR: number;
    AvgPosition: number;
    Date: string;
}

export interface BingKeywordStats {
    Keyword: string;
    Impressions: number;
    Date: string;
}

export interface BingCrawlIssue {
    Url: string;
    IssueType: string;
    FirstSeen: string;
    LastSeen: string;
}

export interface BingUrlSubmissionQuota {
    DailyQuota: number;
    MonthlyQuota: number;
}

export interface BingRankAndTrafficStats {
    Date: string;
    Clicks: number;
    Impressions: number;
    AvgPosition: number;
}

export interface BingQueryPageStats {
    Query: string;
    Page: string;
    Clicks: number;
    Impressions: number;
    Date: string;
}

export interface BingCrawlStats {
    Date: string;
    PagesIndexed: number;
    PagesCrawled: number;
    CrawlErrors: number;
}

export interface BingUrlInfo {
    Url: string;
    HttpStatus: number;
    LastCrawledDate: string;
    AnchorCount: number;
    DiscoveryDate: string;
    DocumentSize: number;
    IsPage: boolean;
    TotalChildUrlCount: number;
}

export interface BingLinkCount {
    Url: string;
    InboundLinks: number;
}

export interface BingRelatedKeyword {
    Keyword: string;
    SearchVolume: number;
}

export class BingClient {
    private apiKey: string;
    private baseUrl = 'https://ssl.bing.com/webmaster/api.svc/json';

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    private async request<T>(method: string, params: Record<string, any> = {}, isPost = false): Promise<T> {
        const url = new URL(`${this.baseUrl}/${method}`);
        url.searchParams.append('apikey', this.apiKey);

        const options: any = {
            method: isPost ? 'POST' : 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        };

        if (isPost) {
            options.body = JSON.stringify(params);
        } else {
            for (const [key, value] of Object.entries(params)) {
                url.searchParams.append(key, String(value));
            }
        }

        const response = await fetch(url.toString(), options);
        if (!response.ok) {
            const error = await response.text();
            throw new Error(sanitizeForLog(`Bing API error (${method}): ${response.status} ${error}`));
        }

        const data = await response.json() as any;
        if (data && data.hasOwnProperty('d')) {
            return data.d as T;
        }
        return data as T;
    }

    async getSiteList(): Promise<BingSite[]> {
        return this.request<BingSite[]>('GetUserSites');
    }

    async addSite(siteUrl: string): Promise<void> {
        return this.request<void>('AddSite', { siteUrl }, true);
    }

    async removeSite(siteUrl: string): Promise<void> {
        return this.request<void>('RemoveSite', { siteUrl }, true);
    }

    async getQueryStats(siteUrl: string): Promise<BingQueryStats[]> {
        return this.request<BingQueryStats[]>('GetQueryStats', { siteUrl });
    }

    async getPageStats(siteUrl: string): Promise<BingPageStats[]> {
        return this.request<BingPageStats[]>('GetPageStats', { siteUrl });
    }

    async getPageQueryStats(siteUrl: string, page: string): Promise<BingQueryStats[]> {
        return this.request<BingQueryStats[]>('GetPageQueryStats', { siteUrl, page });
    }

    async submitSitemap(siteUrl: string, feedUrl: string): Promise<void> {
        await this.request<void>('SubmitFeed', { siteUrl, feedUrl }, true);
    }

    async deleteSitemap(siteUrl: string, feedUrl: string): Promise<void> {
        await this.request<void>('RemoveFeed', { siteUrl, feedUrl }, true);
    }

    async getFeeds(siteUrl: string): Promise<any[]> {
        return this.request<any[]>('GetFeeds', { siteUrl });
    }

    async getKeywordStats(q: string, country?: string, language?: string): Promise<BingKeywordStats[]> {
        return this.request<BingKeywordStats[]>('GetKeywordStats', { q, country, language });
    }

    async getCrawlIssues(siteUrl: string): Promise<BingCrawlIssue[]> {
        return this.request<BingCrawlIssue[]>('GetCrawlIssues', { siteUrl });
    }

    async getUrlSubmissionQuota(siteUrl: string): Promise<BingUrlSubmissionQuota> {
        return this.request<BingUrlSubmissionQuota>('GetUrlSubmissionQuota', { siteUrl });
    }

    async submitUrl(siteUrl: string, url: string): Promise<void> {
        return this.request<void>('SubmitUrl', { siteUrl, url }, true);
    }

    async submitUrlBatch(siteUrl: string, urlList: string[]): Promise<void> {
        return this.request<void>('SubmitUrlBatch', { siteUrl, urlList }, true);
    }

    async getQueryPageStats(siteUrl: string): Promise<BingQueryPageStats[]> {
        return this.request<BingQueryPageStats[]>('GetQueryPageStats', { siteUrl });
    }

    async getRankAndTrafficStats(siteUrl: string): Promise<BingRankAndTrafficStats[]> {
        return this.request<BingRankAndTrafficStats[]>('GetRankAndTrafficStats', { siteUrl });
    }

    async getCrawlStats(siteUrl: string): Promise<BingCrawlStats[]> {
        return this.request<BingCrawlStats[]>('GetCrawlStats', { siteUrl });
    }

    async getUrlInfo(siteUrl: string, url: string): Promise<BingUrlInfo> {
        return this.request<BingUrlInfo>('GetUrlInfo', { siteUrl, url });
    }

    async getLinkCounts(siteUrl: string): Promise<BingLinkCount[]> {
        return this.request<BingLinkCount[]>('GetLinkCounts', { siteUrl });
    }

    async getRelatedKeywords(q: string, country?: string, language?: string): Promise<BingRelatedKeyword[]> {
        return this.request<BingRelatedKeyword[]>('GetRelatedKeywords', { q, country, language });
    }
}

let cachedBingClients: Record<string, BingClient> = {};

export async function getBingClient(siteUrl?: string, accountId?: string): Promise<BingClient> {
    // 1. Resolve Account
    let apiKey: string | undefined;
    let cacheKey: string;

    if (accountId) {
        const tenant = getCurrentTenant();
        if (tenant) assertAccountIdAllowed(tenant, accountId, 'bing');
        const config = await loadConfig();
        const account = config.accounts[accountId];
        if (!account || account.engine !== 'bing') {
            throw new Error(`Bing account ${accountId} not found.`);
        }
        apiKey = account.apiKey;
        cacheKey = account.id;
    } else {
        try {
            const account = await resolveAccount(siteUrl || '', 'bing');
            apiKey = account.apiKey;
            cacheKey = account.id;
        } catch (error) {
            if (getCurrentTenant()) {
                throw error;
            }
            // Fallback to environment variable for legacy support if resolution fails or no site specified
            apiKey = process.env.BING_API_KEY;
            cacheKey = 'env_fallback';

            if (!apiKey) {
                throw error; // Re-throw the resolution error if no ENV fallback either
            }
        }
    }

    if (cachedBingClients[cacheKey]) return cachedBingClients[cacheKey];

    if (!apiKey) {
        throw new Error('Bing API Key not found. Please run setup to add an account.');
    }

    const client = new BingClient(apiKey);
    cachedBingClients[cacheKey] = client;
    return client;
}
