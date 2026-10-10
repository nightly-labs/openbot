import { Effect } from "effect";
import type { BrowserOperationError } from "./browser-effects";

import { type ProviderClientOperationError, providerFailure } from "./provider-client-effects";
// @vitest-environment node

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent, BrowserControlState, BrowserTab, QueueSnapshot } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { afterAll, expect, vi } from "vitest";
import type { BrowserUploadHooks } from "./agent/browser-uploads";
import type { AgentClient, AgentProvider } from "./agent-client";
import { AgentService, type AgentServiceOptions } from "./agent-service";
import { AgentStore } from "./agent-store";
import { runCauseEffect } from "./effect-boundary";
import { MailboxStore } from "./mailbox-store";
import {
  type AppServerNotification,
  type DynamicToolCallParams,
  type DynamicToolResult,
  decodeThreadResponse,
  getArray,
  getRecord,
  getString,
  isRecord,
  type RequestId,
  type ResponseDecoder,
  type RpcError,
} from "./protocol";
import type { ProviderHistoryConsumer, ProviderHistoryRequest } from "./provider-history";
import { HARNESS_WAIT_TIMEOUT_MS } from "./test-deadlines";

export function codexConfigRead(servers: DynamicRecord = {}) {
  return {
    config: { mcp_servers: servers },
    layers: [
      {
        name: { type: "user", file: "/test/.codex/config.toml", profile: null },
        version: "config-version",
        config: { mcp_servers: servers },
      },
    ],
  };
}

export const CREATE_AGENT_INPUT = {
  name: "Planning Agent",
  description: "Builds clear plans for everyday tasks.",
  avatarSeed: "setup:planning",
  avatarHue: 215,
  initialMessage: "Help me make a practical plan.",
} as const;
export const EMPTY_LAYOUT = {
  revision: 0,
  sections: [],
  order: ["people", "unassigned"],
  agentAssignments: {},
  agentOrder: [],
};

const FAKE_RUNTIME_ENV_VARS = [
  "OPENBOT_FAKE_CODEX_LOG",
  "OPENBOT_FAKE_AGENT_TOOL",
  "OPENBOT_FAKE_AGENT_TOOL_PATHS",
  "OPENBOT_FAKE_AGENT_TOOL_CALLS",
  "OPENBOT_FAKE_THREAD_READ_DELAY",
  "OPENBOT_FAKE_AUTO_COMPLETE",
  "OPENBOT_FAKE_CONTEXT_USAGE",
  "OPENBOT_FAKE_COMPACTION_ERROR",
  "OPENBOT_FAKE_COMPACTION_DELAY",
  "OPENBOT_FAKE_ARCHIVED_THREAD",
  "OPENBOT_FAKE_TURN_START_RESPONSE_DELAY",
  "OPENBOT_FAKE_WARNING",
  "OPENBOT_FAKE_CLAUDE_LOGIN_LOG",
  "OPENBOT_FAKE_CODEX_CONFIG",
] as const;

const PROVIDER_PATH_ENV_VARS = [
  "OPENBOT_CODEX_PATH",
  "OPENBOT_CLAUDE_PATH",
  "OPENBOT_GROK_PATH",
  "OPENBOT_OPENCODE_PATH",
  "OPENBOT_CURSOR_PATH",
  "OPENBOT_CLINE_PATH",
  "OPENBOT_PI_PATH",
  "OPENBOT_MUSE_PATH",
] as const;

/** Provider paths as they were before any shard touched them. */
const originalProviderPaths = new Map(PROVIDER_PATH_ENV_VARS.map((name) => [name, process.env[name]]));

/**
 * Creates the temporary root for one AgentService test and points the provider
 * paths at a fresh fake Codex CLI. Every shard calls this from its beforeEach,
 * so the fake-runtime variables and the fixture layout live in one place.
 */
export async function startAgentTestFixture(): Promise<{ root: string; logPath: string }> {
  const root = await mkdtemp(join(tmpdir(), "openbot-agent-test-"));
  const logPath = join(root, "protocol.jsonl");
  process.env.OPENBOT_FAKE_CODEX_LOG = logPath;
  process.env.OPENBOT_CODEX_PATH = await fakeCodexCli();
  process.env.OPENBOT_CLAUDE_PATH = join(root, "missing-claude");
  process.env.OPENBOT_GROK_PATH = join(root, "missing-grok");
  process.env.OPENBOT_OPENCODE_PATH = join(root, "missing-opencode");
  process.env.OPENBOT_CURSOR_PATH = join(root, "missing-cursor");
  process.env.OPENBOT_CLINE_PATH = join(root, "missing-cline");
  process.env.OPENBOT_PI_PATH = join(root, "missing-pi");
  process.env.OPENBOT_MUSE_PATH = join(root, "missing-muse");
  return { root, logPath };
}

