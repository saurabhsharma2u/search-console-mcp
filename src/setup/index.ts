import 'dotenv/config';
import { prompts, CancelledError, InteractiveRequiredError } from '../utils/prompts.js';
import { colors } from '../utils/ui.js';
import { FLOWS } from './registry.js';
import {
    log, printHeader, printInfo, printError,
    detectConfig, isAnyAccountConfigured, printDetectionSummary
} from './shared.js';

const VALID_ENGINES = [...FLOWS.map(f => f.id)];

function statusHint(configured: boolean): string | undefined {
    return configured ? 'connected — select to reconfigure' : undefined;
}

export async function main() {
    const args = process.argv.slice(2);

    // `--accounts` passthrough for developer convenience
    if (args.includes('--accounts') || args.includes('accounts')) {
        const { main: accountsMain } = await import('../accounts.js');
        const accountsArgs = args.filter(a => a !== '--accounts' && a !== 'accounts');
        await accountsMain(accountsArgs.length ? accountsArgs : ['list']);
        return;
    }

    // Machine-readable status: JSON to stdout, no UI
    if (args.includes('--status')) {
        const { loadConfig } = await import('../common/auth/config.js');
        const [status, config] = await Promise.all([detectConfig(), loadConfig()]);
        process.stdout.write(JSON.stringify({
            google: status.googleAccounts.length > 0,
            bing: status.bingAccounts.length > 0 || status.legacyBing,
            ga4: status.ga4Accounts.length > 0,
            adsense: status.adsenseAccounts.length > 0,
            pagespeed: status.pagespeedApiKey,
            accounts: Object.values(config.accounts).map(a => ({
                id: a.id,
                alias: a.alias,
                engine: a.engine,
                websites: a.websites || [],
                ga4PropertyId: a.ga4PropertyId,
                adsenseAccountId: a.adsenseAccountId,
            })),
        }, null, 2) + '\n');
        return;
    }

    const engineFlag = args.find(a => a.startsWith('--engine='))?.split('=')[1]?.toLowerCase();
    if (engineFlag && !VALID_ENGINES.includes(engineFlag)) {
        console.error(`${colors.red}✘${colors.reset} ${colors.bold}Unknown engine: '${engineFlag}'${colors.reset}`);
        console.error(`\nValid options:\n  ${VALID_ENGINES.map(e => `--engine=${e}`).join('\n  ')}`);
        process.exit(1);
    }

    let configStatus = await detectConfig();

    // Direct flow dispatch via --engine=<id>
    if (engineFlag) {
        const flow = FLOWS.find(f => f.id === engineFlag)!;
        try {
            await flow.configure(configStatus);
        } catch (error) {
            handleFlowError(error);
        }
        return;
    }

    printHeader();

    if (!isAnyAccountConfigured(configStatus)) {
        log(`${colors.bold}Welcome! No data sources are connected yet.${colors.reset}`);
        log(`Let's connect your first platform. You can add more anytime by re-running ${colors.cyan}search-console-mcp setup${colors.reset}.\n`);
    } else {
        printDetectionSummary(configStatus);
    }

    while (true) {
        const primary = FLOWS.filter(f => !f.advanced);
        const advanced = FLOWS.filter(f => f.advanced);

        let choice: string;
        try {
            choice = await prompts.select('What would you like to configure?', [
                ...primary.map(f => ({
                    value: f.id,
                    label: f.label,
                    hint: statusHint(f.isConfigured(configStatus)) ?? f.description,
                })),
                ...advanced.map(f => ({
                    value: f.id,
                    label: f.label,
                    hint: statusHint(f.isConfigured(configStatus)) ?? f.description,
                })),
                { value: '__diagnostics', label: 'Run diagnostics', hint: 'Check the health of configured platforms' },
                { value: '__exit', label: 'Exit' },
            ]);
        } catch (error) {
            if (error instanceof CancelledError || error instanceof InteractiveRequiredError) return;
            throw error;
        }

        if (choice === '__exit') {
            log(`\n${colors.dim}See you on the flip side!${colors.reset}`);
            return;
        }

        if (choice === '__diagnostics') {
            const { runDiagnostics } = await import('../common/diagnostics.js');
            try {
                const results = await runDiagnostics();
                log(JSON.stringify(results, null, 2));
            } catch (e) {
                printError(`Diagnostics failed: ${(e as Error).message}`);
            }
            continue;
        }

        const flow = FLOWS.find(f => f.id === choice);
        if (!flow) continue;

        try {
            await flow.configure(configStatus);
        } catch (error) {
            handleFlowError(error);
        }
        // Refresh status so the menu reflects any newly connected engine.
        configStatus = await detectConfig();
    }
}

function handleFlowError(error: unknown): void {
    if (error instanceof CancelledError) {
        log(`\n${colors.dim}Cancelled — nothing changed.${colors.reset}`);
        return;
    }
    if (error instanceof InteractiveRequiredError) {
        printError(error.message);
        process.exit(1);
    }
    throw error;
}
