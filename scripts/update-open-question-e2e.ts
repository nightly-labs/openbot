import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type {
  ConversationMessage,
  ConversationSnapshot,
  ScheduledUpdateRestart,
  TeamMemberSummary,
  UpdatePreference,
  UpdateStatus,
} from "@openbot/contracts/ipc";
import {
  HOST_UPDATE_CAPABILITY,
  HOST_UPDATE_CODECS,
  HOST_UPDATE_ROUTES,
} from "@openbot/contracts/team-protocol/host-update-v1";
import { Effect } from "effect";
import { AttentionRegistry } from "../src/backend/agent/attention-registry";
import { CodexAppServerClient } from "../src/backend/app-server-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { type DynamicToolNamespace, LocalMcpBridge } from "../src/backend/local-mcp-bridge";
import { PendingServerRequests } from "../src/backend/pending-server-requests";
import { type DynamicToolResult, isRecord, PROVIDER_STOPPED_WAITING, type RequestId } from "../src/backend/protocol";
import { RequestedUpdate } from "../src/main/requested-update";
import type { TeamApiRequestContext } from "../src/main/team-api/request-context";
import { routeHostUpdate } from "../src/main/team-api/route-host-update";
import { checkRestartReadiness } from "../src/main/update-readiness";

const OUT = resolve(import.meta.dirname, "../.openbot-build/update-open-question-e2e");
const THREAD = "thread-1";
const CLIENT_TOOL_LIMIT_MS = 1_000;
const POLL_MS = 20;
const POLLS_WHILE_HELD = 15;
const DEADLINE_MS = 20_000;
const HOLD_MS = 24 * 60 * 60_000;
const HOSTED_MAXIMUM_WAIT_MS = 300;

type CardState = NonNullable<ConversationMessage["questionPrompt"]>["resolution"] | "pending";

interface Report {
  passed: boolean;
  answered?: {
    waitingFor?: string[];
    teamApiWaitingFor?: string[];
    installsWhileOpen?: number;
    installsAfterAnswer?: number;
    card?: CardState;
    lateAnswers?: number;
  };
  unanswered?: {
    waitingFor?: string[];
    installsBeforeLimit?: number;
    installsAfterLimit?: number;
    cardAtInstall?: CardState;
  };
  hosted?: {
    waitingFor?: string[];
    installsAfterMaximumWait?: number;
    cardAtInstall?: CardState;
  };
  error?: string;
}

const report: Report = { passed: false };
const lateAnswers: string[] = [];
let clockOffsetMs = 0;

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

class StagedReleaseUpdater extends EventEmitter {
  status: UpdateStatus = {
    phase: "ready",
    currentVersion: "0.98.0",
    availableVersion: "0.99.0",
    progress: null,
    checkedAt: null,
    message: null,
    errorCode: null,
  };
  installs = 0;
  #set(change: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...change };
    this.emit("status", this.status);
  }
  getStatus = () => this.status;
  checkForUpdates = () => Effect.sync(() => this.status);
  downloadUpdate = () => Effect.sync(() => this.status);
  installUpdate = () =>
    Effect.sync(() => {
      this.installs += 1;
      this.#set({ phase: "installing" });
    });
  setScheduledRestart = (restart: ScheduledUpdateRestart | null) => {
    if (restart) this.#set({ scheduledRestart: restart });
    else {
      const { scheduledRestart: _cleared, ...rest } = this.status;
      this.#set(rest);
    }
  };
  getAutoDownload = () => true;
  setAutoDownload = () => Effect.void;
}

function isDynamicToolResult(value: unknown): value is DynamicToolResult {
  return isRecord(value) && typeof value.success === "boolean" && Array.isArray(value.contentItems);
}

const snapshot: ConversationSnapshot = {
  agentId: "agent-1",
  threadId: THREAD,
  activeTurnId: null,
  revision: 0,
  messages: [],
};
let snapshotChanged: () => void = () => {};
const registry = new AttentionRegistry({
  conversation: {
    agentForThread: (threadId) => (threadId === THREAD ? "agent-1" : undefined),
    publicThreadId: (_agentId, threadId) => threadId,
    ensureSnapshot: () => snapshot,
    emitConversation: () => {
      snapshot.revision += 1;
    },
  },
  browser: { listTabs: () => [], toolCanUseTab: () => false, beginTakeover: () => Effect.void, endTakeover: () => {} },
  hostedSites: { prepareApproval: () => Effect.succeed(null), resolveApproval: () => Effect.void },
  routines: { markNeedsAttention: () => {}, markRunningForTurn: () => {}, runsTurn: () => false },
  emit: () => {},
  emitError: () => {},
  emitRuntimeSnapshot: () => snapshotChanged(),
  lateAnswerTarget: () => ({}),
  sendLateAnswer: (_agentId, _target, text) => lateAnswers.push(text),
});

