import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { resolveBearerToken } from './registry.js';
import { isTenantRequired } from './context.js';
import { sanitizeForLog } from '../utils/redaction.js';

type ServerFactory = () => McpServer;

interface SessionTransport {
    server: McpServer;
    transport: StreamableHTTPServerTransport;
    lastSeenAt: number;
    activeRequests: number;
}

export async function startHttpServer(serverOrFactory: McpServer | ServerFactory) {
    const host = process.env.MCP_BIND_HOST || '127.0.0.1';
    const port = Number(process.env.MCP_PORT || '3001');
    validateBindHost(host);
    const createServerInstance: ServerFactory = typeof serverOrFactory === 'function'
        ? serverOrFactory
        : () => serverOrFactory;
    const sessions = new Map<string, SessionTransport>();
    const sessionTtlMs = getSessionTtlMs();

    const httpServer = createServer(async (req, res) => {
        if (!req.url?.startsWith('/mcp')) {
            sendJson(res, 404, { error: 'Not found' });
            return;
        }

        try {
            await cleanupExpiredSessions(sessions, sessionTtlMs);
            const auth = authenticateRequest(req);
            if (auth) {
                (req as IncomingMessage & { auth?: AuthInfo }).auth = auth;
            }

            const body = await readJsonBody(req);
            const sessionId = getHeader(req, 'mcp-session-id');
            let session = sessionId ? sessions.get(sessionId) : undefined;

            if (!session) {
                if (sessionId || !isInitializeBody(body)) {
                    sendJson(res, 400, {
                        jsonrpc: '2.0',
                        error: {
                            code: -32000,
                            message: 'Bad Request: No valid session ID provided'
                        },
                        id: null
                    });
                    return;
                }

                const server = createServerInstance();
                const transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: () => randomUUID(),
                    enableJsonResponse: true,
                    onsessioninitialized: id => {
                        sessions.set(id, { server, transport, lastSeenAt: Date.now(), activeRequests: 0 });
                    }
                });
                transport.onclose = () => {
                    if (transport.sessionId) sessions.delete(transport.sessionId);
                };
                await server.connect(transport);
                session = { server, transport, lastSeenAt: Date.now(), activeRequests: 0 };
            }

            const transport = session.transport;
            session.lastSeenAt = Date.now();
            session.activeRequests += 1;
            try {
                await transport.handleRequest(req as IncomingMessage & { auth?: AuthInfo }, res, body);
            } finally {
                session.activeRequests = Math.max(0, session.activeRequests - 1);
                session.lastSeenAt = Date.now();
                if (transport.sessionId) {
                    const stored = sessions.get(transport.sessionId);
                    if (stored) {
                        stored.lastSeenAt = session.lastSeenAt;
                        stored.activeRequests = session.activeRequests;
                    }
                }
            }
        } catch (error) {
            const status = (error as any).status || 500;
            sendJson(res, status, {
                jsonrpc: '2.0',
                error: {
                    code: status === 401 ? -32001 : status === 403 ? -32003 : -32603,
                    message: sanitizeForLog((error as Error).message || 'Internal server error')
                },
                id: null
            });
        }
    });

    await new Promise<void>((resolve) => httpServer.listen(port, host, resolve));
    console.error(`Search Console MCP Streamable HTTP listening on http://${host}:${port}/mcp`);
    return httpServer;
}

async function cleanupExpiredSessions(sessions: Map<string, SessionTransport>, sessionTtlMs: number) {
    const now = Date.now();
    for (const [id, session] of sessions) {
        if (session.activeRequests > 0) continue;
        if (now - session.lastSeenAt <= sessionTtlMs) continue;
        sessions.delete(id);
        try {
            await session.transport.close();
        } catch {
            // Best-effort cleanup; a failed close should not break unrelated requests.
        }
    }
}

function getSessionTtlMs() {
    const fallback = 30 * 60 * 1000;
    const configured = Number(process.env.MCP_HTTP_SESSION_TTL_MS || fallback);
    return Number.isFinite(configured) && configured > 0 ? configured : fallback;
}

function getHeader(req: IncomingMessage, name: string): string | undefined {
    const value = req.headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
}

function isInitializeBody(body: unknown): boolean {
    return !!body && typeof body === 'object' && (body as any).method === 'initialize';
}

function authenticateRequest(req: IncomingMessage): AuthInfo | undefined {
    const header = req.headers.authorization;
    if (!header) {
        if (isTenantRequired()) {
            const err = new Error('Missing Authorization bearer token') as any;
            err.status = 401;
            throw err;
        }
        return undefined;
    }

    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) {
        const err = new Error('Invalid Authorization header') as any;
        err.status = 401;
        throw err;
    }

    const { token, tenant } = resolveBearerToken(match[1]);
    return {
        token: token.token_id,
        clientId: tenant.tenantId,
        scopes: tenant.allowedTools,
        extra: { tenantContext: tenant, tokenId: token.token_id }
    };
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
    if (req.method === 'GET' || req.method === 'DELETE') return undefined;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw) return undefined;
    return JSON.parse(raw);
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
    if (res.headersSent) return;
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
}

function validateBindHost(host: string) {
    const production = process.env.MCP_PRODUCTION_MODE === 'true';
    if (!production) return;

    const allowedPublic = process.env.MCP_ALLOW_PUBLIC_BIND === 'true';
    if ((host === '0.0.0.0' || host === '::') && !allowedPublic) {
        throw new Error('Refusing public bind host in production without MCP_ALLOW_PUBLIC_BIND=true');
    }
}
