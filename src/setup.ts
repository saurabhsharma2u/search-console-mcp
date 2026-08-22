#!/usr/bin/env node
import 'dotenv/config';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Thin compatibility shim. The implementation lives in src/setup/.
export { main } from './setup/index.js';
export { login, runLogout } from './setup/flows/google.js';
export {
    validateKeyFile,
    testConnection,
    showMcpConfigSnippet,
    resolveRepo,
} from './setup/shared.js';

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
    const { main } = await import('./setup/index.js');
    main().catch((error) => {
        console.error('Setup failed:', error);
        process.exit(1);
    });
}