let agent: BridgedAgentClient;
const requests = new PendingServerRequests((request) => {
  request.signal?.addEventListener(
    "abort",
    () => registry.cancelRequest(agent, request.id, request.signal?.reason === PROVIDER_STOPPED_WAITING),
    { once: true },
  );
  registry.surfaceDynamicPrompt(agent, request);
});
agent = new BridgedAgentClient(requests);

const namespace: DynamicToolNamespace = {
  type: "namespace",
  name: "openbot",
  tools: [{ type: "function", name: "ask_user", inputSchema: { type: "object", properties: {} } }],
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

let turn = "turn-1";

function card(turnId: string): CardState {
  const message = snapshot.messages.find((candidate) => candidate.id.startsWith(`question-prompt:${turnId}:`));
  return message?.questionPrompt?.resolution ?? "pending";
}

function desktopUpdate(maximumWaitMs?: number) {
  const updater = new StagedReleaseUpdater();
  let readinessChecks = 0;
  const preference: UpdatePreference = { autoDownload: true, allowRemoteUpdates: true, autoInstall: true };
  const requested = new RequestedUpdate({
    updater,
    describeReadiness: () => {
      readinessChecks += 1;
      return checkRestartReadiness({
        agentWork: registry.hasDetachedQuestionHoldingRestart(Date.now() + clockOffsetMs) ? ["open-question"] : [],
        hostBlockers: [],
        activeBrowserControls: 0,
        activeFileTransfers: false,
        updaterBusy: false,
        initializationPending: false,
      });
    },
    preference,
    savePreference: () => Effect.succeed(preference),
    log: () => {},
    announce: () => {},
    pollMs: POLL_MS,
    graceMs: 0,
    automaticSpreadMs: 0,
    random: () => 0,
    maximumIdleWait:
      maximumWaitMs === undefined ? undefined : { afterMs: maximumWaitMs, providerOperationPending: () => false },
  });
  return { updater, requested, readinessChecks: () => readinessChecks };
}

async function until(label: string, done: () => boolean): Promise<void> {
  const deadline = Date.now() + DEADLINE_MS;
  while (!done()) {
    if (Date.now() > deadline) throw new Error(`Timed out while waiting for ${label}.`);
    await new Promise((next) => setTimeout(next, 5));
  }
}

async function morePolls(update: ReturnType<typeof desktopUpdate>, count: number): Promise<void> {
  const target = update.readinessChecks() + count;
  await until(`${count} more readiness checks`, () => update.readinessChecks() >= target);
}

const OWNER: TeamMemberSummary = {
  id: "member-owner",
  username: "owner",
  email: null,
  name: "Owner",
  role: "owner",
  createdAt: "2026-11-01T00:00:00.000Z",
  disabled: false,
};

async function teamApiWaitingFor(update: RequestedUpdate): Promise<string[]> {
  const request = new IncomingMessage(new Socket());
  let body: unknown;
  const context: TeamApiRequestContext = {
    request,
    response: new ServerResponse(request),
    method: "POST",
    url: new URL(HOST_UPDATE_ROUTES.status, "https://host.test"),
    protocol: 3,
    capabilities: new Set([HOST_UPDATE_CAPABILITY]),
    member: OWNER,
    token: "token-a",
    agentLevel: () => "manage",
    sessionId: "session-a",
    sessionExpiresAt: "2026-12-01T00:00:00.000Z",
    fromChrome: false,
    json: (_status, value) => {
      body = value;
      return "handled";
    },
    empty: () => "handled",
  };
  await routeHostUpdate(context, { update });
  const codec = HOST_UPDATE_CODECS.get(HOST_UPDATE_ROUTES.status);
  assert.ok(codec);
  const wire = codec.response(200, body);
  assert.ok(isRecord(wire) && isRecord(wire.restart) && Array.isArray(wire.restart.waitingFor));
  return wire.restart.waitingFor.filter((reason): reason is string => typeof reason === "string");
}

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

  async function askUntilTheCardDetaches(): Promise<void> {
    const client = new Client({ name: "e2e-update-open-question", version: "1.0.0" });
    await client.connect(
      asTransport(new StreamableHTTPClientTransport(serverUrl, { requestInit: { headers: { Authorization: token } } })),
    );
    const detached = new Promise<void>((resolveDetached) => {
      snapshotChanged = () => {
        if (registry.pendingPrompts().some((prompt) => prompt.turnId === turn && prompt.detached)) resolveDetached();
      };
    });
    await client
      .callTool(
        {
          name: "ask_user",
          arguments: {
            questions: [
              {
                id: "send",
                header: "Send",
                question: "Send the report?",
                options: [{ label: "Yes" }, { label: "No" }],
              },
            ],
          },
        },
        undefined,
        { timeout: CLIENT_TOOL_LIMIT_MS, onprogress: () => {} },
      )
      .catch(() => undefined);
    await detached;
    await client.close().catch(() => undefined);
  }

  report.answered = {};
  await askUntilTheCardDetaches();
  const answered = desktopUpdate();
  await until("the update that waits for the open card", () =>
    Boolean(answered.updater.status.scheduledRestart?.waitingFor.includes("open-question")),
  );
  await morePolls(answered, POLLS_WHILE_HELD);
  report.answered.waitingFor = answered.updater.status.scheduledRestart?.waitingFor;
  report.answered.installsWhileOpen = answered.updater.installs;
  assert.deepEqual(report.answered.waitingFor, ["open-question"]);
  assert.equal(report.answered.installsWhileOpen, 0, "The update restarted while a card waited for an answer.");
  report.answered.teamApiWaitingFor = await teamApiWaitingFor(answered.requested);
  assert.deepEqual(report.answered.teamApiWaitingFor, ["other"], "Released clients read the new reason as other work.");

  const prompt = registry.pendingPrompts().find((candidate) => candidate.turnId === turn);
  assert.ok(prompt?.detached);
  await runCauseEffect(registry.respondToPrompt({ requestId: prompt.requestId, answers: { send: ["Yes"] } }));
  await until("the install after the answer", () => answered.updater.installs === 1);
  report.answered.installsAfterAnswer = answered.updater.installs;
  report.answered.card = card(turn);
  report.answered.lateAnswers = lateAnswers.length;
  assert.deepEqual(report.answered.card, {
    status: "answered",
    responses: { send: { status: "answered", answers: ["Yes"] } },
  });
  assert.equal(report.answered.lateAnswers, 1, "The agent did not get the answer.");
  await Effect.runPromise(answered.requested.dispose());

  report.unanswered = {};
  turn = "turn-2";
  await askUntilTheCardDetaches();
  const unanswered = desktopUpdate();
  await until("the update that waits for the second card", () =>
    Boolean(unanswered.updater.status.scheduledRestart?.waitingFor.includes("open-question")),
  );
  report.unanswered.waitingFor = unanswered.updater.status.scheduledRestart?.waitingFor;
  clockOffsetMs = HOLD_MS - 60_000;
  await morePolls(unanswered, POLLS_WHILE_HELD);
  report.unanswered.installsBeforeLimit = unanswered.updater.installs;
  assert.equal(report.unanswered.installsBeforeLimit, 0, "The update did not wait for the card up to the limit.");
  clockOffsetMs = HOLD_MS;
  await until("the install after the limit", () => unanswered.updater.installs === 1);
  report.unanswered.installsAfterLimit = unanswered.updater.installs;
  report.unanswered.cardAtInstall = card(turn);
  assert.equal(report.unanswered.cardAtInstall, "pending", "The card closed before the restart.");
  await Effect.runPromise(unanswered.requested.dispose());

  report.hosted = {};
  clockOffsetMs = 0;
  turn = "turn-3";
  await askUntilTheCardDetaches();
  const hosted = desktopUpdate(HOSTED_MAXIMUM_WAIT_MS);
  await until("the hosted update that waits for the third card", () =>
    Boolean(hosted.updater.status.scheduledRestart?.waitingFor.includes("open-question")),
  );
  report.hosted.waitingFor = hosted.updater.status.scheduledRestart?.waitingFor;
  await until("the hosted install after the maximum wait", () => hosted.updater.installs === 1);
  report.hosted.installsAfterMaximumWait = hosted.updater.installs;
  report.hosted.cardAtInstall = card(turn);
  assert.equal(report.hosted.cardAtInstall, "pending", "The hosted install did not ignore the open card.");
  await Effect.runPromise(hosted.requested.dispose());
  registry.clearPrompts();
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  session.close();
  await runCauseEffect(bridge.close()).catch(() => undefined);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(report.passed ? 0 : 1);
