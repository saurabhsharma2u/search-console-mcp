/**
 * Shared CLI UI utilities for Search Console MCP
 */

export const colors = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    dim: "\x1b[2m",
    cyan: "\x1b[36m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
};

export function printBoxHeader(subLabel: string, color = colors.blue) {
    const title = "Search Console MCP";
    const totalWidth = 62;
    const content = `${title} | ${subLabel}`;

    // Rough centering; assumes standard string length (emoji width varies by terminal)

    const leftPadStr = " ".repeat(12);
    const rightPadStr = " ".repeat(12);

    console.error(`\n${colors.bold}${color}╭──────────────────────────────────────────────────────────────╮${colors.reset}`);
    console.error(`${colors.bold}${color}│${colors.reset}${leftPadStr}${colors.bold}${colors.cyan}${title}${colors.reset}${colors.dim} | ${colors.reset}${subLabel.includes('Authentication') ? colors.red : colors.magenta}${subLabel}${colors.reset}${rightPadStr}${colors.bold}${color}│${colors.reset}`);
    console.error(`${colors.bold}${color}╰──────────────────────────────────────────────────────────────╯${colors.reset}\n`);
}

export function printStatusLine(label: string, isConnected: boolean) {
    if (isConnected) {
        console.error(`  ${colors.green}✔${colors.reset} ${label} connected`);
    } else {
        console.error(`  ${colors.red}✘${colors.reset} ${label} not connected`);
    }
}

/**
 * stderr message helpers shared by setup flows and standalone CLI commands.
 * Everything goes to stderr — stdout belongs to machine-readable output
 * (MCP stdio / `run` command results).
 */

export function log(text: string) {
    console.error(text);
}

export function printSuccess(text: string) {
    log(`${colors.green}✔${colors.reset} ${text}`);
}

export function printError(text: string) {
    log(`${colors.red}✘${colors.reset} ${colors.bold}${text}${colors.reset}`);
}

export function printInfo(text: string) {
    log(`${colors.blue}ℹ${colors.reset} ${colors.dim}${text}${colors.reset}`);
}
