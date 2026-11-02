import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { registerSecretValue } from "@openbot/logging";
import { Effect } from "effect";
import {
  GrokBotAccountFailed,
  type GrokBotAccountRecord,
  type GrokBotAccountStore,
  type GrokBotGatewaySession,
  isSharedCursorVmUrl,
} from "./grok-bot-account";
import { type GrokBotComputerStatus, parseGrokBotComputerStatus } from "./grok-bot-computer";
import {
  type GrokBotLocalHost,
  GrokBotLocalHostFailed,
  grokBotLocalHost,
  OPENBOT_LOCAL_GATEWAY_URL,
  openBotLocalGatewaySession,
} from "./grok-bot-local-host";

/** `grokbot_api` 1.2.0 `DEFAULT_CLIENT_VERSION`. This is a header, not a protocol registration. */
export const GROK_BOT_CURSOR_CLIENT_VERSION = "0.70.2";
const BODY_LIMIT = 2 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

export interface GrokBotAgentSummary {
  id: string;
  name: string;
  title: string;
  description: string;
  hidden: boolean;
  room: boolean;
}

export interface CreateGrokBotAgentInput {
  name: string;
  description: string;
}

export interface GrokBotGatewayCallOptions {
  fetchImpl?: typeof fetch;
  apiBaseUrl?: string;
  now?: () => number;
  /**
   * Test hook for a fake gateway on `127.0.0.1`. The product path leaves this false.
   * It does not select the shared box.
   */
  allowLoopback?: boolean;
  /** The private host. Absent, the host for the account directory is used. */
  localHost?: GrokBotLocalHost;
  /** How many status reads follow `ensureForeverBox` while the desktop is still starting. */
  readyAttempts?: number;
  readyDelayMs?: number;
}

export const listGrokBotAgents = Effect.fn("GrokBotGateway.list")(function* (
  store: GrokBotAccountStore,
  options: GrokBotGatewayCallOptions,
) {
  const body = yield* gatewayJson(store, options, "/api/listAgents", {});
  return parseAgents(body);
});

/** Raw `POST /api/listAgents` body. The turn watch reads `isRunning` from it. */
export const readGrokBotRoster = Effect.fn("GrokBotGateway.roster")(function* (
  store: GrokBotAccountStore,
  options: GrokBotGatewayCallOptions,
) {
  return yield* gatewayJson(store, options, "/api/listAgents", {});
});

export const createGrokBotAgent = Effect.fn("GrokBotGateway.create")(function* (
  store: GrokBotAccountStore,
  input: CreateGrokBotAgentInput,
  options: GrokBotGatewayCallOptions,
) {
  const name = input.name.trim();
  if (name.length === 0 || name.length > 80)
    return yield* Effect.fail(accountFailure("error.provider.grokBotNameRequired"));
  if (input.description.length > 2000) return yield* Effect.fail(accountFailure("error.provider.grokBotAgentRejected"));
  const body = yield* gatewayJson(store, options, "/api/createAgent", {
    name,
    description: input.description,
    title: "",
    avatarShape: "",
    avatarColor: "",
    origin: "user",
  });
  const created = parseCreated(body);
  if (!created) return yield* Effect.fail(accountFailure("error.provider.grokBotAgentRejected"));
  return created;
});

/** BotAI `getAgentTranscriptTail`: `POST /api/getAgentTranscriptTail` with `{ id, limit }`. */
export const readGrokBotTranscript = Effect.fn("GrokBotGateway.transcript")(function* (
  store: GrokBotAccountStore,
  agentId: string,
  options: GrokBotGatewayCallOptions,
) {
  return yield* gatewayJson(store, options, "/api/getAgentTranscriptTail", { id: agentId, limit: 200 });
});

/** BotAI `getForeverBoxStatus {}`: the sand computer, with its screen URL rewritten off loopback. */
export const readGrokBotComputer = Effect.fn("GrokBotGateway.computerStatus")(function* (
  store: GrokBotAccountStore,
  options: GrokBotGatewayCallOptions,
) {
  return yield* computerCall(store, options, "/api/getForeverBoxStatus", {});
});

