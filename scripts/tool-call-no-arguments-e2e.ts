import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { AgentProviderId } from "@openbot/contracts/agent-providers";
import { Effect, JsonSchema, Result, Schema, SchemaRepresentation } from "effect";
import { isDynamicToolNamespace } from "../src/backend/acp-client";
import { resolveDeferredTool, visibleDynamicTools } from "../src/backend/agent/tool-catalog";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { LocalMcpBridge, type LocalMcpSession } from "../src/backend/local-mcp-bridge";
import type { DynamicToolCallParams } from "../src/backend/protocol";

const OUT = resolve(import.meta.dirname, "../.openbot-build/tool-call-no-arguments-e2e");
const PROVIDERS: readonly AgentProviderId[] = ["acp", "opencode", "kimi"];
const NAME_ONLY_CALL = { name: "openbot.read_agent" };

interface ProviderReport {
  provider: AgentProviderId;
  inputSchema?: unknown;
  strictCheck?: string;
  resolved?: Pick<DynamicToolCallParams, "namespace" | "tool" | "arguments"> | null;
}

function asTransport(inner: {
  start(): Promise<void>;
  send: Transport["send"];
  close(): Promise<void>;
  onclose?: (() => void) | undefined;
  onerror?: ((error: Error) => void) | undefined;
  onmessage?: Transport["onmessage"] | undefined;
  setProtocolVersion?: ((version: string) => void) | undefined;
}): Transport {
  const transport: Transport = {
    start: () => {
      inner.onclose = () => transport.onclose?.();
      inner.onerror = (error) => transport.onerror?.(error);
      inner.onmessage = (message, extra) => transport.onmessage?.(message, extra);
      return inner.start();
    },
    send: (message, options) => inner.send(message, options),
    close: () => inner.close(),
    setProtocolVersion: (version) => inner.setProtocolVersion?.(version),
  };
  return transport;
}

async function connect(session: LocalMcpSession): Promise<Client> {
  const config = session.servers.find((candidate) => candidate.name === "openbot");
  assert.ok(config, "The session has the openbot server.");
  const client = new Client({ name: "e2e-tool-call-no-arguments", version: "1.0.0" });
  const headers = Object.fromEntries(config.headers.map((header) => [header.name, header.value]));
  await client.connect(
    asTransport(new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers } })),
  );
  return client;
}

function strictInputCheck(inputSchema: JsonSchema.JsonSchema, input: unknown): string {
  const document = JsonSchema.fromSchemaDraft07(inputSchema);
  const codec = Schema.make<Schema.Codec<unknown>>(SchemaRepresentation.fromJsonSchemaDocument(document).ast);
  const decoded = Schema.decodeUnknownResult(codec)(input, { errors: "all" });
  return Result.isSuccess(decoded) ? "accepted" : `refused: ${String(decoded.failure)}`;
}

const report: { passed: boolean; providers: ProviderReport[] } = { passed: false, providers: [] };
const bridge = new LocalMcpBridge();
const clients: Client[] = [];

try {
  for (const provider of PROVIDERS) {
    const entry: ProviderReport = { provider };
    report.providers.push(entry);
    const sent: unknown[] = visibleDynamicTools(provider);
    const namespaces = sent.filter(isDynamicToolNamespace);
    const session = await runCauseEffect(
      bridge.createSession(
        `thread-${provider}`,
        namespaces,
        () => "turn-1",
        (call) =>
          Effect.sync(() => {
            const resolved = resolveDeferredTool(call, provider);
            entry.resolved = resolved && {
              namespace: resolved.namespace,
              tool: resolved.tool,
              arguments: resolved.arguments,
            };
            return { success: true, contentItems: [{ type: "inputText" as const, text: "{}" }] };
          }),
      ),
    );
    const client = await connect(session);
    clients.push(client);
    const toolCall = (await client.listTools()).tools.find((tool) => tool.name === "tool_call");
    assert.ok(toolCall, `${provider}: the openbot server lists tool_call.`);
    entry.inputSchema = toolCall.inputSchema;
    entry.strictCheck = strictInputCheck(toolCall.inputSchema, NAME_ONLY_CALL);
    assert.equal(entry.strictCheck, "accepted", `${provider}: a strict client accepts a tool_call with only name.`);
    const result = await client.callTool({ name: "tool_call", arguments: NAME_ONLY_CALL });
    assert.notEqual(result.isError, true, `${provider}: the name-only call runs.`);
    assert.deepEqual(
      entry.resolved,
      { namespace: "openbot", tool: "read_agent", arguments: {} },
      `${provider}: the call reaches openbot.read_agent with empty arguments.`,
    );
  }
  report.passed = true;
} finally {
  await Promise.all(clients.map((client) => client.close().catch(() => undefined)));
  await runCauseEffect(bridge.close());
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
