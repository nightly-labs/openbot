import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { thisComputer } from "./host-tool-machines";
import type { HostToolAction } from "./host-tool-policy";
import type { HostToolRequest } from "./host-tool-types";

const CATALOG_ACTIONS = {
  host_shell: "shell",
  host_screenshot: "screenshot",
  host_read_file: "read-file",
  host_list_directory: "list-directory",
  host_write_file: "write-file",
  host_send_input: "send-input",
  host_mcp: "mcp",
} as const satisfies Record<string, HostToolAction>;

const HOST_CATALOG_TOOLS = new Set<string>([...Object.keys(CATALOG_ACTIONS), "host_list_machines"]);

export function isHostCatalogTool(name: string): boolean {
  return HOST_CATALOG_TOOLS.has(name);
}

export interface HostToolCatalogContext {
  readonly id: string;
  readonly agentId: string;
  readonly threadId: string;
  readonly turnId: string;
}

/**
 * Maps one catalog call into a host-tool request.
 * `host_list_machines` returns the computer list as text and does not build a request.
 * `capture_screen` stays on its own tool.
 */
export function hostToolRequestFromCatalog(
  tool: string,
  args: unknown,
  context: HostToolCatalogContext,
): HostToolRequest | string | null {
  if (tool === "capture_screen") return null;
  if (tool === "host_list_machines") return JSON.stringify([thisComputer()]);
  if (!isDynamicRecord(args)) return null;
  const action = catalogAction(tool);
  if (action === undefined) return null;
  const base = {
    id: context.id,
    agentId: context.agentId,
    threadId: context.threadId,
    turnId: context.turnId,
    ...machineIdOf(args),
  };
  if (action === "shell") {
    if (!isString(args.command) || args.command.length === 0) return null;
    const workingDirectory = isString(args.workingDirectory) ? args.workingDirectory : undefined;
    return { ...base, action, command: args.command, ...(workingDirectory === undefined ? {} : { workingDirectory }) };
  }
  if (action === "screenshot") return { ...base, action };
  if (action === "read-file" || action === "list-directory") {
    if (!isString(args.path) || args.path.length === 0) return null;
    return { ...base, action, path: args.path };
  }
  if (action === "write-file") {
    if (!isString(args.path) || args.path.length === 0 || !isString(args.fileText)) return null;
    return { ...base, action, path: args.path, fileText: args.fileText };
  }
  if (action === "mcp") {
    if (!isString(args.serverIdentifier) || args.serverIdentifier.length === 0) return null;
    if (!isString(args.toolName) || args.toolName.length === 0) return null;
    const toolArguments = isDynamicRecord(args.arguments) ? args.arguments : undefined;
    return {
      ...base,
      action,
      serverIdentifier: args.serverIdentifier,
      toolName: args.toolName,
      ...(toolArguments === undefined ? {} : { arguments: toolArguments }),
    };
  }
  return { ...base, action: "send-input", chars: isString(args.chars) ? args.chars : "" };
}

function catalogAction(tool: string): HostToolAction | undefined {
  for (const [name, action] of Object.entries(CATALOG_ACTIONS)) {
    if (name === tool) return action;
  }
  return undefined;
}

function machineIdOf(args: { readonly machineId?: unknown }): { machineId?: string } {
  return isString(args.machineId) && args.machineId.length > 0 ? { machineId: args.machineId } : {};
}
