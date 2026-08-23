import { existsSync, readFileSync, writeFileSync, chmodSync } from 'fs';
import { resolve } from 'path';
import { prompts } from '../../utils/prompts.js';
import { colors } from '../../utils/ui.js';
import { log, printSuccess } from '../shared.js';

export async function configurePageSpeed() {
    log('\nThis key is optional, but raises daily quota from ~100 to 25,000 queries/day.');
    log('1. Go to https://console.cloud.google.com/apis/credentials');
    log('2. Create an API key and enable the "PageSpeed Insights API" in your project.\n');

    const apiKey = await prompts.text('Enter your PageSpeed API Key (leave empty to skip):', { defaultValue: '' });

    if (!apiKey) {
        log('PageSpeed setup skipped or cleared.');
        return;
    }

    const envPath = resolve('.env');
    let envContent = '';
    // Anchor to line start so variables like MY_PAGESPEED_API_KEY aren't matched
    const keyLine = /^PAGESPEED_API_KEY=.*$/m;

    if (existsSync(envPath)) {
        envContent = readFileSync(envPath, 'utf8');
        if (keyLine.test(envContent)) {
            envContent = envContent.replace(keyLine, `PAGESPEED_API_KEY=${apiKey}`);
        } else {
            envContent += `\nPAGESPEED_API_KEY=${apiKey}\n`;
        }
    } else {
        const examplePath = resolve('.env.example');
        if (existsSync(examplePath)) {
            envContent = readFileSync(examplePath, 'utf8');
            if (keyLine.test(envContent)) {
                envContent = envContent.replace(keyLine, `PAGESPEED_API_KEY=${apiKey}`);
            } else {
                envContent += `\nPAGESPEED_API_KEY=${apiKey}\n`;
            }
        } else {
            envContent = `PAGESPEED_API_KEY=${apiKey}\n`;
        }
    }

    writeFileSync(envPath, envContent, { encoding: 'utf8', mode: 0o600 });
    chmodSync(envPath, 0o600);
    printSuccess('Successfully wrote PAGESPEED_API_KEY to .env file!');

    log(`\n${colors.bold}Note for MCP Client integration:${colors.reset}`);
    log('If you run this server via an MCP Client (like Cursor, Claude Desktop, VS Code),');
    log("you must configure the environment variables in your client's config file.");
    log(`See the documentation for more details:`);
    log(`${colors.cyan}https://github.com/saurabhsharma2u/search-console-mcp#pagespeed-insights-optional-api-key${colors.reset}\n`);

    // Force reloading of env vars for current process
    process.env.PAGESPEED_API_KEY = apiKey;
}
