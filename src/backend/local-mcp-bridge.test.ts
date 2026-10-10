import { Effect } from "effect";
import { runMcp } from "./mcp-test-runtime";
// @vitest-environment node

import { request } from "node:http";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ToolSchema } from "@modelcontextprotocol/sdk/types.js";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import { VISIBLE_DYNAMIC_TOOLS, VISIBLE_TOOL_DEFINITIONS } from "./agent/tool-catalog";
import { type DynamicToolNamespace, LOCAL_MCP_PROGRESS_INTERVAL_MS, LocalMcpBridge } from "./local-mcp-bridge";
import type { DynamicToolCallParams, DynamicToolResult } from "./protocol";

// Exercise the MCP input contract when constructing the local transport fixture.
const VISIBLE_MCP_TOOLS = VISIBLE_DYNAMIC_TOOLS.map((namespace) => ({
  ...namespace,
  tools: namespace.tools.map((entry) => ({
    ...entry,
    inputSchema: ToolSchema.shape.inputSchema.parse(entry.inputSchema),
  })),
}));

const TOOLS: DynamicToolNamespace[] = [
  {
    type: "namespace" as const,
    name: "openbot",
    description: "OpenBot test tools",
    tools: [
      {
        type: "function" as const,
        name: "echo",
        description: "Echo text or an image.",
        inputSchema: {
          type: "object",
          properties: { image: { type: "boolean" } },
          additionalProperties: false,
        },
      },
    ],
  },
];

const bridges: LocalMcpBridge[] = [];
const clients: Client[] = [];

afterEach(async () => {
  await Promise.allSettled(clients.splice(0).map((client) => client.close()));
  await Promise.allSettled(bridges.splice(0).map((bridge) => runMcp(bridge.close())));
});

