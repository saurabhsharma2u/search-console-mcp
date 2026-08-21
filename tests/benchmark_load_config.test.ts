import { describe, it, vi, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock node-machine-id
vi.mock('node-machine-id', () => ({
    machineId: () => Promise.resolve('benchmark-machine-id'),
    default: {
        machineIdSync: () => 'benchmark-machine-id'
    }
}));

// Mock os module
vi.mock('os', async (importOriginal) => {
    const actual = await importOriginal<typeof import('os')>();
    // We can't use fs here easily inside the factory if we import fs outside,
    // but fs is a built-in so we can import it dynamically or just rely on the temp dir logic
    // Actually, let's just hardcode a temp path in the mock or import fs inside.
    const fs = await import('fs');
    const path = await import('path');
    const tempDir = fs.mkdtempSync(path.join(actual.tmpdir(), 'perf-test-'));
    return {
        ...actual,
        homedir: () => tempDir,
    };
});

// Import the module under test AFTER mocking
import { loadConfig, saveConfig, AppConfig } from '../src/common/auth/config';

describe('Performance Benchmark', () => {
    let tempDir: string;

    beforeAll(async () => {
        tempDir = os.homedir();
        // Create a dummy config
        const config: AppConfig = {
            accounts: {
                'bench_1': {
                    id: 'bench_1',
                    engine: 'google',
                    alias: 'Benchmark Account'
                }
            }
        };
        await saveConfig(config);
    });

    afterAll(() => {
        // Cleanup
        try {
          if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
          }
        } catch (e) {
          console.error('Failed to clean up temp dir:', e);
        }
    });

    it('benchmarks loadConfig', async () => {
        const start = performance.now();
        const iterations = 50;

        for (let i = 0; i < iterations; i++) {
            await loadConfig();
        }

        const end = performance.now();
        const duration = end - start;
        const avg = duration / iterations;

        console.log(`\nBenchmark Results:`);
        console.log(`Total time for ${iterations} calls: ${duration.toFixed(2)}ms`);
        console.log(`Average time per call: ${avg.toFixed(2)}ms\n`);
    });
});