/** BotAI `ensureForeverBox {}`: creates or wakes the sand computer (what "Open computer" does). */
const ensureGrokBotComputer = Effect.fn("GrokBotGateway.computerEnsure")(function* (
  store: GrokBotAccountStore,
  options: GrokBotGatewayCallOptions,
) {
  return yield* computerCall(store, options, "/api/ensureForeverBox", {});
});

const WAITING_COMPUTER = new Set(["starting", "pulling", "sleeping"]);

/**
 * BotAI `ensureReady`: one `ensureForeverBox`, then status reads until the desktop is up.
 * A box that stays off is returned as it is. The caller still decides whether to open the screen.
 */
export const ensureGrokBotComputerReady = Effect.fn("GrokBotGateway.computerReady")(function* (
  store: GrokBotAccountStore,
  options: GrokBotGatewayCallOptions,
) {
  const attempts = options.readyAttempts ?? 4;
  const delayMs = options.readyDelayMs ?? 500;
  let status = yield* ensureGrokBotComputer(store, options);
  let reads = 0;
  while (WAITING_COMPUTER.has(status.phase) && reads < attempts - 1) {
    reads += 1;
    if (delayMs > 0) yield* Effect.sleep(delayMs);
    status = yield* readGrokBotComputer(store, options);
  }
  return status;
});

/**
 * BotAI `captureRoutedComputerScreenshot`. The in-box host runs the screenshot on the sand desktop.
 */
export const captureGrokBotComputerScreenshot = Effect.fn("GrokBotGateway.computerScreenshot")(function* (
  store: GrokBotAccountStore,
  agentId: string,
  options: GrokBotGatewayCallOptions,
) {
  return yield* gatewayJson(store, options, "/api/captureRoutedComputerScreenshot", { agentId });
});

/** The Computer tool object BotAI sends to `executeRoutedComputerAction`. */
export interface GrokBotComputerToolArgs {
  readonly action: "screenshot" | "click" | "move" | "drag" | "type" | "key" | "scroll" | "wait";
  readonly x?: number;
  readonly y?: number;
  readonly x2?: number;
  readonly y2?: number;
  readonly text?: string;
  readonly key?: string;
  readonly button?: "left" | "right" | "middle";
  readonly count?: number;
  readonly direction?: "up" | "down" | "left" | "right";
  readonly amount?: number;
  readonly durationMs?: number;
  readonly description?: string;
}

/**
 * BotAI `executeRoutedComputerAction`. The in-box host turns `args` into `cua-driver` calls.
 * This is not the host-tool local-exec loop.
 */
export const executeGrokBotComputerAction = Effect.fn("GrokBotGateway.computerAction")(function* (
  store: GrokBotAccountStore,
  input: { readonly agentId: string; readonly args: GrokBotComputerToolArgs; readonly toolCallId?: string },
  options: GrokBotGatewayCallOptions,
) {
  return yield* gatewayJson(store, options, "/api/executeRoutedComputerAction", {
    agentId: input.agentId,
    args: input.args,
    ...(input.toolCallId === undefined ? {} : { toolCallId: input.toolCallId }),
  });
});

/** BotAI `handBackForeverBox { id, trigger }`: "I'm done, continue" after an agent asked for a takeover. */
export const handBackGrokBotComputer = Effect.fn("GrokBotGateway.computerHandBack")(function* (
  store: GrokBotAccountStore,
  agentId: string,
  options: GrokBotGatewayCallOptions,
) {
  yield* gatewayJson(store, options, "/api/handBackForeverBox", { id: agentId, trigger: "button" });
});

const computerCall = Effect.fn("GrokBotGateway.computerCall")(function* (
  store: GrokBotAccountStore,
  options: GrokBotGatewayCallOptions,
  path: string,
  body: unknown,
) {
  const raw = yield* gatewayJson(store, options, path, body);
  const record = yield* store.load();
  return parseGrokBotComputerStatus(raw, record?.gateway?.vnc ?? null) satisfies GrokBotComputerStatus;
});

