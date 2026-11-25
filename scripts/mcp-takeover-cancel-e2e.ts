import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { BrowserTab } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { AttentionRegistry } from "../src/backend/agent/attention-registry";
import { CodexAppServerClient } from "../src/backend/app-server-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { type DynamicToolNamespace, LocalMcpBridge } from "../src/backend/local-mcp-bridge";
import { PendingServerRequests } from "../src/backend/pending-server-requests";
import { type DynamicToolResult, isRecord, PROVIDER_STOPPED_WAITING, type RequestId } from "../src/backend/protocol";

const OUT = resolve(import.meta.dirname, "../.openbot-build/mcp-takeover-cancel-e2e");
const THREAD = "thread-1";
const AGENT = "agent-1";
const TAB = "tab-1";
const CLIENT_TOOL_LIMIT_MS = 1_000;

interface Report {
  passed: boolean;
  clientError?: string;
  cancelReason?: string;
  cardsAfterCancel?: number;
  tabReleased?: boolean;
  cardsAfterAnswer?: number;
  lateAnswers: string[];
  cardsAfterStop?: number;
}

const report: Report = { passed: false, lateAnswers: [] };
const endedTakeovers: string[] = [];

class BridgedAgentClient extends CodexAppServerClient {
  constructor(readonly requests: { resolve(id: RequestId, result: unknown): void }) {
    super("/nonexistent/agent");
  }
  override get running(): boolean {
    return true;
  }
  override respond(id: RequestId, result: unknown): void {
    this.requests.resolve(id, result);
  }
}

function isDynamicToolResult(value: unknown): value is DynamicToolResult {
  return isRecord(value) && typeof value.success === "boolean" && Array.isArray(value.contentItems);
}

const tab: BrowserTab = {
  id: TAB,
  title: "Sign in",
  url: "https://github.com/login",
  loading: false,
  ownerAgentId: AGENT,
  ownerThreadId: THREAD,
};
let snapshotChanged: () => void = () => {};
const registry = new AttentionRegistry({
  conversation: {
    agentForThread: (threadId) => (threadId === THREAD ? AGENT : undefined),
    publicThreadId: (_agentId, threadId) => threadId,
    ensureSnapshot: () => ({ agentId: AGENT, threadId: THREAD, activeTurnId: null, revision: 0, messages: [] }),
    emitConversation: () => {},
  },
  browser: {
    listTabs: () => [tab],
    toolCanUseTab: () => true,
    beginTakeover: () => Effect.void,
    endTakeover: (tabId) => endedTakeovers.push(tabId),
  },
  hostedSites: { prepareApproval: () => Effect.succeed(null), resolveApproval: () => Effect.void },
  routines: { markNeedsAttention: () => {}, markRunningForTurn: () => {}, runsTurn: () => false },
  emit: () => {},
  emitError: () => {},
  emitRuntimeSnapshot: () => snapshotChanged(),
  lateAnswerTarget: () => ({}),
  sendLateAnswer: (_agentId, _target, text) => report.lateAnswers.push(text),
});

let agent: BridgedAgentClient;
const requests = new PendingServerRequests((request) => {
  request.signal?.addEventListener(
    "abort",
    () => {
      report.cancelReason = String(request.signal?.reason);
      registry.cancelRequest(agent, request.id, request.signal?.reason === PROVIDER_STOPPED_WAITING);
    },
    { once: true },
  );
  void runCauseEffect(registry.surfaceBrowserTakeover(agent, request)).then(
    (result) => requests.resolve(request.id, result),
    () => undefined,
  );
});
agent = new BridgedAgentClient(requests);

const namespace: DynamicToolNamespace = {
  type: "namespace",
  name: "openbot_browser",
  tools: [
    {
      type: "function",
      name: "request_takeover",
      inputSchema: { type: "object", properties: { tabId: { type: "string" } } },
    },
  ],
};

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

function openCards(): number {
  return registry.runtimeAttention().pendingBrowserTakeovers.length;
}

let turn = "turn-1";
const bridge = new LocalMcpBridge();
const session = await runCauseEffect(
  bridge.createSession(
    THREAD,
    [namespace],
    () => turn,
    (call, signal, detachAfterMs) =>
      requests
        .call("item/tool/call", call, signal, detachAfterMs)
        .pipe(
          Effect.flatMap((result) =>
            isDynamicToolResult(result)
              ? Effect.succeed<DynamicToolResult>(result)
              : Effect.die(new Error("invalid dynamic tool result")),
          ),
        ),
  ),
);

try {
  const server = session.servers[0];
  assert.ok(server);
  const authorization = server.headers.find((header) => header.name === "Authorization");
  assert.ok(authorization);
  const serverUrl = new URL(server.url);
  const token = authorization.value;
  async function takeOverUntilClientGivesUp(): Promise<string> {
    const client = new Client({ name: "e2e-acp-like", version: "1.0.0" });
    await client.connect(
      asTransport(
        new StreamableHTTPClientTransport(serverUrl, {
          requestInit: { headers: { Authorization: token } },
        }),
      ),
    );
    delete report.cancelReason;
    const cancelled = new Promise<void>((resolveCancel) => {
      snapshotChanged = () => {
        if (report.cancelReason !== undefined) resolveCancel();
      };
    });
    const clientError = await client
      .callTool({ name: "request_takeover", arguments: { tabId: TAB } }, undefined, {
        timeout: CLIENT_TOOL_LIMIT_MS,
        onprogress: () => {},
      })
      .then(
        () => "answered",
        (error: unknown) => String(error),
      );
    assert.match(clientError, /timed out/i, "The MCP client gives up on the call at its own limit.");
    await cancelled;
    await client.close().catch(() => undefined);
    return clientError;
  }

  report.clientError = await takeOverUntilClientGivesUp();
  report.cardsAfterCancel = openCards();
  report.tabReleased = endedTakeovers.length > 0;
  assert.equal(report.cancelReason, PROVIDER_STOPPED_WAITING, "The client's cancel reads as 'stopped waiting'.");
  assert.equal(report.cardsAfterCancel, 1, "The takeover card stays open after the client's cancel.");
  assert.equal(report.tabReleased, false, "The user keeps control of the tab.");

  const card = registry.runtimeAttention().pendingBrowserTakeovers[0];
  assert.ok(card);
  await runCauseEffect(registry.respondToBrowserTakeover({ requestId: card.requestId, decision: "complete" }));
  report.cardsAfterAnswer = openCards();
  assert.equal(report.cardsAfterAnswer, 0);
  assert.equal(report.lateAnswers.length, 1, "The agent gets the user's answer as a late answer.");

  turn = "turn-2";
  await takeOverUntilClientGivesUp();
  assert.equal(openCards(), 1, "The second card also stays open after the client's cancel.");
  registry.clearForTurn(THREAD, turn, false);
  report.cardsAfterStop = openCards();
  assert.equal(report.cardsAfterStop, 0, "Stop still closes a card that waits.");
  assert.equal(report.lateAnswers.length, 1, "Stop sends no late answer.");
  report.passed = true;
} finally {
  session.close();
  await runCauseEffect(bridge.close()).catch(() => undefined);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(report.passed ? 0 : 1);
