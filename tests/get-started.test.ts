import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getStartedHandler } from '../src/common/tools/get-started.js';
import * as fs from 'fs';
import * as os from 'os';

vi.mock('fs');
vi.mock('os', () => ({ homedir: vi.fn(() => '/tmp') }));

describe('get_started tool', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    // Default mocks
    (fs.existsSync as any).mockReturnValue(false);
    (os.homedir as any).mockReturnValue('/tmp');
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it('should include Google tools when Google is enabled via env', async () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = 'fake-path.json';
    delete process.env.BING_API_KEY;

    const result = await getStartedHandler();
    const content = JSON.parse(result.content[0].text);

    expect(content.active_platforms).toHaveProperty('google');
    expect(content.active_platforms).not.toHaveProperty('bing');

    const intentGroups = content.intent_groups;
    const trafficGroup = intentGroups.find((g: any) => g.name === 'Diagnose Traffic Problems');
    expect(trafficGroup).toBeDefined();
    expect(trafficGroup.tools.some((t: any) => t.name === 'analytics_anomalies')).toBe(true);
    expect(trafficGroup.tools.some((t: any) => t.name === 'bing_analytics_detect_anomalies')).toBe(false);
  });

  it('should include Bing tools when Bing is enabled via env', async () => {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_CLIENT_EMAIL;
    delete process.env.GOOGLE_PRIVATE_KEY;
    process.env.BING_API_KEY = 'fake-key';

    const result = await getStartedHandler();
    const content = JSON.parse(result.content[0].text);

    expect(content.active_platforms).toHaveProperty('bing');
    expect(content.active_platforms).not.toHaveProperty('google');

    const intentGroups = content.intent_groups;
    const trafficGroup = intentGroups.find((g: any) => g.name === 'Diagnose Traffic Problems');
    expect(trafficGroup.tools.some((t: any) => t.name === 'bing_analytics_detect_anomalies')).toBe(true);
    expect(trafficGroup.tools.some((t: any) => t.name === 'analytics_anomalies')).toBe(false);
  });

  it('should include both when both are enabled', async () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = 'fake-path.json';
    process.env.BING_API_KEY = 'fake-key';

    const result = await getStartedHandler();
    const content = JSON.parse(result.content[0].text);

    expect(content.active_platforms).toHaveProperty('google');
    expect(content.active_platforms).toHaveProperty('bing');

    const intentGroups = content.intent_groups;
    const trafficGroup = intentGroups.find((g: any) => g.name === 'Diagnose Traffic Problems');
    expect(trafficGroup.tools.some((t: any) => t.name === 'analytics_anomalies')).toBe(true);
    expect(trafficGroup.tools.some((t: any) => t.name === 'bing_analytics_detect_anomalies')).toBe(true);
  });

  it('should show accounts_list for Bing-only users', async () => {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_CLIENT_EMAIL;
    delete process.env.GOOGLE_PRIVATE_KEY;
    process.env.BING_API_KEY = 'fake-key';

    const result = await getStartedHandler();
    const content = JSON.parse(result.content[0].text);

    const accountGroup = content.intent_groups.find((g: any) => g.name === 'Account Management');
    expect(accountGroup).toBeDefined();
    expect(accountGroup.tools.some((t: any) => t.name === 'accounts_list')).toBe(true);
  });

  it('should handle neither-platform-enabled scenario', async () => {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_CLIENT_EMAIL;
    delete process.env.GOOGLE_PRIVATE_KEY;
    delete process.env.BING_API_KEY;

    const result = await getStartedHandler();
    const content = JSON.parse(result.content[0].text);

    expect(content.active_platforms).toEqual({});
    // Should still have a server summary and basic structure
    expect(content.server_summary).toBeDefined();
    expect(content.recommended_starting_points).toBeDefined();
  });
});