describe("LocalMcpBridge", () => {
  it("lists and validates the deferred envelope through the real Claude MCP SDK", async () => {
    const definitions = VISIBLE_TOOL_DEFINITIONS.filter((definition) => definition.name !== "ask_user");
    const server = createSdkMcpServer({
      name: "openbot",
      version: "0.1.0",
      tools: definitions.map((definition) =>
        tool(definition.name, definition.description, definition.shape, async (args) => ({
          content: [{ type: "text", text: JSON.stringify(args) }],
        })),
      ),
    });
    const client = new Client({ name: "claude-catalog-check", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.instance.connect(serverTransport);
      await client.connect(clientTransport);
      expect((await client.listTools()).tools.map((entry) => entry.name)).toEqual(
        definitions.map((entry) => entry.name),
      );
      const envelope = { name: "openbot.list_agents", arguments: { nested: [1, true, null, { text: "fixture" }] } };
      expect(await client.callTool({ name: "tool_call", arguments: envelope })).toMatchObject({
        content: [{ type: "text", text: JSON.stringify(envelope) }],
      });
      expect(
        await client.callTool({ name: "tool_call", arguments: { ...envelope, arguments: "invalid" } }),
      ).toMatchObject({ isError: true });
    } finally {
      await client.close();
      await server.instance.close();
    }
  });

  it("forwards deferred arguments and image results through the visible catalog", async () => {
    const bridge = new LocalMcpBridge();
    bridges.push(bridge);
    const calls: DynamicToolCallParams[] = [];
    const session = await runMcp(
      bridge.createSession(
        "thread-visible",
        VISIBLE_MCP_TOOLS,
        () => "turn-visible",
        (call) =>
          Effect.sync(() => {
            calls.push(call);
            return {
              success: true,
              contentItems: [{ type: "inputImage", imageUrl: "data:image/png;base64,aGVsbG8=" }],
            };
          }),
      ),
    );
    const [server] = session.servers;
    assert(server);
    const client = await connect(server);
    expect((await client.listTools()).tools.map((tool) => tool.name).toSorted()).toEqual(
      VISIBLE_DYNAMIC_TOOLS.flatMap((namespace) => namespace.tools.map((tool) => tool.name)).toSorted(),
    );
    const arguments_ = {
      name: "openbot_browser.screenshot",
      arguments: { tabId: "tab-1", nested: { values: [1, true, null, "literal"] } },
    };
    expect(await client.callTool({ name: "tool_call", arguments: arguments_ })).toMatchObject({
      content: [{ type: "image", mimeType: "image/png", data: "aGVsbG8=" }],
    });
    expect(calls).toEqual([
      {
        threadId: "thread-visible",
        turnId: "turn-visible",
        callId: expect.any(String),
        namespace: "openbot",
        tool: "tool_call",
        arguments: arguments_,
      },
    ]);
  });

  it("does not expose request parsing failures", async () => {
    const bridge = new LocalMcpBridge();
    bridges.push(bridge);
    const session = await runMcp(
      bridge.createSession(
        "thread-1",
        TOOLS,
        () => "turn-1",
        () =>
          Effect.sync(() => ({
            success: true,
            contentItems: [],
          })),
      ),
    );
    const server = session.servers[0];
    if (!server) throw new Error("The MCP server was not created.");

    const response = await fetch(server.url, {
      method: "POST",
      headers: {
        ...Object.fromEntries(server.headers.map((header) => [header.name, header.value])),
        "content-type": "application/json",
      },
      body: "private-invalid-json",
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32603, message: "Internal MCP bridge error." },
    });
  });

  it("requires its session token, isolates sessions, and forwards text and image results", async () => {
    const bridge = new LocalMcpBridge();
    bridges.push(bridge);
    const calls: string[] = [];
    const first = await runMcp(
      bridge.createSession(
        "thread-1",
        TOOLS,
        () => "turn-1",
        (call) =>
          Effect.sync(() => {
            calls.push(`${call.threadId}:${call.turnId}`);
            return isDynamicRecord(call.arguments) && "image" in call.arguments
              ? {
                  success: true,
                  contentItems: [{ type: "inputImage", imageUrl: "data:image/png;base64,aGVsbG8=" }],
                }
              : { success: true, contentItems: [{ type: "inputText", text: "hello" }] };
          }),
      ),
    );
    const second = await runMcp(
      bridge.createSession(
        "thread-2",
        TOOLS,
        () => "turn-2",
        () =>
          Effect.sync(() => ({
            success: true,
            contentItems: [{ type: "inputText", text: "second" }],
          })),
      ),
    );

    const [firstServer] = first.servers;
    const [secondServer] = second.servers;
    assert(firstServer && secondServer);
    const firstClient = await connect(firstServer);
    const secondClient = await connect(secondServer);
    expect((await firstClient.listTools()).tools.map((tool) => tool.name)).toEqual(["echo"]);
    expect(await firstClient.callTool({ name: "echo", arguments: {} })).toMatchObject({
      content: [{ type: "text", text: "hello" }],
    });
    expect(await firstClient.callTool({ name: "echo", arguments: { image: true } })).toMatchObject({
      content: [{ type: "image", mimeType: "image/png", data: "aGVsbG8=" }],
    });
    expect(await secondClient.callTool({ name: "echo", arguments: {} })).toMatchObject({
      content: [{ type: "text", text: "second" }],
    });
    expect(calls).toEqual(["thread-1:turn-1", "thread-1:turn-1"]);

    const unauthorized = new Client({ name: "unauthorized", version: "1" });
    clients.push(unauthorized);
    await expect(
      unauthorized.connect(
        new StreamableHTTPClientTransport(new URL(firstServer.url), {
          requestInit: { headers: { Authorization: "Bearer wrong-token" } },
        }),
      ),
    ).rejects.toThrow();

    await firstClient.close();
    first.close();
    const closed = new Client({ name: "closed", version: "1" });
    clients.push(closed);
    await expect(
      closed.connect(
        new StreamableHTTPClientTransport(new URL(firstServer.url), {
          requestInit: {
            headers: Object.fromEntries(firstServer.headers.map((header) => [header.name, header.value])),
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("keeps a waiting call alive with progress notifications", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const bridge = new LocalMcpBridge();
      bridges.push(bridge);
      let answer: (result: DynamicToolResult) => void = () => undefined;
      let start: () => void = () => undefined;
      const started = new Promise<void>((resolve) => {
        start = resolve;
      });
      const session = await runMcp(
        bridge.createSession(
          "thread-1",
          TOOLS,
          () => "turn-1",
          () =>
            Effect.promise(() => {
              start();
              return new Promise<DynamicToolResult>((resolve) => {
                answer = resolve;
              });
            }),
        ),
      );
      const [server] = session.servers;
      assert(server);
      const client = await connect(server);
      const progress: number[] = [];
      const call = client.callTool({ name: "echo", arguments: {} }, undefined, {
        resetTimeoutOnProgress: true,
        onprogress: (update) => progress.push(update.progress),
      });
      await started;

      vi.advanceTimersByTime(LOCAL_MCP_PROGRESS_INTERVAL_MS);
      await vi.waitFor(() => expect(progress).toEqual([1]));
      vi.advanceTimersByTime(LOCAL_MCP_PROGRESS_INTERVAL_MS);
      await vi.waitFor(() => expect(progress).toEqual([1, 2]));

      answer({ success: true, contentItems: [{ type: "inputText", text: "answered" }] });
      expect(await call).toMatchObject({ content: [{ type: "text", text: "answered" }] });
    } finally {
      vi.useRealTimers();
    }
  });

  it("tells the owner when the client cancels a call or closes its stream", async () => {
    const bridge = new LocalMcpBridge();
    bridges.push(bridge);
    const signals: AbortSignal[] = [];
    const session = await runMcp(
      bridge.createSession(
        "thread-1",
        VISIBLE_MCP_TOOLS,
        () => "turn-1",
        (_call, signal) =>
          Effect.promise(() => {
            signals.push(signal);
            return new Promise<DynamicToolResult>(() => undefined);
          }),
      ),
    );
    const [server] = session.servers;
    assert(server);

    // An MCP client whose timeout ends sends `notifications/cancelled` on a new POST.
    const client = await connect(server);
    const cancel = new AbortController();
    const cancelled = client.callTool(
      { name: "tool_call", arguments: { name: "openbot_browser.screenshot", arguments: { tabId: "tab-1" } } },
      undefined,
      { signal: cancel.signal },
    );
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    cancel.abort();
    await expect(cancelled).rejects.toThrow();
    await vi.waitFor(() => expect(signals.map((signal) => signal.aborted)).toEqual([true]));

    // A client that goes away closes the response stream. `node:http`, because fetch keeps a spare
    // connection open that delays the server's close.
    const call = request(server.url, {
      method: "POST",
      agent: false,
      headers: {
        ...Object.fromEntries(server.headers.map((header) => [header.name, header.value])),
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
    });
    call.on("error", () => undefined);
    call.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "tool_call", arguments: { name: "openbot_browser.screenshot", arguments: { tabId: "tab-1" } } },
      }),
    );
    await vi.waitFor(() => expect(signals).toHaveLength(2));
    call.destroy();
    await vi.waitFor(() => expect(signals.map((signal) => signal.aborted)).toEqual([true, true]));
  });
});

async function connect(server: { url: string; headers: Array<{ name: string; value: string }> }): Promise<Client> {
  const client = new Client({ name: "openbot-test", version: "1" });
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: { headers: Object.fromEntries(server.headers.map((header) => [header.name, header.value])) },
    }),
  );
  return client;
}