/**
 * Reverses startAgentTestFixture: stops the service, restores real timers and
 * the original provider paths, clears every OPENBOT_FAKE_* variable a test may
 * have set, and removes the temporary root.
 */
export async function stopAgentTestFixture(root: string, service: AgentService | null): Promise<void> {
  if (service) await runCauseEffect(service.stop());
  vi.useRealTimers();
  for (const [name, original] of originalProviderPaths) {
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  }
  for (const name of FAKE_RUNTIME_ENV_VARS) delete process.env[name];
  await rm(root, { recursive: true, force: true });
}

export class FakeAgentClient extends EventEmitter implements AgentClient {
  readonly readHistory = Effect.fn("FakeAgentClient.readHistory")(function* (
    this: FakeAgentClient,
    input: ProviderHistoryRequest,
    consume: ProviderHistoryConsumer,
  ) {
    const response = yield* this.request(
      "thread/read",
      { threadId: input.threadId, cwd: input.cwd, includeTurns: true },
      (value) => {
        const decoded = decodeThreadResponse(value);
        const rawTurns = getArray(isRecord(value) ? value.thread : null, "turns");
        for (const [index, turn] of (decoded.thread.turns ?? []).entries()) {
          const rawItems = getArray(rawTurns[index], "items");
          if (turn.items) {
            turn.items = turn.items.map((item, itemIndex) => ({
              ...(isRecord(rawItems[itemIndex]) ? rawItems[itemIndex] : {}),
              ...item,
            }));
          }
        }
        return decoded;
      },
    );
    for (const turn of (response.thread.turns ?? []).toReversed()) {
      if (
        !(yield* consume({
          turnId: turn.id,
          ...(turn.status ? { status: turn.status } : {}),
          items: input.items === "none" ? [] : (turn.items ?? []),
          complete: true,
        }))
      )
        break;
    }
  });
  readonly requests: Array<{ method: string; params: unknown }> = [];
  readonly responses: Array<{ id: RequestId; result: unknown }> = [];
  readonly errors: Array<{ id: RequestId; error: RpcError }> = [];
  readonly releasedThreads: string[] = [];
  #threadCounter = 0;
  /** Starts each session id. A second client of the same provider needs another, as real ids never repeat. */
  sessionIdPrefix: string | null = null;
  running = false;
  responseError: Error | null = null;
  modelList: ((params: unknown) => unknown) | undefined;
  threadRead: ((params: unknown) => unknown) | undefined;
  accountRateLimits: unknown = { rateLimits: null, rateLimitsByLimitId: null };
  /** The file-backed Codex configuration. Tests can replace it with an invalid response. */
  configRead: unknown = codexConfigRead();

  constructor(
    readonly provider: AgentProvider,
    readonly output = provider === "codex" ? "CODEX_DONE" : provider === "grok" ? "GROK_DONE" : "CLAUDE_DONE",
    readonly autoComplete = true,
    public accountSignedIn = true,
    private readonly requestDelays: Readonly<Record<string, number>> = {},
    private readonly requestHook?: (method: string, provider: AgentProvider) => Promise<void>,
  ) {
    super();
  }

  start(): void {
    this.running = true;
  }

  stop(): Effect.Effect<void, ProviderClientOperationError> {
    return Effect.sync(() => {
      this.running = false;
    });
  }

  releaseThread(externalThreadId: string): Effect.Effect<void, ProviderClientOperationError> {
    return Effect.sync(() => {
      this.releasedThreads.push(externalThreadId);
    });
  }

