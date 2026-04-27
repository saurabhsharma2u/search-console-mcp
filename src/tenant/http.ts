import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { resolveBearerToken } from './registry.js';
import { isTenantRequired } from './context.js';
import { sanitizeForLog } from '../utils/redaction.js';

export async function startHttpServer(server: McpServer) {
    const host = process.env.MCP_BIND_HOST || '127.0.0.1';
    const port = Number(process.env.MCP_PORT || '3001');
    validateBindHost(host);

    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true
    });
    await server.connect(transport);

    const httpServer = createServer(async (req, res) => {
        if (!req.url?.startsWith('/mcp')) {
            sendJson(res, 404, { error: 'Not found' });
            return;
        }

        try {
            const auth = authenticateRequest(req);
            if (auth) {
                (req as IncomingMessage & { auth?: AuthInfo }).auth = auth;
            }

            const body = await readJsonBody(req);
            await transport.handleRequest(req as IncomingMessage & { auth?: AuthInfo }, res, body);
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
