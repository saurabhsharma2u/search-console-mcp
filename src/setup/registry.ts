import { ConfigStatus } from './shared.js';
import { configureGoogle } from './flows/google.js';
import { configureBing } from './flows/bing.js';
import { configureGA4 } from './flows/ga4.js';
import { configureAdSense } from './flows/adsense.js';
import { configurePageSpeed } from './flows/pagespeed.js';

export interface SetupFlow {
    id: string;
    label: string;
    description: string;
    /** Advanced/optional integrations render at the bottom of the menu. */
    advanced?: boolean;
    isConfigured(status: ConfigStatus): boolean;
    /** Receives freshly-detected status so reconfigure prompts are accurate. */
    configure(status: ConfigStatus): Promise<void>;
}

export const FLOWS: SetupFlow[] = [
    {
        id: 'google',
        label: 'Google Search Console',
        description: 'Search performance data (recommended)',
        isConfigured: (s) => s.googleAccounts.length > 0,
        configure: (status) => configureGoogle(status),
    },
    {
        id: 'ga4',
        label: 'Google Analytics 4',
        description: 'Site engagement metrics',
        isConfigured: (s) => s.ga4Accounts.length > 0,
        configure: (status) => configureGA4(status),
    },
    {
        id: 'bing',
        label: 'Bing Webmaster Tools',
        description: 'Bing search performance',
        isConfigured: (s) => s.bingAccounts.length > 0 || s.legacyBing,
        configure: (status) => configureBing(status),
    },
    {
        id: 'adsense',
        label: 'Google AdSense',
        description: 'Earnings & monetization reports',
        isConfigured: (s) => s.adsenseAccounts.length > 0,
        configure: (status) => configureAdSense(status),
    },
    {
        id: 'pagespeed',
        label: 'PageSpeed Insights (Optional API Key)',
        description: 'Higher PageSpeed quota',
        advanced: true,
        isConfigured: (s) => s.pagespeedApiKey,
        configure: () => configurePageSpeed(),
    },
];