  request<T>(
    method: string,
    params: unknown,
    decoder: ResponseDecoder<T>,
  ): Effect.Effect<T, ProviderClientOperationError> {
    return Effect.gen({ self: this }, function* () {
      this.requests.push({ method, params: structuredClone(params) });
      const requestHook = this.requestHook;
      if (requestHook)
        yield* Effect.tryPromise({ try: () => requestHook(method, this.provider), catch: providerFailure });
      const delayMs = this.requestDelays[method] ?? 0;
      if (delayMs > 0) yield* Effect.sleep(delayMs);
      let result: unknown;
      if (method === "initialize") result = {};
      if (method === "account/read") {
        result = {
          account: this.accountSignedIn
            ? {
                type: this.provider === "codex" ? "chatgpt" : this.provider,
                email: `${this.provider}@example.com`,
              }
            : null,
          requiresOpenaiAuth: false,
        };
      }
      if (method === "account/login/start") {
        // The two shapes the real app server answers with: a URL this computer opens, or a code the
        // user types elsewhere. Which one comes back is decided by what the caller asked for.
        result =
          isDynamicRecord(params) && params.type === "chatgptDeviceCode"
            ? {
                type: "chatgptDeviceCode",
                loginId: "login-1",
                verificationUrl: "https://auth.openai.test/device",
                userCode: "TEST-CODE",
              }
            : { type: "chatgpt", loginId: "login-1", authUrl: "https://auth.openai.test/connect" };
      }
      if (method === "account/login/cancel") result = { status: "cancelled" };
      if (method === "account/rateLimits/read") {
        result = this.accountRateLimits;
      }
      if (method === "model/list") {
        result = {
          data:
            this.provider === "codex"
              ? [
                  "gpt-reserve",
                  "gpt-6-luna",
                  "gpt-5.6-luna",
                  "gpt-5.6-terra",
                  "gpt-5.6-sol",
                  "gpt-5.5",
                  "gpt-5.4",
                  "gpt-5.4-mini",
                  "gpt-5.3-codex-spark",
                  "codex-auto-review",
                ].map((model) => ({ model }))
              : this.provider === "opencode"
                ? [{ model: "opencode/example-model" }]
                : this.provider === "grok"
                  ? ["grok-4.5", "grok-fast"].map((model) => ({ model }))
                  : ["claude-haiku-5-5", "claude-fable-5", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5"].map(
                      (model) => ({
                        model,
                      }),
                    ),
        };
      }
      if (method === "model/list" && this.modelList) result = this.modelList(params);
      if (method === "plugin/list") result = { marketplaces: [] };
      if (method === "config/read") result = this.configRead;
      if (method === "config/batchWrite") {
        for (const edit of getArray(params, "edits")) {
          const config = getRecord(this.configRead, "config");
          const layers = getArray(this.configRead, "layers");
          const userLayer = layers.find((layer) => getString(getRecord(layer, "name"), "type") === "user");
          const saved = getRecord(userLayer, "config");
          const name = getString(edit, "keyPath")?.replace(/^mcp_servers\./u, "");
          const value = getRecord(edit, "value");
          if (name && value && config && saved && isRecord(this.configRead) && isRecord(userLayer)) {
            this.configRead = {
              ...this.configRead,
              config: { ...config, mcp_servers: { ...getRecord(config, "mcp_servers"), [name]: value } },
              layers: layers.map((layer) =>
                layer === userLayer
                  ? {
                      ...userLayer,
                      config: { ...saved, mcp_servers: { ...getRecord(saved, "mcp_servers"), [name]: value } },
                    }
                  : layer,
              ),
            };
          }
        }
        result = {};
      }
      if (method === "config/value/write") result = {};
      if (method === "thread/start") {
        this.#threadCounter += 1;
        result = { thread: { id: `${this.sessionIdPrefix ?? this.provider}-session-${this.#threadCounter}` } };
      }
      if (method === "thread/resume") {
        result = { thread: { id: stringParam(params, "threadId") } };
      }
      if (method === "thread/read") {
        result = this.threadRead?.(params) ?? { thread: { id: stringParam(params, "threadId"), turns: [] } };
      }
      if (method === "thread/compact/start" || method === "turn/interrupt") result = {};
      if (method === "turn/steer") {
        result = { turnId: stringParam(params, "expectedTurnId") };
      }
      if (method === "turn/start") {
        const threadId = stringParam(params, "threadId");
        const turnId = randomUUID();
        const itemId = `${turnId}:assistant`;
        const text = this.output;
        setTimeout(() => {
          if (!this.running) return;
          this.emit("notification", notification("turn/started", { threadId, turn: { id: turnId } }));
          if (!this.autoComplete) return;
          this.emit(
            "notification",
            notification("item/started", {
              threadId,
              turnId,
              item: { id: itemId, type: "agentMessage", text: "" },
            }),
          );
          this.emit("notification", notification("item/agentMessage/delta", { threadId, turnId, itemId, delta: text }));
          this.emit(
            "notification",
            notification("item/completed", {
              threadId,
              turnId,
              item: { id: itemId, type: "agentMessage", text },
            }),
          );
          this.emit(
            "notification",
            notification("turn/completed", {
              threadId,
              turn: { id: turnId, status: "completed" },
            }),
          );
        }, 0);
        result = { turn: { id: turnId, status: "inProgress", items: [] } };
      }
      if (result === undefined) throw new Error(`Fake client does not implement ${method}.`);
      return decoder(result);
    }).pipe(Effect.catchDefect((cause) => Effect.fail(providerFailure(cause))));
  }

  notify(): void {}

  completeLogin(success: boolean): void {
    this.accountSignedIn = success;
    this.emit(
      "notification",
      notification("account/login/completed", { loginId: "login-1", success, error: success ? null : "denied" }),
    );
  }

  respond(id: RequestId, result: unknown): void {
    if (this.responseError) throw this.responseError;
    this.responses.push({ id, result: structuredClone(result) });
  }

  respondError(id: RequestId, error: RpcError): void {
    this.errors.push({ id, error: structuredClone(error) });
  }
}

