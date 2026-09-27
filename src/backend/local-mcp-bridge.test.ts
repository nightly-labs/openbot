// @vitest-environment node

import { request } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import { type DynamicToolNamespace, LOCAL_MCP_PROGRESS_INTERVAL_MS, LocalMcpBridge } from "./local-mcp-bridge";
import type { DynamicToolResult } from "./protocol";

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
  await Promise.allSettled(bridges.splice(0).map((bridge) => bridge.close()));
});

describe("LocalMcpBridge", () => {
  it("does not expose request parsing failures", async () => {
    const bridge = new LocalMcpBridge();
    bridges.push(bridge);
    const session = await bridge.createSession(
      "thread-1",
      TOOLS,
      () => "turn-1",
      async () => ({
        success: true,
        contentItems: [],
      }),
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
    const first = await bridge.createSession(
      "thread-1",
      TOOLS,
      () => "turn-1",
      async (call) => {
        calls.push(`${call.threadId}:${call.turnId}`);
        return isDynamicRecord(call.arguments) && "image" in call.arguments
          ? {
              success: true,
              contentItems: [{ type: "inputImage", imageUrl: "data:image/png;base64,aGVsbG8=" }],
            }
          : { success: true, contentItems: [{ type: "inputText", text: "hello" }] };
      },
    );
    const second = await bridge.createSession(
      "thread-2",
      TOOLS,
      () => "turn-2",
      async () => ({
        success: true,
        contentItems: [{ type: "inputText", text: "second" }],
      }),
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
      const session = await bridge.createSession(
        "thread-1",
        TOOLS,
        () => "turn-1",
        () => {
          start();
          return new Promise<DynamicToolResult>((resolve) => {
            answer = resolve;
          });
        },
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
    const session = await bridge.createSession(
      "thread-1",
      TOOLS,
      () => "turn-1",
      (_call, signal) => {
        signals.push(signal);
        return new Promise<DynamicToolResult>(() => undefined);
      },
    );
    const [server] = session.servers;
    assert(server);

    // An MCP client whose timeout ends sends `notifications/cancelled` on a new POST.
    const client = await connect(server);
    const cancel = new AbortController();
    const cancelled = client.callTool({ name: "echo", arguments: {} }, undefined, { signal: cancel.signal });
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
    call.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "echo", arguments: {} } }));
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
