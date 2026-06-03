import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { isTenantRequired, runWithTenant } from './context.js';
import { unauthorized } from './errors.js';
import { guardToolArguments, tenantSitesList } from './guard.js';
import { TenantContext } from './types.js';

type AnyFunction = (...args: any[]) => any;

export function installTenantGuard(server: McpServer) {
    const anyServer = server as any;
    const originalTool = anyServer.tool.bind(server);
    const originalRegisterTool = anyServer.registerTool.bind(server);
    const originalResource = anyServer.resource.bind(server);

    anyServer.tool = (...args: any[]) => {
        return originalTool(...wrapRegistrationArgs(args));
    };

    anyServer.registerTool = (name: string, config: any, cb: AnyFunction) => {
        return originalRegisterTool(name, config, wrapToolCallback(name, cb));
    };

    anyServer.resource = (...args: any[]) => {
        const callbackIndex = args.findIndex(arg => typeof arg === 'function');
        if (callbackIndex >= 0) {
            const cb = args[callbackIndex];
            args[callbackIndex] = (...cbArgs: any[]) => {
                const extra = cbArgs[cbArgs.length - 1];
                const tenant = getTenantFromExtra(extra);
                if (isTenantRequired() && tenant) {
                    throw unauthorized('Resources are not available in tenant HTTP mode');
                }
                if (isTenantRequired() && !tenant) {
                    throw unauthorized('Missing tenant context');
                }
                return runWithTenant(tenant, () => cb(...cbArgs));
            };
        }
        return originalResource(...args);
    };
}

function wrapRegistrationArgs(args: any[]): any[] {
    const name = args[0];
    const callbackIndex = args.findIndex((arg, index) => index > 0 && typeof arg === 'function');
    if (typeof name === 'string' && callbackIndex >= 0) {
        args[callbackIndex] = wrapToolCallback(name, args[callbackIndex]);
    }
    return args;
}

function wrapToolCallback(toolName: string, cb: AnyFunction): AnyFunction {
    return async (...args: any[]) => {
        const extra = args[args.length - 1];
        const tenant = getTenantFromExtra(extra);

        if (isTenantRequired() && !tenant) {
            throw unauthorized('Missing tenant context');
        }

        if (!tenant) {
            return cb(...args);
        }

        const toolArgs = args.length > 1 ? args[0] : {};
        guardToolArguments(tenant, toolName, toolArgs);

        if (toolName === 'sites_list') {
            const engine = (toolArgs.engine || 'google') as any;
            const results = await tenantSitesList(tenant, engine);
            return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
        }

        return runWithTenant(tenant, () => cb(...args));
    };
}

function getTenantFromExtra(extra: any): TenantContext | undefined {
    return extra?.authInfo?.extra?.tenantContext as TenantContext | undefined;
}
