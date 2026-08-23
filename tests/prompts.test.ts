import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerPrompts } from '../src/prompts/index.js';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as fs from 'fs';
import * as os from 'os';

vi.mock('fs');
vi.mock('os', () => ({ homedir: vi.fn(() => '/tmp') }));

describe('Prompts registration', () => {
  const originalEnv = process.env;
  let mockServer: any;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    vi.clearAllMocks();
    (fs.existsSync as any).mockReturnValue(false);
    (os.homedir as any).mockReturnValue('/tmp');

    mockServer = {
      prompt: vi.fn(),
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should register all 14 prompts', async () => {
    registerPrompts(mockServer as McpServer);
    const calls = mockServer.prompt.mock.calls;
    const registeredNames = calls.map((c: any) => c[0]);

    expect(registeredNames).toContain('investigate_traffic_drop');
    expect(registeredNames).toContain('find_quick_wins');
    expect(registeredNames).toContain('full_site_audit');
    expect(registeredNames).toContain('analyze_page');
    expect(registeredNames).toContain('platform_comparison');
    expect(registeredNames).toContain('content_opportunity_report');
    expect(registeredNames).toContain('executive_summary');
    expect(registeredNames).toContain('ga4_traffic_audit');
    expect(registeredNames).toContain('adsense_earnings_review');
    expect(registeredNames).toContain('adsense_monetization_audit');
    expect(registeredNames).toContain('seo_traffic_detective');
    expect(registeredNames).toContain('seo_striking_distance');
    expect(registeredNames).toContain('seo_cannibalization_audit');
    expect(registeredNames).toContain('seo_compare_google_bing');
    expect(registeredNames).toHaveLength(14);
  });

  it('should generate Google-specific workflow when Google is enabled', async () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = 'fake-path.json';
    delete process.env.BING_API_KEY;

    registerPrompts(mockServer as McpServer);

    // Check investigate_traffic_drop
    const dropPrompt = mockServer.prompt.mock.calls.find((c: any) => c[0] === 'investigate_traffic_drop');
    const dropHandler = dropPrompt[2];
    const dropResult = await dropHandler({ site_url: 'http://example.com' });
    const dropText = dropResult.messages[0].content.text;
    expect(dropText).toContain("analytics_anomalies");
    expect(dropText).not.toContain("bing_analytics_detect_anomalies");

    // Check full_site_audit
    const auditPrompt = mockServer.prompt.mock.calls.find((c: any) => c[0] === 'full_site_audit');
    const auditHandler = auditPrompt[2];
    const auditResult = await auditHandler({ site_url: 'http://example.com' });
    const auditText = auditResult.messages[0].content.text;
    expect(auditText).toContain("sites_list");
    expect(auditText).not.toContain("bing_sites_health");
  });

  it('should generate Bing-specific workflow with numbered steps when Bing is enabled', async () => {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_CLIENT_EMAIL;
    delete process.env.GOOGLE_PRIVATE_KEY;
    process.env.BING_API_KEY = 'fake-key';

    registerPrompts(mockServer as McpServer);

    // Check investigate_traffic_drop — Bing should get numbered steps, not "For Bing:" prefix
    const dropPrompt = mockServer.prompt.mock.calls.find((c: any) => c[0] === 'investigate_traffic_drop');
    const dropHandler = dropPrompt[2];
    const dropResult = await dropHandler({ site_url: 'http://example.com' });
    const dropText = dropResult.messages[0].content.text;
    expect(dropText).toContain("bing_analytics_detect_anomalies");
    expect(dropText).toContain("1.");  // Should have numbered steps
    expect(dropText).not.toContain("analytics_anomalies");
    expect(dropText).not.toContain("For Bing:");  // No second-class prefix

    // Check full_site_audit
    const auditPrompt = mockServer.prompt.mock.calls.find((c: any) => c[0] === 'full_site_audit');
    const auditHandler = auditPrompt[2];
    const auditResult = await auditHandler({ site_url: 'http://example.com' });
    const auditText = auditResult.messages[0].content.text;
    expect(auditText).toContain("bing_sites_health");
    expect(auditText).toContain("1.");
    expect(auditText).not.toContain("sites_list");
    expect(auditText).not.toContain("For Bing:");
  });

  it('should evaluate platform detection at call time (not registration time)', async () => {
    // Register with no platforms enabled
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_CLIENT_EMAIL;
    delete process.env.GOOGLE_PRIVATE_KEY;
    delete process.env.BING_API_KEY;

    registerPrompts(mockServer as McpServer);

    const dropPrompt = mockServer.prompt.mock.calls.find((c: any) => c[0] === 'investigate_traffic_drop');
    const dropHandler = dropPrompt[2];

    // Call with no platforms — should have no tool steps
    const result1 = await dropHandler({ site_url: 'http://example.com' });
    expect(result1.messages[0].content.text).not.toContain("analytics_anomalies");
    expect(result1.messages[0].content.text).not.toContain("bing_analytics_detect_anomalies");

    // Now enable Google and call again — should pick up the change
    process.env.GOOGLE_APPLICATION_CREDENTIALS = 'fake-path.json';
    const result2 = await dropHandler({ site_url: 'http://example.com' });
    expect(result2.messages[0].content.text).toContain("analytics_anomalies");
  });

  it('should produce sequential step numbers even with optional parameters', async () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = 'fake-path.json';
    delete process.env.BING_API_KEY;

    registerPrompts(mockServer as McpServer);

    // full_site_audit WITHOUT brand_terms — steps should be sequential
    const auditPrompt = mockServer.prompt.mock.calls.find((c: any) => c[0] === 'full_site_audit');
    const auditHandler = auditPrompt[2];
    const result = await auditHandler({ site_url: 'http://example.com' });
    const text = result.messages[0].content.text;

    // Extract step numbers
    const stepNumbers = [...text.matchAll(/^(\d+)\./gm)].map(m => parseInt(m[1]));
    // Verify sequential numbering
    for (let i = 1; i < stepNumbers.length; i++) {
      expect(stepNumbers[i]).toBe(stepNumbers[i - 1] + 1);
    }
  });

  it('should include date_range in content_opportunity_report prompt text', async () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = 'fake-path.json';

    registerPrompts(mockServer as McpServer);

    const prompt = mockServer.prompt.mock.calls.find((c: any) => c[0] === 'content_opportunity_report');
    const handler = prompt[2];
    const result = await handler({ site_url: 'http://example.com', date_range: 'last 60 days' });
    expect(result.messages[0].content.text).toContain('last 60 days');
  });

  it('should include compare_to in executive_summary prompt text', async () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = 'fake-path.json';

    registerPrompts(mockServer as McpServer);

    const prompt = mockServer.prompt.mock.calls.find((c: any) => c[0] === 'executive_summary');
    const handler = prompt[2];
    const result = await handler({ site_url: 'http://example.com', compare_to: 'last quarter' });
    expect(result.messages[0].content.text).toContain('last quarter');
  });

  it('should sanitize brand_terms to prevent regex injection', async () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = 'fake-path.json';

    registerPrompts(mockServer as McpServer);

    const prompt = mockServer.prompt.mock.calls.find((c: any) => c[0] === 'full_site_audit');
    const handler = prompt[2];
    const result = await handler({ site_url: 'http://example.com', brand_terms: 'nike),evil(,air max' });
    const text = result.messages[0].content.text;
    // Should not contain raw parentheses from user input
    expect(text).not.toContain('),evil(');
    expect(text).toContain('nike');
    expect(text).toContain('air max');
  });

  it('should handle neither-platform-enabled scenario gracefully', async () => {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_CLIENT_EMAIL;
    delete process.env.GOOGLE_PRIVATE_KEY;
    delete process.env.BING_API_KEY;

    registerPrompts(mockServer as McpServer);

    // investigate_traffic_drop should still produce a synthesis step
    const dropPrompt = mockServer.prompt.mock.calls.find((c: any) => c[0] === 'investigate_traffic_drop');
    const dropHandler = dropPrompt[2];
    const result = await dropHandler({});
    expect(result.messages[0].content.text).toContain('Synthesize');
    expect(result.messages[0].content.text).toContain('the active site');
  });

  it('should generate GA4 traffic audit steps', async () => {
    registerPrompts(mockServer as McpServer);

    const ga4Prompt = mockServer.prompt.mock.calls.find((c: any) => c[0] === 'ga4_traffic_audit');
    const ga4Handler = ga4Prompt[2];
    const result = await ga4Handler({ property_id: '458548565', date_range: 'last 30 days' });
    const text = result.messages[0].content.text;

    expect(text).toContain("analytics_traffic_sources");
    expect(text).toContain("analytics_organic_landing_pages");
    expect(text).toContain("analytics_conversion_funnel");
    expect(text).toContain("analytics_user_behavior");
    expect(text).toContain("458548565");
    expect(text).toContain("last 30 days");
  });
});