export async function callOpenBotTool(
  client: FakeAgentClient,
  threadId: string,
  tool: string,
  args: unknown,
  turnId = "routine-tool-turn",
  callId: string = randomUUID(),
): Promise<{ result?: unknown; error?: RpcError }> {
  const id = `openbot-tool-${randomUUID()}`;
  client.emit("request", {
    id,
    method: "item/tool/call",
    params: {
      threadId,
      turnId,
      callId,
      namespace: "openbot",
      tool,
      arguments: args,
    },
  });
  await waitFor(
    () =>
      client.responses.some((response) => response.id === id) || client.errors.some((response) => response.id === id),
  );
  const response = client.responses.find((item) => item.id === id);
  if (response) return { result: response.result };
  return { error: client.errors.find((item) => item.id === id)?.error };
}

export function openBotToolPayload(result: unknown): DynamicRecord {
  const contentItems = paramsRecord(result)?.contentItems;
  const text = Array.isArray(contentItems) ? getString(contentItems[0], "text") : null;
  if (!text) throw new Error("The OpenBot tool response has no text payload.");
  const payload = JSON.parse(text);
  if (!isDynamicRecord(payload)) throw new Error("The OpenBot tool response payload is invalid.");
  return payload;
}

export async function expectOpenBotToolError(
  client: FakeAgentClient,
  threadId: string,
  tool: string,
  args: unknown,
  message: string,
  turnId?: string,
): Promise<void> {
  const result = await callOpenBotTool(client, threadId, tool, args, turnId);
  expect(result.result).toBeUndefined();
  expect(result.error?.message).toContain(message);
}

/** A tool that refuses with `openBotToolFailure`: the model reads the reason, no JSON-RPC fault. */
export async function expectOpenBotToolFailure(
  client: FakeAgentClient,
  threadId: string,
  tool: string,
  args: unknown,
  message: string,
  turnId?: string,
): Promise<void> {
  const result = await callOpenBotTool(client, threadId, tool, args, turnId);
  expect(result.error).toBeUndefined();
  expect(paramsRecord(result.result)?.success).toBe(false);
  expect(openBotToolPayload(result.result).error).toContain(message);
}

export function notification(method: string, params: unknown): AppServerNotification {
  return { method, params };
}

function stringParam(value: unknown, key: string): string {
  if (!isDynamicRecord(value)) throw new Error(`${key} is missing.`);
  const result = value[key];
  if (!isString(result)) throw new Error(`${key} is missing.`);
  return result;
}

export function paramsRecord(value: unknown): DynamicRecord | null {
  return isDynamicRecord(value) ? value : null;
}

export function firstInputText(value: unknown): string | null {
  const input = paramsRecord(value)?.input;
  if (!Array.isArray(input)) return null;
  return getString(input[0], "text");
}

export function inputRecords(value: unknown): DynamicRecord[] {
  const input = paramsRecord(value)?.input;
  return Array.isArray(input) ? input.filter(isDynamicRecord) : [];
}

export function stores(root: string): { store: AgentStore; mailbox: MailboxStore } {
  const store = new AgentStore(join(root, "user-data"), join(root, "home"));
  return { store, mailbox: new MailboxStore(join(root, "user-data"), store.sharedRoot, store.database) };
}

/**
 * The single stub for `AgentBrowserHost`. Every field is a plain property so a test can replace one and
 * keep the rest; the upload hooks are driven by default, because a stub that accepted files without ever
 * reporting them assigned would let `BrowserUploads` retain a staging directory no test ever frees.
 */
export function fakeBrowser(tabs: BrowserTab[] = [], uploadTarget = { inputId: "input-1", documentId: "document-1" }) {
  return {
    onChanged: (_listener: (tabs: BrowserTab[], activeTabId: string | null) => void) => () => undefined,
    onControlChanged: (_listener: (state: BrowserControlState) => void) => () => undefined,
    onDocumentChanged: (_listener: (tabId: string, documentIds: ReadonlySet<string>) => void) => () => undefined,
    clearControls: () => undefined,
    endControl: () => undefined,
    listTabs: () => tabs,
    // Annotated rather than inferred: `=> undefined` would give these properties a return type no
    // block-bodied replacement can satisfy, and replacing one is the whole point of the plain property.
    beginTakeover: (_tabId: string): Effect.Effect<void, BrowserOperationError> => Effect.void,
    endTakeover: (_tabId: string): void => undefined,
    close: (_tabId: string): Effect.Effect<void, BrowserOperationError> => Effect.void,
    resolveUploadTarget: (
      _params: DynamicToolCallParams,
    ): Effect.Effect<{ inputId: string; documentId: string }, BrowserOperationError> => Effect.succeed(uploadTarget),
    handleDynamicTool: (
      _params: DynamicToolCallParams,
      hooks?: BrowserUploadHooks,
    ): Effect.Effect<DynamicToolResult, BrowserOperationError> =>
      Effect.sync(() => {
        hooks?.onUploadTargetResolved?.(uploadTarget.inputId, uploadTarget.documentId);
        hooks?.onUploadAssigned?.(uploadTarget.inputId, uploadTarget.documentId);
        return { success: true, contentItems: [] };
      }),
  };
}

