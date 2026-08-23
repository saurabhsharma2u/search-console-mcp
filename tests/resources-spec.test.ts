import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerMcpResources } from "../src/resources/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const { mockLoadConfig, mockGetAdsenseClient } = vi.hoisted(() => ({
  mockLoadConfig: vi.fn(),
  mockGetAdsenseClient: vi.fn(),
}));

vi.mock("../src/common/auth/config.js", () => ({
  loadConfig: mockLoadConfig,
}));

vi.mock("../src/adsense/client.js", () => ({
  getAdsenseClient: mockGetAdsenseClient,
}));

describe("Native MCP Resources (MCP 2026-07-28 Spec)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockResolvedValue({ accounts: {} });
  });
  it("registers all 3 native MCP Resources on McpServer", () => {
    const mockServer = {
      resource: vi.fn(),
    };

    registerMcpResources(mockServer as unknown as McpServer);

    const calls = mockServer.resource.mock.calls;
    const registeredNames = calls.map((c: any) => c[0]);
    const registeredUris = calls.map((c: any) => c[1]);

    expect(registeredNames).toContain("google-algorithm-updates");
    expect(registeredNames).toContain("connected-sites");
    expect(registeredNames).toContain("adsense-accounts");
    expect(registeredNames).toContain("adsense-payments");
    expect(registeredNames).toContain("backward-compatibility-map");

    expect(registeredUris).toContain("seo://algorithm-updates");
    expect(registeredUris).toContain("seo://connected-sites");
    expect(registeredUris).toContain("seo://adsense/accounts");
    expect(registeredUris).toContain("seo://adsense/payments");
    expect(registeredUris).toContain("seo://backward-compatibility");
  });

  it("reads google-algorithm-updates resource contents correctly", async () => {
    const mockServer = {
      resource: vi.fn(),
    };

    registerMcpResources(mockServer as unknown as McpServer);

    const call = mockServer.resource.mock.calls.find((c: any) => c[0] === "google-algorithm-updates");
    expect(call).toBeDefined();

    const handler = call![3];
    const result = await handler(new URL("seo://algorithm-updates"));

    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].mimeType).toBe("application/json");

    const updates = JSON.parse(result.contents[0].text);
    expect(Array.isArray(updates)).toBe(true);
    expect(updates.length).toBeGreaterThan(0);
    expect(updates[0]).toHaveProperty("date");
    expect(updates[0]).toHaveProperty("name");
  });

  it("reads connected-sites resource contents correctly", async () => {
    const mockServer = {
      resource: vi.fn(),
    };

    registerMcpResources(mockServer as unknown as McpServer);

    const call = mockServer.resource.mock.calls.find((c: any) => c[0] === "connected-sites");
    expect(call).toBeDefined();

    const handler = call![3];
    const result = await handler(new URL("seo://connected-sites"));

    expect(result.contents[0].mimeType).toBe("application/json");
    const data = JSON.parse(result.contents[0].text);
    expect(data).toHaveProperty("count");
    expect(data).toHaveProperty("accounts");
  });

  it("reads backward-compatibility-map resource contents correctly", async () => {
    const mockServer = {
      resource: vi.fn(),
    };

    registerMcpResources(mockServer as unknown as McpServer);

    const call = mockServer.resource.mock.calls.find((c: any) => c[0] === "backward-compatibility-map");
    expect(call).toBeDefined();

    const handler = call![3];
    const result = await handler(new URL("seo://backward-compatibility"));

    expect(result.contents[0].mimeType).toBe("text/markdown");
    expect(result.contents[0].text).toContain("Migration Map");
    expect(result.contents[0].text).toContain("sites_list");
  });

  it("reads adsense-payments for every configured account, keyed by account ID", async () => {
    mockLoadConfig.mockResolvedValue({
      accounts: {
        ad1: { id: "ad1", engine: "adsense", alias: "A1", adsenseAccountId: "accounts/pub-1" },
        ad2: { id: "ad2", engine: "adsense", alias: "A2", adsenseAccountId: "accounts/pub-2" },
      },
    });
    mockGetAdsenseClient.mockImplementation(async (id: string) => ({
      listPayments: async () => [{ name: `${id}-payment`, amount: "$1.00" }],
      listAlerts: async () => (id === "ad1" ? [{ name: "alert-1", severity: "SEVERE" }] : []),
    }));

    const mockServer = { resource: vi.fn() };
    registerMcpResources(mockServer as unknown as McpServer);
    const call = mockServer.resource.mock.calls.find((c: any) => c[0] === "adsense-payments");
    expect(call).toBeDefined();

    const result = await call![3](new URL("seo://adsense/payments"));
    const payload = JSON.parse(result.contents[0].text);

    expect(payload.ad1).toEqual({ payments: [{ name: "ad1-payment", amount: "$1.00" }], alerts: [{ name: "alert-1", severity: "SEVERE" }] });
    expect(payload.ad2).toEqual({ payments: [{ name: "ad2-payment", amount: "$1.00" }], alerts: [] });
    expect(mockGetAdsenseClient).toHaveBeenCalledWith("ad1");
    expect(mockGetAdsenseClient).toHaveBeenCalledWith("ad2");
  });

  it("returns an error payload for adsense-payments when no accounts are configured", async () => {
    const mockServer = { resource: vi.fn() };
    registerMcpResources(mockServer as unknown as McpServer);
    const call = mockServer.resource.mock.calls.find((c: any) => c[0] === "adsense-payments");

    const result = await call![3](new URL("seo://adsense/payments"));
    const payload = JSON.parse(result.contents[0].text);

    expect(payload.error).toMatch(/No AdSense accounts configured/);
  });
});