/**
 * BotAI's Mac app never calls `InferenceService/Stream` itself. It sends the turn to the in-box
 * Sand gateway (`POST /api/sendPrompt`); the box host runs inference with its own box-scoped
 * credential (`/sand-box/inference-credential`). A user sand token on Stream is unauthenticated.
 */
export const sendGrokBotPrompt = Effect.fn("GrokBotGateway.sendPrompt")(function* (
  store: GrokBotAccountStore,
  input: { agentId: string; prompt: string; clientNonce: string },
  options: GrokBotGatewayCallOptions,
) {
  return yield* gatewayJson(store, options, "/api/sendPrompt", {
    prompt: input.prompt,
    agentId: input.agentId,
    clientNonce: input.clientNonce,
    attachmentPaths: [],
    attachmentNames: [],
    enterEpochMs: Date.now(),
    composedAtMs: Date.now(),
  });
});

const gatewayJson = Effect.fn("GrokBotGateway.call")(function* (
  store: GrokBotAccountStore,
  options: GrokBotGatewayCallOptions,
  path: string,
  body: unknown,
) {
  let record = yield* store.load();
  if (!record) return yield* Effect.fail(accountFailure("error.provider.grokBotNotSignedIn"));
  record = yield* attachLocalGateway(store, record, options);
  let response = yield* postSession(record.gateway, path, body, options.fetchImpl);
  if (response.status === 401 || response.status === 417) {
    record = yield* retryLocalGatewayToken(store, record, options);
    response = yield* postSession(record.gateway, path, body, options.fetchImpl);
  }
  if (response.status === 401 || response.status === 417) {
    return yield* Effect.fail(accountFailure("error.provider.grokBotLocalHostFailed"));
  }
  if (response.status < 200 || response.status >= 300) {
    return yield* Effect.fail(accountFailure("error.provider.grokBotSessionEnded"));
  }
  return yield* readJson(response);
});

const attachLocalGateway = Effect.fn("GrokBotGateway.attach")(function* (
  store: GrokBotAccountStore,
  record: GrokBotAccountRecord,
  options: GrokBotGatewayCallOptions,
) {
  const loopback = options.allowLoopback === true;
  const current = record.gateway;
  if (loopback && current && acceptGatewayUrl(current.url, true)) return record;
  if (loopback) return yield* Effect.fail(accountFailure("error.provider.grokBotLocalHostFailed"));
  if (current && isSharedCursorVmUrl(current.url)) {
    const cleared: GrokBotAccountRecord = { ...record, gateway: null };
    yield* store.save(cleared);
    record = cleared;
  }
  const host = options.localHost ?? grokBotLocalHost(store.supportDirectory());
  const ready = yield* host
    .ensure()
    .pipe(
      Effect.mapError((error) =>
        accountFailure(
          error instanceof GrokBotLocalHostFailed && error.reason === "stopped"
            ? "error.provider.grokBotLocalHostStopped"
            : "error.provider.grokBotLocalHostFailed",
        ),
      ),
    );
  const gateway = openBotLocalGatewaySession(ready.token);
  if (
    record.gateway?.url === gateway.url &&
    record.gateway.token === gateway.token &&
    record.gateway.url === OPENBOT_LOCAL_GATEWAY_URL
  ) {
    return record;
  }
  const next: GrokBotAccountRecord = { ...record, gateway };
  yield* store.save(next);
  return next;
});

const retryLocalGatewayToken = Effect.fn("GrokBotGateway.retryLocal")(function* (
  store: GrokBotAccountStore,
  record: GrokBotAccountRecord,
  options: GrokBotGatewayCallOptions,
) {
  const gateway = record.gateway;
  if (!gateway || !acceptGatewayUrl(gateway.url, options.allowLoopback === true)) {
    return yield* Effect.fail(accountFailure("error.provider.grokBotLocalHostFailed"));
  }
  if (!options.allowLoopback && gateway.url !== OPENBOT_LOCAL_GATEWAY_URL) {
    return yield* Effect.fail(accountFailure("error.provider.grokBotLocalHostFailed"));
  }
  const host = options.localHost ?? grokBotLocalHost(store.supportDirectory());
  const token = yield* host.readToken();
  if (!token) return yield* Effect.fail(accountFailure("error.provider.grokBotLocalHostFailed"));
  if (token === gateway.token) return record;
  registerSecretValue(token);
  const next: GrokBotAccountRecord = { ...record, gateway: { ...gateway, token } };
  yield* store.save(next);
  return next;
});

