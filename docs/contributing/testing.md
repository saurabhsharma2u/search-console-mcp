---
title: "Testing"
description: "Ensuring the integrity of our SEO tools."
---

Reliability is the core of this project. Any new tool or logic must be accompanied by tests that verify its deterministic output.

## Test Suite

We use **Vitest** for our unit and integration tests.

### Running Tests
To run the unit and integration tests:

```bash
npm test
```

To run the full suite, including end-to-end tests:

```bash
npm run test:all
```

### End-to-End Tests

The `tests/e2e/` directory contains true end-to-end tests that spawn the **built server binary** (`dist/index.js`) as a child process and speak the MCP protocol to it with a real client — exactly like Claude or Cursor do:

- `stdio.e2e.test.ts` — initialize handshake, `tools/list`, prompts/resources listing, tool calls (`get_started`, unconfigured error paths), schema-validation errors, unknown tools.
- `sse.e2e.test.ts` — boots the server in HTTP/SSE mode (`serve --transport=sse`) and checks `/health` plus session rejection.

The spawned servers run fully isolated (throwaway `HOME`, no `.env`, no credentials), so they are deterministic and never touch real accounts.

```bash
npm run test:e2e   # builds first, then runs the e2e suite
npm run test:all   # unit + e2e
```

CI runs both suites on every pull request.

### Writing a Tool Test
When testing an SEO tool, focus on verifying the math and the filtering logic.

```typescript
import { findStrikingDistance } from '../src/tools/seo-insights';

describe('findStrikingDistance', () => {
  it('should only return keywords in positions 8-15', async () => {
    // Mock GSC data...
    const result = await findStrikingDistance(mockSite, { limit: 10 });
    
    result.forEach(item => {
      expect(item.position).toBeGreaterThanOrEqual(8);
      expect(item.position).toBeLessThanOrEqual(15);
    });
  });
});
```

## Mocking Google Data

We prefer using mock data for standard unit tests to avoid hitting API rate limits during CI/CD. Check `tests/mocks.ts` for existing search performance mocks.

## CI/CD Workflow

Every pull request triggers our GitHub Actions CI, which:
1.  Installs dependencies.
2.  Builds the project.
3.  Runs the test suite.
4.  Generates a coverage report.

Please ensure your changes do not decrease the overall project test coverage.
