import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import type { Json } from "./local-exec-frames";

export async function runHostMcp(input: {
  readonly configs: readonly McpServerConfig[];
  readonly agentId: string;
  readonly forAgent: (configs: readonly McpServerConfig[], agentId: string) => McpServerConfig[];
  readonly serverIdentifier?: string;
  readonly providerIdentifier?: string;
  readonly toolName: string;
  readonly arguments?: { readonly [key: string]: unknown };
  readonly call: (
    config: McpServerConfig,
    toolName: string,
    args: { readonly [key: string]: unknown },
  ) => Promise<string>;
}): Promise<{ text: string } | { refused: true }> {
  const selected = input.forAgent(input.configs, input.agentId);
  if (selected.length === 0) return { refused: true };
  const config =
    selected.find((row) => row.id === input.serverIdentifier) ??
    selected.find(
      (row) =>
        (input.providerIdentifier !== undefined && row.name === input.providerIdentifier) ||
        (input.serverIdentifier !== undefined && row.name === input.serverIdentifier),
    );
  if (config === undefined) return { refused: true };
  const text = await input.call(config, input.toolName, input.arguments ?? {});
  return { text };
}

export function mcpSuccessMessage(text: string): Json {
  return {
    mcpResult: {
      success: {
        content: [{ text: { text } }],
        isError: false,
      },
    },
  };
}

/** One MCP tool call on this computer. The caller has already checked the agent's server list. */
export async function callHostMcpTool(input: {
  readonly config: McpServerConfig;
  readonly endpoint: { readonly url: string; readonly authorization: string | null } | null;
  readonly toolName: string;
  readonly arguments: { readonly [key: string]: unknown };
}): Promise<string> {
  const client = new Client({ name: "openbot-host-tool", version: "1" });
  try {
    if (input.config.transport === "http") {
      if (input.endpoint === null) throw new Error("refused");
      const http = new StreamableHTTPClientTransport(new URL(input.endpoint.url), {
        requestInit: {
          headers: input.endpoint.authorization ? { authorization: `Bearer ${input.endpoint.authorization}` } : {},
        },
      });
      // Client.connect writes the callbacks, then calls start. Copy them onto the SDK transport
      // there. The SDK class itself is not a Transport under exactOptionalPropertyTypes.
      const transport: Transport = {
        start() {
          if (transport.onclose) http.onclose = transport.onclose;
          if (transport.onerror) http.onerror = transport.onerror;
          if (transport.onmessage) http.onmessage = transport.onmessage;
          return http.start();
        },
        send: (message: JSONRPCMessage, options?: TransportSendOptions) => http.send(message, options),
        close: () => http.close(),
        setProtocolVersion: (version) => http.setProtocolVersion(version),
      };
      await client.connect(transport);
    } else {
      const transport = new StdioClientTransport({
        command: input.config.command,
        args: input.config.args,
        ...(input.config.workingDirectory.length > 0 ? { cwd: input.config.workingDirectory } : {}),
        stderr: "ignore",
      });
      await client.connect(transport);
    }
    const result = await client.callTool({ name: input.toolName, arguments: { ...input.arguments } });
    return mcpText(result);
  } finally {
    await client.close();
  }
}

function mcpText(result: unknown): string {
  if (!isDynamicRecord(result) || !Array.isArray(result.content)) return "";
  const parts: string[] = [];
  for (const item of result.content) {
    if (!isDynamicRecord(item) || item.type !== "text" || !isString(item.text)) continue;
    parts.push(item.text);
  }
  return parts.join("");
}