/**
 * `AgentService` with the arguments every test here would otherwise repeat. The browser stub and the
 * request timeout are harness defaults, not assertions: a test that cares about either one passes its
 * own value and overrides the default.
 */
export function createTestService(
  options: Partial<AgentServiceOptions> & Pick<AgentServiceOptions, "store" | "mailbox">,
): AgentService {
  return new AgentService({ browser: fakeBrowser(), requestTimeoutMs: 30_000, ...options });
}

/**
 * The service every test here starts from: stores under `root`, and `initialize()` already awaited.
 *
 * Whether the agents get a fake client or the real spawned CLI is the caller's choice, and the two
 * are not interchangeable - a `clientFactory` is what keeps a case from starting a child process.
 * Passing any of `provider`, `output`, `autoComplete` or `client` installs the fake; passing none of
 * them leaves `clientFactory` unset, so the service spawns the fake CLI that `startAgentTestFixture`
 * wrote. `provider` names the client's provider only: which provider the service prefers stays
 * `preferredProvider`, passed through, because the two are not the same choice.
 *
 * `client` is built eagerly, so a case can arm it before the first turn reaches it - which is what
 * the hand-written preamble did by constructing the client above `createTestService`. `clients`
 * collects every client handed out, in order, and `clientFor` answers with the most recent one for a
 * provider, which is the question the per-provider `Map` in these files was built to answer.
 */
export interface StartServiceOptions extends Partial<Omit<AgentServiceOptions, "store" | "mailbox">> {
  /** Installs the fake client, and names the provider it answers as. */
  provider?: AgentProvider;
  /** The fake client's completion marker. Left unset, each provider uses its own default. */
  output?: string;
  autoComplete?: boolean;
  /** Builds the client for a provider, for the cases that vary it per provider. */
  client?: (provider: AgentProvider) => FakeAgentClient;
}

export interface StartedService {
  service: AgentService;
  /** The client for the preferred provider. Meaningless when no fake was installed. */
  client: FakeAgentClient;
  clients: FakeAgentClient[];
  clientFor: (provider: AgentProvider) => FakeAgentClient | undefined;
  store: AgentStore;
  mailbox: MailboxStore;
}

export async function startService(root: string, options: StartServiceOptions = {}): Promise<StartedService> {
  const { provider, output, autoComplete, client: build, ...serviceOptions } = options;
  const fake = provider !== undefined || output !== undefined || autoComplete !== undefined || build !== undefined;
  const preferred = provider ?? serviceOptions.preferredProvider ?? "codex";
  const { store, mailbox } = stores(root);
  const client = new FakeAgentClient(preferred, output, autoComplete);
  const clients: FakeAgentClient[] = [];
  const service = createTestService({
    store,
    mailbox,
    ...(fake
      ? {
          clientFactory: (requested: AgentProvider) => {
            const made = build
              ? build(requested)
              : requested === preferred
                ? client
                : new FakeAgentClient(requested, output, autoComplete);
            clients.push(made);
            return made;
          },
        }
      : {}),
    ...serviceOptions,
  });
  await runCauseEffect(service.initialize());
  return {
    service,
    client,
    clients,
    clientFor: (wanted) => clients.findLast((made) => made.provider === wanted),
    store,
    mailbox,
  };
}

export function nextRoutinesChanged(agentService: AgentService, agentId: string): Promise<void> {
  return new Promise((resolve) => {
    const listener = (event: AgentEvent) => {
      if (event.type !== "routines-changed" || event.agentId !== agentId) return;
      agentService.off("event", listener);
      resolve();
    };
    agentService.on("event", listener);
  });
}

/**
 * Waits for a queue of one agent to pass `check`, without polling. It checks the queue now and then
 * on each `queue-changed` event. A change after the call that the service writes without an event
 * times out here. A change before the call passes the first check and needs no event.
 */
export function waitForQueue(
  agentService: AgentService,
  agentId: string,
  check: (queue: QueueSnapshot) => boolean,
): Promise<void> {
  if (check(agentService.listQueue(agentId))) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const listener = (event: AgentEvent) => {
      if (event.type !== "queue-changed" || event.snapshot.agentId !== agentId || !check(event.snapshot)) return;
      clearTimeout(timeout);
      agentService.off("event", listener);
      resolve();
    };
    const timeout = setTimeout(() => {
      agentService.off("event", listener);
      const statuses = agentService
        .listQueue(agentId)
        .deliveries.map((delivery) => delivery.status)
        .join(", ");
      reject(
        new Error(
          `Timed out after ${HARNESS_WAIT_TIMEOUT_MS}ms waiting for the queue of ${agentId}: ${check.toString()}. Statuses: ${statuses || "none"}.`,
        ),
      );
    }, HARNESS_WAIT_TIMEOUT_MS);
    agentService.on("event", listener);
  });
}

