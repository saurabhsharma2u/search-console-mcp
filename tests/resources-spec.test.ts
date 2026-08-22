import { describe, it, expect, vi } from "vitest";
import { registerMcpResources } from "../src/resources/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

describe("Native MCP Resources (MCP 2026-07-28 Spec)", () => {
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
});
