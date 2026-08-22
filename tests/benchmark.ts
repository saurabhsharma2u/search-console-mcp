import { performance } from 'perf_hooks';
import type { AppConfig, AccountConfig } from '../src/common/auth/config.js';

// Setup mock config
const config: AppConfig = { accounts: {} };
for (let i = 0; i < 10000; i++) {
    config.accounts[`account_${i}`] = {
        id: `account_${i}`,
        engine: 'google',
        alias: `alias_${i}`
    };
}

const targetAlias = 'alias_9999';

// Baseline
const start1 = performance.now();
let found1;
for (let iter = 0; iter < 1000; iter++) {
    found1 = Object.values(config.accounts).find(a => a.engine === 'google' && a.alias === targetAlias);
}
const end1 = performance.now();
console.log(`Baseline (Object.values.find): ${(end1 - start1).toFixed(2)}ms`);

// Optimization Object.values.find with external helper function
const start3 = performance.now();
function findAccount(accounts: Record<string, AccountConfig>, predicate: (a: AccountConfig) => boolean): AccountConfig | undefined {
    for (const key in accounts) {
        if (predicate(accounts[key])) {
            return accounts[key];
        }
    }
    return undefined;
}

let found3;
for (let iter = 0; iter < 1000; iter++) {
    found3 = findAccount(config.accounts, a => a.engine === 'google' && a.alias === targetAlias);
}
const end3 = performance.now();
console.log(`Optimized (Helper findAccount): ${(end3 - start3).toFixed(2)}ms`);