export async function protocolMessages(logPath: string): Promise<DynamicRecord[]> {
  try {
    return (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter(isDynamicRecord);
  } catch {
    return [];
  }
}

export async function waitFor(check: () => boolean | undefined | Promise<boolean | undefined>): Promise<void> {
  const deadline = Date.now() + HARNESS_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  // The predicate's own source names the condition, which every call site
  // already spells out, so no call site has to repeat it as a description.
  const condition = check.toString().replace(/\s+/g, " ").trim();
  throw new Error(
    `Timed out after ${HARNESS_WAIT_TIMEOUT_MS}ms waiting for: ${condition.length > 200 ? `${condition.slice(0, 200)}…` : condition}`,
  );
}

/**
 * The fake CLIs, written once for each test file and not once for each test. macOS checks an
 * executable the first time it runs from a new path, and that check cost about 200 ms in every test
 * that wrote its own copy. A fake's source is fixed: a test changes what it does through the
 * `OPENBOT_FAKE_*` variables, so no test can change the file that the next test runs.
 */
let fakeCliDirectory: Promise<string> | null = null;
const fakeClis = new Map<string, Promise<string>>();

afterAll(async () => {
  if (fakeCliDirectory) await rm(await fakeCliDirectory, { recursive: true, force: true });
});

function sharedFakeCli(name: string, source: string): Promise<string> {
  let executable = fakeClis.get(name);
  if (!executable) {
    executable = (async () => {
      fakeCliDirectory ??= mkdtemp(join(tmpdir(), "openbot-fake-cli-"));
      const path = join(await fakeCliDirectory, name);
      await writeFile(path, source, { mode: 0o755 });
      return path;
    })();
    fakeClis.set(name, executable);
  }
  return executable;
}

export function fakeCodexCli(): Promise<string> {
  return sharedFakeCli(
    "codex",
    `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.156.0\\n");
  process.exit(0);
}
const log = process.env.OPENBOT_FAKE_CODEX_LOG;
const configRead = process.env.OPENBOT_FAKE_CODEX_CONFIG
  ? JSON.parse(process.env.OPENBOT_FAKE_CODEX_CONFIG)
  : ${JSON.stringify(codexConfigRead())};
let buffer = "";
let threadCounter = 0;
let turnCounter = 0;
const turns = new Map();
let archivedThread = process.env.OPENBOT_FAKE_ARCHIVED_THREAD === "1";
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line) {
      const message = JSON.parse(line);
      fs.appendFileSync(log, JSON.stringify(message) + "\\n");
      if (message.method === "initialize") write({ id: message.id, result: {} });
      if (message.method === "account/read") write({ id: message.id, result: { account: { type: "chatgpt", email: "codex@example.com" } } });
      if (message.method === "account/rateLimits/read") write({ id: message.id, result: { rateLimits: { limitId: "codex", primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1786563600 }, secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: 1787040000 } }, rateLimitsByLimitId: null } });
      if (message.method === "model/list") write({ id: message.id, result: { data: [
        { model: "gpt-6-luna", displayName: "GPT-6 Luna", defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "medium" }, { reasoningEffort: "high" }] },
        { model: "gpt-5.6-luna", displayName: "GPT-5.6 Luna", defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "medium" }, { reasoningEffort: "high" }] },
        { model: "gpt-5.6-terra", displayName: "GPT-5.6 Terra", defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "medium" }, { reasoningEffort: "high" }] },
        { model: "gpt-5.6-sol", displayName: "GPT-5.6 Sol", defaultReasoningEffort: "high", supportedReasoningEfforts: [{ reasoningEffort: "medium" }, { reasoningEffort: "high" }, { reasoningEffort: "xhigh" }] },
        { model: "gpt-5.5", displayName: "GPT-5.5" },
        { model: "gpt-5.4", displayName: "GPT-5.4" },
        { model: "gpt-5.4-mini", displayName: "GPT-5.4-Mini" },
        { model: "gpt-5.3-codex-spark", displayName: "GPT-5.3-Codex-Spark" }
      ] } });
      if (message.method === "plugin/list") write({ id: message.id, result: { marketplaces: [{ plugins: [{ id: "computer-use@openai-bundled", name: "computer-use", installed: true, enabled: true }] }] } });
      // The sweep that turns off the servers of the user's own Codex file reads this before every
      // thread starts. An unanswered request holds that start open until the request times out,
      // which is the failure this fake exists to make visible rather than hide.
      if (message.method === "config/read") write({ id: message.id, result: configRead });
      if (message.method === "config/batchWrite") {
        for (const edit of message.params.edits) {
          const name = edit.keyPath.replace(/^mcp_servers\\./u, "");
          configRead.config.mcp_servers[name] = edit.value;
          const userLayer = configRead.layers.find((layer) => layer.name.type === "user");
          userLayer.config.mcp_servers[name] = edit.value;
        }
        write({ id: message.id, result: {} });
      }
      if (message.method === "thread/start") {
        const threadId = "thread-" + (++threadCounter);
        write({ id: message.id, result: { thread: { id: threadId, turns: [] } } });
      }
      if (message.method === "thread/resume") {
        if (archivedThread) write({ id: message.id, error: { code: -32600, message: "session " + message.params.threadId + " is archived. Run codex unarchive " + message.params.threadId + " to unarchive it first." } });
        else write({ id: message.id, result: { thread: { id: message.params.threadId, turns: [] } } });
      }
      if (message.method === "thread/unsubscribe") {
        write({ id: message.id, result: { status: "Unsubscribed" } });
      }
      if (message.method === "thread/unarchive") {
        archivedThread = false;
        write({ id: message.id, result: { thread: { id: message.params.threadId, turns: [] } } });
      }
      if (message.method === "thread/turns/list") {
        const offset = Number(message.params.cursor || 0);
        const all = [...turns.values()].reverse();
        const data = all.slice(offset, offset + message.params.limit).map(({ items, ...turn }) => turn);
        const nextCursor = offset + data.length < all.length ? String(offset + data.length) : null;
        const respond = () => write({ id: message.id, result: { data, nextCursor } });
        const delay = Number(process.env.OPENBOT_FAKE_THREAD_READ_DELAY || 0);
        if (delay > 0) setTimeout(respond, delay);
        else respond();
      }
      if (message.method === "thread/items/list") {
        const offset = Number(message.params.cursor || 0);
        const all = turns.get(message.params.turnId)?.items || [];
        const data = all.slice(offset, offset + message.params.limit).map(item => ({ turnId: message.params.turnId, item }));
        write({ id: message.id, result: { data, nextCursor: offset + data.length < all.length ? String(offset + data.length) : null } });
      }
      if (message.method === "thread/read") {
        const capturedTurns = JSON.parse(JSON.stringify([...turns.values()]));
        const respond = () => write({ id: message.id, result: { thread: { id: message.params.threadId, turns: capturedTurns } } });
        const delay = Number(process.env.OPENBOT_FAKE_THREAD_READ_DELAY || 0);
        if (delay > 0) setTimeout(respond, delay);
        else respond();
      }
      if (message.method === "turn/start") {
        const turnId = "turn-" + (++turnCounter);
        turns.set(turnId, { id: turnId, status: "inProgress", items: [] });
        const respondToStart = () => write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
        const startResponseDelay = Number(process.env.OPENBOT_FAKE_TURN_START_RESPONSE_DELAY || 0);
        if (startResponseDelay > 0) setTimeout(respondToStart, startResponseDelay);
        else respondToStart();
        write({ method: "turn/started", params: { threadId: message.params.threadId, turn: { id: turnId } } });
        if (process.env.OPENBOT_FAKE_WARNING) {
          write({ method: "warning", params: { threadId: message.params.threadId, message: process.env.OPENBOT_FAKE_WARNING } });
        }
        if (process.env.OPENBOT_FAKE_CONTEXT_USAGE) {
          const totalTokens = Number(process.env.OPENBOT_FAKE_CONTEXT_USAGE);
          write({ method: "thread/tokenUsage/updated", params: { threadId: message.params.threadId, turnId, tokenUsage: { total: { totalTokens }, last: { totalTokens }, modelContextWindow: 100000 } } });
        }
        write({ method: "item/agentMessage/delta", params: { threadId: message.params.threadId, turnId, itemId: "message-" + turnId, delta: "Streaming" } });
        if (process.env.OPENBOT_FAKE_AGENT_TOOL === "1" && turnCounter === 1) {
          setTimeout(() => write({ id: "agent-tool-1", method: "item/tool/call", params: { threadId: message.params.threadId, turnId, callId: "call-1", namespace: "openbot", tool: "send_message", arguments: { recipientAgentIds: ["sales-outbound", "inbox-manager"], text: "Please prepare your reports.", paths: JSON.parse(process.env.OPENBOT_FAKE_AGENT_TOOL_PATHS || "[]") } } }), 30);
        }
        if (process.env.OPENBOT_FAKE_AGENT_TOOL_CALLS && turnCounter === 1) {
          const calls = JSON.parse(process.env.OPENBOT_FAKE_AGENT_TOOL_CALLS);
          calls.forEach((call, index) => setTimeout(() => write({
            id: "agent-tool-configured-" + index,
            method: "item/tool/call",
            params: {
              threadId: message.params.threadId,
              turnId,
              callId: "configured-call-" + index,
              namespace: "openbot",
              tool: call.tool,
              arguments: call.arguments,
            },
          }), 30 + index * 30));
        }
        if (process.env.OPENBOT_FAKE_AUTO_COMPLETE) {
          setTimeout(() => {
            const text = process.env.OPENBOT_FAKE_AUTO_COMPLETE;
            const item = { type: "agentMessage", id: "message-" + turnId, text, phase: "final_answer" };
            const turn = turns.get(turnId);
            if (turn) {
              turn.status = "completed";
              turn.items = [item];
            }
            write({ method: "item/completed", params: { threadId: message.params.threadId, turnId, item } });
            write({ method: "turn/completed", params: { threadId: message.params.threadId, turn: { id: turnId, status: "completed" } } });
          }, 20);
        }
      }
      if (message.method === "thread/compact/start") {
        if (process.env.OPENBOT_FAKE_COMPACTION_ERROR === "1") {
          write({ id: message.id, error: { code: -32601, message: "Compaction unavailable" } });
          newline = buffer.indexOf("\\n");
          continue;
        }
        const turnId = "compact-turn-" + (++turnCounter);
        const item = { type: "contextCompaction", id: "compact-item-" + turnId };
        write({ id: message.id, result: {} });
        write({ method: "turn/started", params: { threadId: message.params.threadId, turn: { id: turnId } } });
        write({ method: "item/started", params: { threadId: message.params.threadId, turnId, item } });
        write({ method: "item/completed", params: { threadId: message.params.threadId, turnId, item } });
        const finish = () => write({ method: "turn/completed", params: { threadId: message.params.threadId, turn: { id: turnId, status: "completed" } } });
        const compactionDelay = Number(process.env.OPENBOT_FAKE_COMPACTION_DELAY || 0);
        if (compactionDelay > 0) setTimeout(finish, compactionDelay);
        else finish();
      }
      if (message.method === "turn/interrupt") {
        write({ id: message.id, result: {} });
        const turn = turns.get(message.params.turnId);
        if (turn) turn.status = "interrupted";
        write({ method: "turn/completed", params: { threadId: message.params.threadId, turn: { id: message.params.turnId, status: "interrupted" } } });
      }
    }
    newline = buffer.indexOf("\\n");
  }
});
`,
  );
}

/** A signed-in Claude CLI. Each version is its own file, so a test can install a newer one beside it. */
export function fakeClaudeCli(version = "2.1.246"): Promise<string> {
  return sharedFakeCli(
    `claude-${version}`,
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\\n' '${version} (Claude Code)'
elif [ "$1" = "auth" ]; then
  printf '%s' '{"loggedIn":true,"email":"claude@example.com","subscriptionType":"max"}'
fi
`,
  );
}

/**
 * A Claude CLI that can update itself: `claude update` writes the marker, and every later
 * `--version` reports `updatedVersion`, the way a real self-update changes the binary underfoot.
 * The marker path is also what a test reads to see whether the updater ran at all.
 */
/**
 * A fake Claude CLI that can update itself. With `gate`, the updater waits for that file to
 * appear, which is how a test holds the CLI in mid-replacement and acts while it is there.
 */
export async function createUpdatableFakeClaude(
  directory: string,
  updatedVersion: string,
  updateError?: string,
  gate?: string,
): Promise<{ executable: string; marker: string; started: string }> {
  const executable = join(directory, "claude-updatable");
  const marker = join(directory, "claude-update-marker");
  const started = join(directory, "claude-update-started");
  await writeFile(
    executable,
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  if [ -f '${marker}' ]; then
    printf '%s\\n' '${updatedVersion} (Claude Code)'
  else
    printf '%s\\n' '2.1.246 (Claude Code)'
  fi
elif [ "$1" = "auth" ]; then
  printf '%s' '{"loggedIn":true,"email":"claude@example.com","subscriptionType":"max"}'
elif [ "$1" = "update" ]; then
  printf '%s\\n' 'started' > '${started}'
${gate ? `  while [ ! -f '${gate}' ]; do sleep 0.02; done` : ""}
${
  updateError
    ? `  printf '%s\\n' '${updateError}' >&2
  exit 1`
    : `  printf '%s\\n' 'updated' > '${marker}'`
}
fi
`,
  );
  await chmod(executable, 0o755);
  return { executable, marker, started };
}

export function pendingFakeClaudeCli(): Promise<string> {
  return sharedFakeCli(
    "claude-pending",
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\\n' '2.1.246 (Claude Code)'
elif [ "$1" = "auth" ] && [ "$2" = "login" ]; then
  printf '%s\\n' 'started' >> "$OPENBOT_FAKE_CLAUDE_LOGIN_LOG"
  trap 'printf "%s\\n" "stopped" >> "$OPENBOT_FAKE_CLAUDE_LOGIN_LOG"; exit 143' TERM INT
  while :; do sleep 0.1; done
elif [ "$1" = "auth" ]; then
  printf '%s' '{"loggedIn":false}'
fi
`,
  );
}

export async function readTextOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

export function fakeGrokCli(): Promise<string> {
  return sharedFakeCli(
    "grok",
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\\n' 'grok 1.0.5'
fi
`,
  );
}

export function fakeOpencodeCli(): Promise<string> {
  return sharedFakeCli("opencode", "#!/bin/sh\nprintf '1.3.13\\n'\n");
}
