import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { startSseServer } from "../src/transport/http.js";
import http from "http";

const TOKEN = "test-bearer-token-123";
const AUTH_HEADERS = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

function makeServer() {
  return new McpServer({
    name: "test-sse-server",
    version: "1.0.0",
  });
}

async function getHeaders(url: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve) => {
    http.get(url, { headers }, (res) => resolve({ status: res.statusCode || 500, headers: res.headers }));
  });
}

describe("Remote Stateless HTTP/SSE Transport Adaptor (MCP 2026-07-28 Spec)", () => {
  it("starts HTTP/SSE server and responds to /health check", async () => {
    const server = makeServer();

    const instance = await startSseServer(server, { port: 3456, token: TOKEN, host: "127.0.0.1" });

    const healthRes = await new Promise<{ status: number; body: any }>((resolve) => {
      http.get("http://localhost:3456/health", (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => resolve({ status: res.statusCode || 500, body: JSON.parse(raw) }));
      });
    });

    expect(healthRes.status).toBe(200);
    expect(healthRes.body.status).toBe("ok");
    expect(healthRes.body).toHaveProperty("activeConnections");

    instance.close();
  });

  it("handles GET /sse connection and POST /messages with valid sessionId (with bearer token)", async () => {
    const server = makeServer();

    const instance = await startSseServer(server, { port: 3460, token: TOKEN, host: "127.0.0.1" });

    let sseReq: http.ClientRequest;
    const sessionId = await new Promise<string>((resolve) => {
      sseReq = http.get("http://localhost:3460/sse", { headers: { Authorization: `Bearer ${TOKEN}` } }, (res) => {
        res.on("data", (chunk) => {
          const str = chunk.toString();
          if (str.includes("event: endpoint")) {
            const match = str.match(/sessionId=([a-f0-9-]+)/);
            if (match) {
              resolve(match[1]);
            }
          }
        });
      });
    });

    expect(sessionId).toBeDefined();

    // POST message to active sessionId
    const postResStatus = await new Promise<number>((resolve) => {
      const postReq = http.request(
        `http://localhost:3460/messages?sessionId=${sessionId}`,
        { method: "POST", headers: AUTH_HEADERS },
        (res) => resolve(res.statusCode || 500)
      );
      postReq.write(JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }));
      postReq.end();
    });

    expect(postResStatus).toBe(202);

    sseReq!.destroy();
    instance.close();
  });

  it("handles OPTIONS preflight request with 204 No Content", async () => {
    const server = makeServer();

    const instance = await startSseServer(server, { port: 3458, token: TOKEN, host: "127.0.0.1" });

    const res = await new Promise<{ status: number }>((resolve) => {
      const req = http.request(
        "http://localhost:3458/sse",
        { method: "OPTIONS" },
        (res) => resolve({ status: res.statusCode || 500 })
      );
      req.end();
    });

    expect(res.status).toBe(204);
    instance.close();
  });

  it("returns 400 Bad Request for POST /messages with missing or invalid sessionId", async () => {
    const server = makeServer();

    const instance = await startSseServer(server, { port: 3459, token: TOKEN, host: "127.0.0.1" });

    const res = await new Promise<{ status: number; body: any }>((resolve) => {
      const req = http.request(
        "http://localhost:3459/messages?sessionId=invalid_123",
        { method: "POST", headers: AUTH_HEADERS },
        (res) => {
          let raw = "";
          res.on("data", (chunk) => (raw += chunk));
          res.on("end", () => resolve({ status: res.statusCode || 500, body: JSON.parse(raw) }));
        }
      );
      req.write(JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }));
      req.end();
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Invalid or expired SSE sessionId");
    instance.close();
  });

  it("returns 404 for unknown endpoints", async () => {
    const server = makeServer();

    const instance = await startSseServer(server, { port: 3457, token: TOKEN, host: "127.0.0.1" });

    const res = await new Promise<{ status: number }>((resolve) => {
      http.get("http://localhost:3457/unknown-path", (res) => {
        resolve({ status: res.statusCode || 500 });
      });
    });

    expect(res.status).toBe(404);
    instance.close();
  });
});

