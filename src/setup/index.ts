import 'dotenv/config';
import { prompts, CancelledError, InteractiveRequiredError } from '../utils/prompts.js';
import { colors } from '../utils/ui.js';
import { isServiceAccountKeyMissing } from '../common/auth/config.js';
import { FLOWS } from './registry.js';
import {
    log, printBanner, printInfo, printError,
    detectConfig, isAnyAccountConfigured, printSummaryLine
} from './shared.js';

const VALID_ENGINES = [...FLOWS.map(f => f.id)];

function hasMissingKey(status: any, flowId: string): boolean {
    const keyMap: Record<string, string> = {
        google: 'googleAccounts',
        ga4: 'ga4Accounts',
        adsense: 'adsenseAccounts',
    };
    const arr = status[keyMap[flowId]];
    return Array.isArray(arr) && arr.some((a: any) => a.keyFileMissing);
}

function menuLabel(flow: (typeof FLOWS)[number], status: any): string {
    const configured = flow.isConfigured(status);
    if (configured && hasMissingKey(status, flow.id)) {
        return `${colors.yellow}⚠${colors.reset} ${flow.label}${colors.dim} · key file missing${colors.reset}`;
    }
    const dot = configured ? `${colors.green}●${colors.reset}` : `${colors.dim}○${colors.reset}`;
    const suffix = configured ? `${colors.dim} · connected${colors.reset}` : '';
    return `${dot} ${flow.label}${suffix}`;
}

function statusHint(configured: boolean, flow: (typeof FLOWS)[number]): string | undefined {
    return configured ? 'select to reconfigure' : flow.description;
}export async function main() {
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
                serviceAccountPath: a.serviceAccountPath,
                keyFileMissing: isServiceAccountKeyMissing(a),
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

    printBanner();

    if (!isAnyAccountConfigured(configStatus)) {
        log(`${colors.bold}Welcome! No data sources are connected yet.${colors.reset}`);
        log(`Let's connect your first platform. You can add more anytime by re-running ${colors.cyan}search-console-mcp setup${colors.reset}.\n`);
    } else {
        printSummaryLine(configStatus, FLOWS.length);
    }

    while (true) {
        const primary = FLOWS.filter(f => !f.advanced);
        const advanced = FLOWS.filter(f => f.advanced);

        let choice: string;
        try {
            choice = await prompts.select('What would you like to configure?', [
                ...primary.map(f => ({
                    value: f.id,
                    label: menuLabel(f, configStatus),
                    hint: statusHint(f.isConfigured(configStatus), f),
                })),
                ...advanced.map(f => ({
                    value: f.id,
                    label: menuLabel(f, configStatus),
                    hint: statusHint(f.isConfigured(configStatus), f),
                })),
                { value: '__diagnostics', label: 'Run diagnostics', hint: 'Check the health of configured platforms' },
                { value: '__exit', label: 'Exit' },
            ]);
        } catch (error) {
            if (error instanceof CancelledError || error instanceof InteractiveRequiredError) return;
            throw error;
        }

        if (choice === '__exit') {
            log(`\n${colors.dim}Done. Run ${colors.reset}${colors.cyan}search-console-mcp setup${colors.reset}${colors.dim} anytime to add more platforms.${colors.reset}`);
            return;
        }

        if (choice === '__diagnostics') {
            const { runDiagnostics } = await import('../common/diagnostics.js');
            const { renderDiagnostics } = await import('./shared.js');
            try {
                const results = await runDiagnostics();
                renderDiagnostics(results);
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
