import { z } from "zod";
import { jsonToCsv } from "../common/utils/csv.js";

export interface ToolDefinition {
  name: string;
  description: string;
  schemaShape: Record<string, z.ZodTypeAny>;
  schema: z.ZodObject<any>;
  handler: (args: any) => Promise<any>;
}

export const toolsRegistry = new Map<string, ToolDefinition>();

export type McpToolRegistrar = (
  name: string,
  description: string,
  schemaShape: Record<string, z.ZodTypeAny>,
  handler: (args: any) => Promise<any>
) => void;

export function createToolRegistrar(server: { tool: McpToolRegistrar }, currentVersion = "1.0.0"): McpToolRegistrar {
  return (name, description, schemaShape, handler) => {
    const wrappedHandler = async (args: any) => {
      const res = await handler(args);
      if (!isCliRun() && res && Array.isArray(res.content)) {
        try {
          const { getAgentUpdateNotice } = await import("./update.js");
          const notice = await getAgentUpdateNotice(currentVersion);
          if (notice) {
            const textItem = res.content.find((item: any) => item?.type === "text");
            if (textItem && typeof textItem.text === "string") {
              textItem.text += notice;
            } else {
              res.content.push({ type: "text", text: notice });
            }
          }
        } catch {
          // Ignore
        }
      }
      return res;
    };

    toolsRegistry.set(name, {
      name,
      description,
      schemaShape,
      schema: z.object(schemaShape),
      handler: wrappedHandler,
    });
    server.tool(name, description, schemaShape, wrappedHandler);
  };
}

export function isCliRun(argv = process.argv): boolean {
  return argv[2] === "run";
}