function postSession(
  session: GrokBotGatewaySession | null,
  path: string,
  body: unknown,
  fetchImpl: typeof fetch | undefined,
) {
  if (!session) return Effect.fail(accountFailure("error.provider.grokBotSessionEnded"));
  const call = fetchImpl ?? fetch;
  return Effect.tryPromise({
    try: () =>
      call(new URL(path, session.url), {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${session.token}`,
          "Content-Type": "application/json",
          ...session.headers,
        },
        body: JSON.stringify(body),
      }),
    catch: () => accountFailure("error.provider.grokBotSessionEnded"),
  });
}

function readJson(response: Response) {
  return Effect.tryPromise({
    try: async () => {
      const text = await response.text();
      if (text.length > BODY_LIMIT) throw new Error(sourceText("error.provider.grokBotSessionEnded"));
      return text.length === 0 ? {} : JSON.parse(text);
    },
    catch: () => accountFailure("error.provider.grokBotSessionEnded"),
  });
}

function acceptGatewayUrl(value: string, allowLoopback: boolean): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username !== "" || url.password !== "") return false;
  if (isSharedCursorVmUrl(value)) return false;
  if (allowLoopback && url.hostname === "127.0.0.1") return url.protocol === "http:" || url.protocol === "https:";
  return (
    url.protocol === "http:" &&
    url.hostname === "127.0.0.1" &&
    url.port === "1340" &&
    (url.pathname === "" || url.pathname === "/") &&
    url.search === "" &&
    url.hash === ""
  );
}

function parseAgents(value: unknown): readonly GrokBotAgentSummary[] {
  const rows = Array.isArray(value)
    ? value
    : isDynamicRecord(value) && Array.isArray(value.agents)
      ? value.agents
      : isDynamicRecord(value) && value.agent !== undefined
        ? [value.agent]
        : [];
  const agents: GrokBotAgentSummary[] = [];
  for (const row of rows) {
    const agent = parseAgent(row);
    if (agent) agents.push(agent);
  }
  return agents;
}

function parseCreated(value: unknown): GrokBotAgentSummary | null {
  const row = isDynamicRecord(value) && value.agent !== undefined ? value.agent : value;
  return parseAgent(row);
}

function parseAgent(value: unknown): GrokBotAgentSummary | null {
  if (!isDynamicRecord(value)) return null;
  const id = typeof value.id === "string" ? value.id : typeof value.agentId === "string" ? value.agentId : "";
  if (id.length === 0) return null;
  const members = value.memberIds ?? value.memberAgentIds;
  const room = typeof value.isGroup === "boolean" ? value.isGroup : Array.isArray(members) && members.length > 0;
  const hiddenFlag = value.isHiddenFromSidebar ?? value.hiddenFromSidebar;
  return {
    id,
    name: typeof value.name === "string" ? value.name : "",
    title: typeof value.title === "string" ? value.title : "",
    description: typeof value.description === "string" ? value.description : "",
    hidden: hiddenFlag === true,
    room,
  };
}

function accountFailure(
  key:
    | "error.provider.grokBotNameRequired"
    | "error.provider.grokBotAgentRejected"
    | "error.provider.grokBotNotSignedIn"
    | "error.provider.grokBotSessionEnded"
    | "error.provider.grokBotLocalHostFailed"
    | "error.provider.grokBotLocalHostStopped",
): GrokBotAccountFailed {
  return new GrokBotAccountFailed({ cause: new Error(sourceText(key)) });
}
