import { loadConfig, removeAccount, updateAccount } from './common/auth/config.js';

function parseFlags(args: string[]): Record<string, string> {
    const flags: Record<string, string> = {};
    for (const arg of args) {
        const match = arg.match(/^--([^=]+)=(.+)$/);
        if (match) {
            flags[match[1]] = match[2];
        }
    }
    return flags;
}

function findAccountByAliasOrId(accounts: Record<string, any>, identifier: string) {
    // Try exact ID match first
    if (accounts[identifier]) return accounts[identifier];
    // Then try alias match (case-insensitive)
    return Object.values(accounts).find(
        (a: any) => a.alias?.toLowerCase() === identifier.toLowerCase() || a.id === identifier
    );
}

export async function main(args: string[]) {
    const subcommand = args[0] || 'list';
    const flags = parseFlags(args.slice(1));
    // Positional args (non-flag args after the subcommand)
    const positional = args.slice(1).filter(a => !a.startsWith('--'));

    if (subcommand === 'list') {
        try {
            const config = await loadConfig();
            const accounts = Object.values(config.accounts);

            if (accounts.length === 0) {
                console.log(JSON.stringify({
                    accounts: [],
                    message: "No accounts connected.",
                    resolution: {
                        command: "search-console-mcp setup",
                        google: "search-console-mcp setup --engine=google",
                        bing: "search-console-mcp setup --engine=bing",
                        ga4: "search-console-mcp setup --engine=ga4",
                        adsense: "search-console-mcp setup --engine=adsense"
                    },
                    setup_instructions: {
                        google: [
                            "Run: search-console-mcp setup --engine=google",
                            "Choose OAuth 2.0 login or Service Account",
                            "Authorize in browser and select sites to restrict (or allow all)"
                        ],
                        bing: [
                            "Run: search-console-mcp setup --engine=bing",
                            "Get your API key from https://www.bing.com/webmasters/settings/api",
                            "Enter the API key when prompted"
                        ],
                        ga4: [
                            "Run: search-console-mcp setup --engine=ga4",
                            "Choose Service Account (OAuth coming soon)",
                            "Add the service account email to your GA4 property"
                        ],
                        adsense: [
                            "Run: search-console-mcp setup --engine=adsense",
                            "Authorize with your Google account (read-only AdSense scope)",
                            "Select the publisher account to connect"
                        ]
                    }
                }, null, 2));
                return;
            }

            const siteRows: { site: string, account: string, engine: string, id: string }[] = [];

            for (const a of accounts) {
                const alias = a.alias || '[Unnamed]';
                const engine = a.engine === 'google' ? 'Google' : a.engine === 'bing' ? 'Bing' : a.engine === 'adsense' ? 'AdSense' : 'GA4';

                if (!a.websites || a.websites.length === 0) {
                    siteRows.push({
                        site: '[All Sites Authorized]',
                        account: alias,
                        engine: engine,
                        id: a.id
                    });
                } else {
                    for (const site of a.websites) {
                        siteRows.push({
                            site: site,
                            account: alias,
                            engine: engine,
                            id: a.id
                        });
                    }
                }
            }

            console.log(JSON.stringify({ accounts: siteRows }, null, 2));
        } catch (error: any) {
            console.log(JSON.stringify({
                error: "Failed to list accounts",
                message: error.message
            }, null, 2));
        }
        return;
    }

    if (subcommand === 'remove') {
        // Flags (agent): --account=alias --site=url  |  Positional (human): remove <alias_or_site>
        const identifier = flags['account'] || flags['id'] || positional[0];
        const siteToRemove = flags['site'];

        if (!identifier && !siteToRemove) {
            console.log(JSON.stringify({
                error: "Missing arguments",
                message: "Provide --account=<alias|id> to remove an account, or --site=<url> to remove a specific site boundary.",
                resolution: {
                    by_account: "search-console-mcp accounts remove --account=<alias_or_id>",
                    by_site: "search-console-mcp accounts remove --site=<siteUrl>"
                }
            }, null, 2));
            return;
        }

        try {
            const config = await loadConfig();

            if (identifier) {
                // Remove entire account by alias or ID
                const account = findAccountByAliasOrId(config.accounts, identifier);
                if (!account) {
                    console.log(JSON.stringify({
                        error: "Account not found",
                        message: `No account matching '${identifier}' was found.`,
                        resolution: "Run: search-console-mcp accounts list"
                    }, null, 2));
                    return;
                }
                await removeAccount(account.id);
                console.log(JSON.stringify({
                    success: true,
                    message: `Account '${account.alias}' (${account.id}) removed successfully.`
                }, null, 2));
            } else if (siteToRemove) {
                // Remove a specific site boundary from whichever account owns it
                let found = false;
                for (const account of Object.values(config.accounts)) {
                    if (account.websites?.includes(siteToRemove)) {
                        account.websites = account.websites.filter((w: string) => w !== siteToRemove);
                        await updateAccount(account);
                        found = true;
                        console.log(JSON.stringify({
                            success: true,
                            message: `Site '${siteToRemove}' removed from account '${account.alias}'.`
                        }, null, 2));
                        break;
                    }
                }
                if (!found) {
                    console.log(JSON.stringify({
                        error: "Site not found",
                        message: `No account has '${siteToRemove}' in its site boundaries.`,
                        resolution: "Run: search-console-mcp accounts list"
                    }, null, 2));
                }
            }
        } catch (error: any) {
            console.log(JSON.stringify({
                error: "Failed to remove",
                message: error.message
            }, null, 2));
        }
        return;
    }

    if (subcommand === 'add-site') {
        // Flags (agent): --account=alias --site=url  |  Positional (human): add-site <alias> <site>
        const identifier = flags['account'] || flags['id'] || positional[0];
        const site = flags['site'] || positional[1];

        if (!identifier || !site) {
            console.log(JSON.stringify({
                error: "Missing arguments",
                message: "Both --account and --site are required.",
                resolution: "search-console-mcp accounts add-site --account=<alias_or_id> --site=<siteUrl>"
            }, null, 2));
            return;
        }

        try {
            const config = await loadConfig();
            const account = findAccountByAliasOrId(config.accounts, identifier);

            if (!account) {
                console.log(JSON.stringify({
                    error: "Account not found",
                    message: `No account matching '${identifier}' was found.`,
                    resolution: "Run: search-console-mcp accounts list"
                }, null, 2));
                return;
            }

            if (!account.websites) account.websites = [];
            if (!account.websites.includes(site)) {
                account.websites.push(site);
                await updateAccount(account);
                console.log(JSON.stringify({
                    success: true,
                    message: `Site '${site}' added to account '${account.alias}'.`
                }, null, 2));
            } else {
                console.log(JSON.stringify({
                    success: true,
                    message: `Account '${account.alias}' already has '${site}' in its boundaries.`
                }, null, 2));
            }
        } catch (error: any) {
            console.log(JSON.stringify({
                error: "Failed to add site",
                message: error.message
            }, null, 2));
        }
        return;
    }

    console.log(JSON.stringify({
        error: "Unknown command",
        message: `'${subcommand}' is not a valid subcommand.`,
        resolution: {
            list: "search-console-mcp accounts list",
            remove_account: "search-console-mcp accounts remove --account=<alias_or_id>",
            remove_site: "search-console-mcp accounts remove --site=<siteUrl>",
            add_site: "search-console-mcp accounts add-site --account=<alias_or_id> --site=<siteUrl>"
        }
    }, null, 2));
}