export async function runCli(argv = process.argv): Promise<number> {
  const args = argv.slice(3);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printRunHelp();
    return 0;
  }

  const toolName = args[0];
  let tool = toolsRegistry.get(toolName);
  if (!tool) {
    const { legacyFallbackMap, executeLegacyFallback } = await import("../legacy/fallback-router.js");
    if (legacyFallbackMap[toolName]) {
      const { values, format } = parseArgs(args.slice(1), {});
      try {
        const result = await executeLegacyFallback(toolName, values);
        const isError = !!result?.isError;
        const unwrapped = unwrapMcpResult(result);
        if (isError) {
          console.error(typeof unwrapped === "string" ? unwrapped : JSON.stringify(unwrapped, null, 2));
          return 1;
        }
        printFormatted(unwrapped, format);
        return 0;
      } catch (error) {
        console.error(`Error executing tool: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
      }
    }
    console.error(`Unknown tool: ${toolName}\n`);
    printRunHelp();
    return 1;
  }

  if (args.includes("--help") || args.includes("-h")) {
    printToolHelp(tool);
    return 0;
  }

  const { values, format } = parseArgs(args.slice(1), tool.schemaShape);
  const parsed = tool.schema.safeParse(values);
  if (!parsed.success) {
    console.error(`Invalid arguments for ${toolName}:`);
    console.error(z.prettifyError(parsed.error));
    return 1;
  }

  try {
    const result = await tool.handler(parsed.data);
    const isError = !!result?.isError;
    const unwrapped = unwrapMcpResult(result);
    if (isError) {
      console.error(typeof unwrapped === "string" ? unwrapped : JSON.stringify(unwrapped, null, 2));
      return 1;
    }
    printFormatted(unwrapped, format);
    return 0;
  } catch (error) {
    // Insufficient-scope failures get a runtime re-auth offer, then one retry (issue #113)
    const { MissingScopeError } = await import("../common/auth/scope-error.js");
    if (error instanceof MissingScopeError) {
      console.error(`\n✘ ${error.message}`);
      const { offerScopeReauth } = await import("../common/auth/scope-reauth.js");
      let authorized = false;
      try {
        authorized = await offerScopeReauth(error);
      } catch (reauthError) {
        // Consent cancelled, OAuth callback port busy, unknown account...
        // surface it cleanly instead of an unhandled rejection.
        if (!(reauthError instanceof Error && reauthError.name === 'CancelledError')) {
          console.error(`Re-authorization failed: ${reauthError instanceof Error ? reauthError.message : String(reauthError)}`);
        }
        console.error(`Resolution: ${error.resolution}`);
        return 1;
      }
      if (!authorized) {
        console.error(`Resolution: ${error.resolution}`);
        return 1;
      }
      try {
        const retryResult = await tool.handler(parsed.data);
        const retryIsError = !!retryResult?.isError;
        const retryUnwrapped = unwrapMcpResult(retryResult);
        if (retryIsError) {
          console.error(typeof retryUnwrapped === "string" ? retryUnwrapped : JSON.stringify(retryUnwrapped, null, 2));
          return 1;
        }
        printFormatted(retryUnwrapped, format);
        return 0;
      } catch (retryError) {
        console.error(`Error executing tool: ${retryError instanceof Error ? retryError.message : String(retryError)}`);
        return 1;
      }
    }
    console.error(`Error executing tool: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

function parseArgs(args: string[], schemaShape: Record<string, z.ZodTypeAny>): { values: Record<string, any>; format: string } {
  const values: Record<string, any> = {};
  let format = "json";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;

    let key: string;
    let rawValue: string | boolean = true;

    if (arg.startsWith("--no-")) {
      key = arg.slice(5);
      rawValue = false;
    } else {
      const eq = arg.indexOf("=");
      if (eq >= 0) {
        key = arg.slice(2, eq);
        rawValue = arg.slice(eq + 1);
      } else {
        key = arg.slice(2);
        if (args[i + 1] && !args[i + 1].startsWith("--")) rawValue = args[++i];
      }
    }

    if (key === "format") {
      format = String(rawValue).toLowerCase();
      continue;
    }

    values[key] = coerceValue(rawValue, schemaShape[key]);
  }

  return { values, format };
}

function coerceValue(value: string | boolean, zodType?: z.ZodTypeAny): any {
  if (typeof value === "boolean") return value;
  const typeName = getZodTypeName(zodType);

  if (typeName === "number") {
    const num = Number(value);
    return Number.isNaN(num) ? value : num;
  }
  if (typeName === "boolean") {
    return ["true", "1", "yes", "on", ""].includes(value.toLowerCase());
  }
  if (typeName === "array") {
    try {
      if (value.trim().startsWith("[")) return JSON.parse(value);
    } catch {
      // Fall through to comma splitting.
    }
    return value.split(",").map((part) => part.trim()).filter(Boolean);
  }
  if (value.trim().startsWith("{") || value.trim().startsWith("[")) {
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
}

function getZodTypeName(zodType?: z.ZodTypeAny): string | undefined {
  let current: any = zodType;
  while (current?._def) {
    const def = current._def;
    const typeName = def.typeName ?? def.type;
    if (["optional", "nullable", "default", "catch", "pipe"].includes(typeName)) {
      current = def.innerType ?? def.in ?? def.schema;
      continue;
    }
    if (typeName === "ZodOptional" || typeName === "ZodNullable" || typeName === "ZodDefault") {
      current = def.innerType;
      continue;
    }
    return String(typeName).replace(/^Zod/, "").toLowerCase();
  }
  return undefined;
}

function unwrapMcpResult(result: any): any {
  const text = result?.content?.find?.((item: any) => item?.type === "text")?.text;
  if (typeof text !== "string") return result;
  try { return JSON.parse(text); } catch { return text; }
}

function printFormatted(data: any, format: string): void {
  if (format === "csv") {
    const rows = Array.isArray(data) ? data : [data];
    console.log(jsonToCsv(rows.map(flattenForDisplay)));
    return;
  }
  if (format === "table") {
    printTable(Array.isArray(data) ? data : [data]);
    return;
  }
  console.log(typeof data === "string" ? data : JSON.stringify(data, null, 2));
}

function flattenForDisplay(value: any): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { value };
  return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, typeof val === "object" && val !== null ? JSON.stringify(val) : val]));
}

function printTable(data: any[]): void {
  const rows = data.map(flattenForDisplay);
  if (rows.length === 0) { console.log(""); return; }
  const keys = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const widths = Object.fromEntries(keys.map((key) => [key, Math.max(key.length, ...rows.map((row) => String(row[key] ?? "").length))]));
  const border = "+" + keys.map((key) => "-".repeat(widths[key] + 2)).join("+") + "+";
  const render = (row: Record<string, any>) => "|" + keys.map((key) => ` ${String(row[key] ?? "").padEnd(widths[key])} `).join("|") + "|";
  console.log([border, render(Object.fromEntries(keys.map((key) => [key, key]))), border, ...rows.map(render), border].join("\n"));
}

function printRunHelp(): void {
  console.log(`Usage: search-console-mcp run <tool_name> [--arg=value] [--format=json|csv|table]\n\nAvailable tools:`);
  for (const tool of toolsRegistry.values()) console.log(`  ${tool.name} - ${tool.description}`);
}

function printToolHelp(tool: ToolDefinition): void {
  console.log(`Usage: search-console-mcp run ${tool.name} [options]\n\n${tool.description}\n\nOptions:`);
  for (const [key, schema] of Object.entries(tool.schemaShape)) console.log(`  --${key} (${getZodTypeName(schema) ?? "value"})`);
  console.log("  --format (json|csv|table)");
}