describe("SSE server security hardening (issue #114)", () => {
  it("rejects GET /sse without a bearer token (401)", async () => {
    const server = makeServer();
    const instance = await startSseServer(server, { port: 3461, token: TOKEN, host: "127.0.0.1" });

    const res = await getHeaders("http://localhost:3461/sse");
    expect(res.status).toBe(401);

    instance.close();
  });

  it("rejects GET /sse with a wrong bearer token (401)", async () => {
    const server = makeServer();
    const instance = await startSseServer(server, { port: 3462, token: TOKEN, host: "127.0.0.1" });

    const res = await getHeaders("http://localhost:3462/sse", { Authorization: "Bearer wrong-token" });
    expect(res.status).toBe(401);

    instance.close();
  });

  it("accepts the token via ?token= query param (EventSource-friendly) and rejects POST /messages without token", async () => {
    const server = makeServer();
    const instance = await startSseServer(server, { port: 3463, token: TOKEN, host: "127.0.0.1" });

    let sseReq: http.ClientRequest | undefined;
    try {
      const sessionId = await new Promise<string>((resolve) => {
        sseReq = http.get("http://localhost:3463/sse?token=" + TOKEN, (res) => {
          res.on("data", (chunk) => {
            const str = chunk.toString();
            const match = str.match(/sessionId=([a-f0-9-]+)/);
            if (match) resolve(match[1]);
          });
        });
      });
      expect(sessionId).toBeDefined();

      // POST without token -> 401 even with a valid sessionId
      const postStatus = await new Promise<number>((resolve) => {
        const postReq = http.request(
          `http://localhost:3463/messages?sessionId=${sessionId}`,
          { method: "POST", headers: { "Content-Type": "application/json" } },
          (res) => resolve(res.statusCode || 500)
        );
        postReq.write(JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }));
        postReq.end();
      });
      expect(postStatus).toBe(401);
    } finally {
      sseReq?.destroy();
      instance.close();
    }
  }, 15000);

  it("never sends Access-Control-Allow-Origin: * and only echoes allow-listed origins", async () => {
    const server = makeServer();
    const instance = await startSseServer(server, { port: 3464, token: TOKEN, host: "127.0.0.1" });

    // Disallowed origin -> no ACAO header at all
    const evil = await getHeaders("http://localhost:3464/health", { Origin: "https://evil.example" });
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();

    // Allowed origin -> echoed, not "*"
    const ok = await getHeaders("http://localhost:3464/health", { Origin: `http://localhost:3464` });
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:3464");

    instance.close();
  });

  it("rejects non-loopback Host headers (DNS-rebinding guard) with 421", async () => {
    const server = makeServer();
    const instance = await startSseServer(server, { port: 3465, token: TOKEN, host: "127.0.0.1" });

    const res = await getHeaders("http://localhost:3465/health", { Host: "evil.example" });
    expect(res.status).toBe(421);

    instance.close();
  });

  it("accepts a bracketed IPv6 loopback Host header ([::1]:port)", async () => {
    const server = makeServer();
    const instance = await startSseServer(server, { port: 3467, token: TOKEN, host: "127.0.0.1" });

    // A bracketed IPv6 Host must not be truncated to "[" by a naive ":" split.
    const res = await getHeaders("http://127.0.0.1:3467/health", { Host: "[::1]:3467" });
    expect(res.status).toBe(200);

    instance.close();
  });

  it("responds 503 instead of hanging when the single SSE session is already taken", async () => {
    const server = makeServer();
    const instance = await startSseServer(server, { port: 3470, token: TOKEN, host: "127.0.0.1" });

    // Occupy the single-session transport (server.connect is one-shot here).
    const first = http.get(
      "http://localhost:3470/sse",
      { headers: { Authorization: `Bearer ${TOKEN}` } },
      () => undefined
    );
    first.on("error", () => undefined);
    // Give the first connect a beat to settle before the second client arrives.
    await new Promise((resolve) => setTimeout(resolve, 150));

    const second = await getHeaders("http://localhost:3470/sse", { Authorization: `Bearer ${TOKEN}` });
    expect(second.status).toBe(503);

    first.destroy();
    instance.close();
  });

  it("binds to 127.0.0.1 by default, not all interfaces", async () => {
    const server = makeServer();
    const instance = await startSseServer(server, { port: 3466, token: TOKEN });

    const address = instance.httpServer.address();
    expect(address && typeof address === "object" ? address.address : null).toBe("127.0.0.1");

    instance.close();
  });
});
