import { createServer, IncomingMessage, ServerResponse } from "http";
import { createHash, timingSafeEqual } from "crypto";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { logger } from "../utils/logger.js";

export interface SseServerOptions {
  /** Port to listen on. */
  port?: number;
  /** Host/interface to bind. Defaults to 127.0.0.1 (loopback only). */
  host?: string;
  /** Bearer token required by /sse and /messages. Omitting it in SSE mode is rejected by the caller. */
  token?: string;
  /** Origins allowed to make cross-origin browser requests. Defaults to localhost origins on the listening port. */
  allowedOrigins?: string[];
}

/**
 * Verifies a bearer token against the expected token using a
 * length-independent, timing-safe comparison.
 */
function tokenMatches(provided: string, expected: string): boolean {
  // Hash both sides to a fixed length so the comparison never short-circuits
  // early and never throws on length mismatch.
  return timingSafeEqual(fixedDigest(provided), fixedDigest(expected));
}

function fixedDigest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/**
 * Returns true when the request's Host header is a loopback name and cannot
 * be a DNS-rebinding/forged target.
 */
function isLocalHostHeader(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  const host = hostHeader.split(":")[0].toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

/**
 * Determines whether a browser cross-origin request should be allowed.
 * Origins are only echoed back when explicitly permitted; wildcard CORS is
 * never sent.
 */
function allowedOrigin(origin: string | undefined, allowedOrigins: string[]): string | null {
  if (!origin) return null; // not a cross-origin browser request
  if (allowedOrigins.includes(origin)) return origin;
  return null;
}

/**
 * Starts a remote HTTP/SSE transport server implementing the MCP 2026-07-28 Specification.
 * Security model:
 * - Binds to 127.0.0.1 by default (use `host` to expose other interfaces).
 * - Requires a bearer token on /sse and /messages (Authorization header or ?token= query param
 *   for SSE, because EventSource cannot send headers).
 * - Only echoes CORS origins that are explicitly allow-listed; never `*`.
 * - Rejects requests with a non-loopback Host header when bound to loopback (DNS-rebinding guard).
 */
export function startSseServer(server: McpServer, options: SseServerOptions = {}): Promise<{ close: () => void; httpServer: import("http").Server }> {
  const port = options.port ?? 3000;
  const host = options.host ?? "127.0.0.1";
  const token = options.token ?? "";
  const allowedOrigins = options.allowedOrigins ?? [
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    `https://localhost:${port}`,
  ];
  const loopbackOnly = host === "127.0.0.1" || host === "localhost" || host === "::1";

  const activeTransports = new Map<string, SSEServerTransport>();

  function isAuthorized(req: IncomingMessage, url: URL): boolean {
    if (!token) return false; // no token configured -> deny everything sensitive
    const header = req.headers.authorization;
    const bearer = header?.startsWith("Bearer ") ? header.slice(7).trim() : undefined;
    const query = url.searchParams.get("token") ?? undefined;
    const provided = bearer || query;
    return !!provided && tokenMatches(provided, token);
  }

  function setCors(res: ServerResponse, req: IncomingMessage): void {
    // Only echo explicitly allowed origins; never emit Access-Control-Allow-Origin: *
    const origin = allowedOrigin(req.headers.origin, allowedOrigins);
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Method, Mcp-Name");
      res.setHeader("Access-Control-Max-Age", "600");
    }
  }

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    setCors(res, req);

    const hostHeader = req.headers.host;
    // DNS-rebinding guard: when bound to loopback, refuse forged hosts.
    if (loopbackOnly && !isLocalHostHeader(hostHeader)) {
      res.writeHead(421, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid Host header" }));
      return;
    }

    const url = new URL(req.url || "/", `http://${hostHeader || "localhost"}`);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/sse") {
      if (!isAuthorized(req, url)) {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers["WWW-Authenticate"] = 'Bearer realm="search-console-mcp"';
        res.writeHead(401, headers);
        res.end(JSON.stringify({ error: "Unauthorized: valid bearer token required" }));
        return;
      }

      // Create new SSE transport endpoint
      const transport = new SSEServerTransport("/messages", res);
      const sessionId = transport.sessionId;
      activeTransports.set(sessionId, transport);

      transport.onclose = () => {
        activeTransports.delete(sessionId);
      };

      await server.connect(transport).catch(() => {
        activeTransports.delete(sessionId);
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Server already has an active SSE connection" }));
        return;
      });
      logger.info(`[MCP SSE] Client connected: ${sessionId}`);
      return;
    }

    if (req.method === "POST" && url.pathname === "/messages") {
      if (!isAuthorized(req, url)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized: valid bearer token required" }));
        return;
      }

      const sessionId = url.searchParams.get("sessionId");
      if (!sessionId || !activeTransports.has(sessionId)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid or expired SSE sessionId" }));
        return;
      }

      const transport = activeTransports.get(sessionId)!;
      await transport.handlePostMessage(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      // Keep health non-sensitive and CORS-free.
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", activeConnections: activeTransports.size }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not Found" }));
  });

  return new Promise((resolve) => {
    httpServer.listen(port, host, () => {
      logger.info(`🚀 Search Console MCP SSE Server listening on http://${host}:${port}/sse`);
      resolve({
        close: () => httpServer.close(),
        httpServer,
      });
    });
  });
}
