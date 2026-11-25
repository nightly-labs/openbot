import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AgentEvent, AgentRuntimeSnapshot, AgentSummary, ConversationMessage } from "@openbot/contracts/ipc";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { TEAM_PROTOCOL_V1_WEBSOCKET } from "@openbot/contracts/team-protocol";
import { TEAM_CURRENT_CAPABILITIES } from "@openbot/contracts/team-protocol/current";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect } from "effect";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { setPerfProbeSink } from "../src/backend/perf-probe-hooks";
import type { TeamApiAgents, TeamApiBrowser, TeamApiMailbox } from "../src/main/team-api/dependencies";
import { TeamApiServer } from "../src/main/team-api-server";
import { TeamStore } from "../src/main/team-store";

const APP_VERSION = "0.43.0";
const OUT = resolve(import.meta.dirname, "../.openbot-build/team-api-broadcast-bench");
const AGENT_ID = "agent-bench";
const THREAD_ID = "thread-bench";
const TURN_ID = "turn-bench";
const MESSAGE_ID = "message-bench";
const SEATS = 3;
const SOCKET_DEADLINE_MS = 60_000;
const DELTA_WORDS = ["The ", "host ", "streams ", "one ", "reply ", "to ", "each ", "joined ", "client. "];

type Scope = "chat" | "status";

interface Options {
  clients: number[];
  deltas: number;
  snapshotEvery: number;
  scopes: Scope[];
  budget: Record<string, number> | null;
}

interface Spread {
  min: number;
  max: number;
  mean: number;
}

interface RunResult {
  clients: number;
  sessions: number;
  scope: Scope;
  includeConversations: boolean;
  events: number;
  deltas: number;
  snapshots: number;
  host: {
    stringifyCalls: number;
    stringifyBytes: number;
    stringifyPerEvent: number;
    runtimeSnapshots: number;
    runtimeSnapshotsPerTurn: number;
    listAgentsCalls: number;
    probes: Record<string, number>;
  };
  perClient: {
    messages: Spread;
    bytes: Spread;
    messagesByType: Record<string, number>;
  };
  totals: { messages: number; bytes: number };
  process: { wallMs: number; cpuUserMs: number; cpuSystemMs: number };
}

function unused(name: string): () => never {
  return () => {
    throw new Error(`${name} is not used by the Team API broadcast bench.`);
  };
}

function parseList(value: string, flag: string): number[] {
  const values = value.split(",").map((part) => Number(part.trim()));
  if (values.length === 0 || values.some((count) => !Number.isInteger(count) || count < 1)) {
    throw new Error(`${flag} must be a list of positive integers.`);
  }
  return values;
}

function parseBudget(value: string): Record<string, number> {
  const raw = JSON.parse(value.trimStart().startsWith("{") ? value : readFileSync(value, "utf8"));
  if (!isDynamicRecord(raw)) throw new Error("--budget must be a JSON object of metric keys and numbers.");
  const budget: Record<string, number> = {};
  for (const [key, limit] of Object.entries(raw)) {
    if (!isNumber(limit)) throw new Error(`--budget value for ${key} must be a number.`);
    budget[key] = limit;
  }
  return budget;
}

function parseOptions(argv: readonly string[]): Options {
  const options: Options = {
    clients: [1, 10, 50],
    deltas: 400,
    snapshotEvery: 25,
    scopes: ["chat", "status"],
    budget: null,
  };
  for (const argument of argv) {
    const [flag, value = ""] = argument.split(/=(.*)/s, 2);
    if (flag === "--clients") options.clients = parseList(value, flag);
    else if (flag === "--deltas") options.deltas = parseList(value, flag)[0] ?? options.deltas;
    else if (flag === "--snapshot-every") options.snapshotEvery = parseList(value, flag)[0] ?? options.snapshotEvery;
    else if (flag === "--scopes") {
      const scopes = value.split(",").map((part) => part.trim());
      if (scopes.length === 0 || scopes.some((scope) => scope !== "chat" && scope !== "status")) {
        throw new Error("--scopes must be a list of chat and status.");
      }
      options.scopes = scopes.filter((scope): scope is Scope => scope === "chat" || scope === "status");
    } else if (flag === "--budget") options.budget = parseBudget(value);
    else throw new Error(`Unknown flag ${argument}. Use --clients, --deltas, --snapshot-every, --scopes or --budget.`);
  }
  return options;
}

function spread(values: readonly number[]): Spread {
  if (values.length === 0) return { min: 0, max: 0, mean: 0 };
  const total = values.reduce((sum, value) => sum + value, 0);
  return { min: Math.min(...values), max: Math.max(...values), mean: Math.round((total / values.length) * 10) / 10 };
}

function benchAgent(): AgentSummary {
  return {
    id: AGENT_ID,
    name: "Bench",
    title: "",
    description: "",
    notifications: true,
    provider: "codex",
    model: "gpt-5",
    reasoningEffort: "medium",
    threadId: THREAD_ID,
    workspacePath: join(tmpdir(), "openbot-broadcast-bench-workspace"),
    preview: "",
    updatedAt: null,
    avatarSeed: AGENT_ID,
    avatarHue: null,
    avatarUrl: null,
  };
}

function runtimeSnapshot(): AgentRuntimeSnapshot {
  return {
    agents: [],
    activeTurns: [{ agentId: AGENT_ID, threadId: THREAD_ID, turnId: TURN_ID }],
    work: [],
    latestMessages: [],
    attentionComplete: true,
    pendingPrompts: [],
    pendingApprovals: [],
    pendingBrowserTakeovers: [],
    failedTurns: [],
  };
}

function replayEvents(deltas: number, snapshotEvery: number): AgentEvent[] {
  const createdAt = new Date("2026-11-19T12:00:00.000Z").toISOString();
  const userMessage: ConversationMessage = {
    id: "message-user",
    turnId: TURN_ID,
    author: "user",
    text: "Write a long reply.",
    createdAt,
    status: "completed",
  };
  const events: AgentEvent[] = [{ type: "turn-started", agentId: AGENT_ID, threadId: THREAD_ID, turnId: TURN_ID }];
  let text = "";
  let revision = 1;
  const snapshot = (status: ConversationMessage["status"], activeTurnId: string | null): AgentEvent => ({
    type: "conversation",
    snapshot: {
      agentId: AGENT_ID,
      threadId: THREAD_ID,
      activeTurnId,
      revision,
      messages: [userMessage, { id: MESSAGE_ID, turnId: TURN_ID, author: "assistant", text, createdAt, status }],
    },
  });
  for (let index = 0; index < deltas; index += 1) {
    const delta = DELTA_WORDS[index % DELTA_WORDS.length] ?? "";
    text += delta;
    revision += 1;
    events.push({
      type: "conversation-delta",
      agentId: AGENT_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      delta,
      createdAt,
      revision,
    });
    if (snapshotEvery > 0 && (index + 1) % snapshotEvery === 0) events.push(snapshot("streaming", TURN_ID));
  }
  revision += 1;
  events.push(snapshot("completed", null));
  events.push({ type: "turn-completed", agentId: AGENT_ID, threadId: THREAD_ID, turnId: TURN_ID, status: "completed" });
  return events;
}

interface BenchClient {
  socket: WebSocket;
  counting: boolean;
  messages: number;
  bytes: number;
  byType: Map<string, number>;
  runtimeSnapshotsSeen: number;
  turnCompleted: boolean;
  completionSnapshot: boolean;
  wake: (() => void) | null;
}

function messageType(data: string): string {
  try {
    const value = JSON.parse(data);
    return isDynamicRecord(value) && isString(value.type) ? value.type : "unknown";
  } catch {
    return "unparsed";
  }
}

function waitFor(client: BenchClient, ready: () => boolean, what: string): Promise<void> {
  return new Promise((resolveReady, reject) => {
    if (ready()) return resolveReady();
    const timer = setTimeout(() => {
      client.wake = null;
      reject(new Error(`A client did not get ${what} in ${SOCKET_DEADLINE_MS} ms.`));
    }, SOCKET_DEADLINE_MS);
    client.wake = () => {
      if (!ready()) return;
      clearTimeout(timer);
      client.wake = null;
      resolveReady();
    };
  });
}

async function openClient(port: number, token: string, includeConversations: boolean): Promise<BenchClient> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}${TEAM_API_ROUTES.events}`, [
    TEAM_PROTOCOL_V1_WEBSOCKET,
    `openbot-token.${token}`,
  ]);
  const client: BenchClient = {
    socket,
    counting: false,
    messages: 0,
    bytes: 0,
    byType: new Map(),
    runtimeSnapshotsSeen: 0,
    turnCompleted: false,
    completionSnapshot: false,
    wake: null,
  };
  socket.addEventListener("message", (message) => {
    const data = String(message.data);
    const type = messageType(data);
    if (type === "runtime-snapshot") {
      client.runtimeSnapshotsSeen += 1;
      if (client.turnCompleted) client.completionSnapshot = true;
    }
    if (client.counting) {
      client.messages += 1;
      client.bytes += Buffer.byteLength(data);
      client.byType.set(type, (client.byType.get(type) ?? 0) + 1);
      if (type === "turn-completed" || type === "quiet-turn-completed") client.turnCompleted = true;
    }
    client.wake?.();
  });
  await new Promise<void>((resolveOpen, reject) => {
    socket.addEventListener("open", () => resolveOpen(), { once: true });
    socket.addEventListener("error", () => reject(new Error("A bench event socket did not open.")), { once: true });
  });
  socket.send(
    JSON.stringify({ type: "agent-event-scope", includeConversations, capabilities: [...TEAM_CURRENT_CAPABILITIES] }),
  );
  await waitFor(client, () => client.runtimeSnapshotsSeen >= 1, "the first runtime snapshot");
  socket.send(JSON.stringify({ type: "runtime-snapshot-request" }));
  await waitFor(client, () => client.runtimeSnapshotsSeen >= 2, "the requested runtime snapshot");
  return client;
}

async function closeClient(client: BenchClient): Promise<void> {
  if (client.socket.readyState === WebSocket.CLOSED) return;
  await new Promise<void>((resolveClosed) => {
    client.socket.addEventListener("close", () => resolveClosed(), { once: true });
    client.socket.close();
  });
}

const options = parseOptions(process.argv.slice(2));
mkdirSync(OUT, { recursive: true });
const root = mkdtempSync(join(tmpdir(), "openbot-team-api-broadcast-bench-"));
const logged: string[] = [];
const agentEventListeners = new Set<(event: AgentEvent, memberId?: string) => void>();
const counters = { runtimeSnapshots: 0, listAgents: 0 };
const agents = [benchAgent()];

const fakeAgents: TeamApiAgents = {
  on: (_event, listener) => {
    agentEventListeners.add(listener);
  },
  off: (_event, listener) => {
    agentEventListeners.delete(listener);
  },
  preferredProvider: () => "codex",
  newAgentProvider: () => "codex",
  getStatus: unused("getStatus"),
  getRuntimeSnapshot: () => {
    counters.runtimeSnapshots += 1;
    return runtimeSnapshot();
  },
  getUsage: unused("getUsage"),
  getAnalytics: unused("getAnalytics"),
  getHostAnalytics: unused("getHostAnalytics"),
  listModels: unused("listModels"),
  listAgents: () => {
    counters.listAgents += 1;
    return agents;
  },
  sidebarChatIds: unused("sidebarChatIds"),
  listConversationReads: unused("listConversationReads"),
  generateProfile: unused("generateProfile"),
  askSideQuestion: unused("askSideQuestion"),
  saveSkillSuggestion: unused("saveSkillSuggestion"),
  withdrawFeedback: unused("withdrawFeedback"),
  saveProfile: unused("saveProfile"),
  createAgent: unused("createAgent"),
  committedAgentDuplication: unused("committedAgentDuplication"),
  duplicateAgent: unused("duplicateAgent"),
  commitAgentDuplication: unused("commitAgentDuplication"),
  updateAgent: unused("updateAgent"),
  deleteAgent: unused("deleteAgent"),
  getMemorySelection: unused("getMemorySelection"),
  setMemoryInclusion: unused("setMemoryInclusion"),
  listMemories: unused("listMemories"),
  createMemory: unused("createMemory"),
  updateMemory: unused("updateMemory"),
  deleteMemory: unused("deleteMemory"),
  clearMemories: unused("clearMemories"),
  listRoutines: unused("listRoutines"),
  createRoutine: unused("createRoutine"),
  updateRoutine: unused("updateRoutine"),
  deleteRoutine: unused("deleteRoutine"),
  testRoutine: unused("testRoutine"),
  listRoutineRuns: unused("listRoutineRuns"),
  listChannelMemories: unused("listChannelMemories"),
  createChannelMemory: unused("createChannelMemory"),
  updateChannelMemory: unused("updateChannelMemory"),
  deleteChannelMemory: unused("deleteChannelMemory"),
  clearChannelMemories: unused("clearChannelMemories"),
  listChannelRoutines: unused("listChannelRoutines"),
  createChannelRoutine: unused("createChannelRoutine"),
  updateChannelRoutine: unused("updateChannelRoutine"),
  deleteChannelRoutine: unused("deleteChannelRoutine"),
  testChannelRoutine: unused("testChannelRoutine"),
  listChannelRoutineRuns: unused("listChannelRoutineRuns"),
  setAvatar: unused("setAvatar"),
  resolveAvatar: unused("resolveAvatar"),
  readConversation: unused("readConversation"),
  readConversationFor: unused("readConversationFor"),
  readConversationPageFor: unused("readConversationPageFor"),
  searchConversationMessages: unused("searchConversationMessages"),
  searchConversationFiles: unused("searchConversationFiles"),
  markConversationRead: unused("markConversationRead"),
  markConversationUnread: unused("markConversationUnread"),
  prepareImportedAttachments: unused("prepareImportedAttachments"),
  discardDraftAttachment: unused("discardDraftAttachment"),
  resolveSharedFile: unused("resolveSharedFile"),
  resolveWorkspaceFile: unused("resolveWorkspaceFile"),
  resolveLocalWorkspaceFile: unused("resolveLocalWorkspaceFile"),
  listWorkspaceDirectory: unused("listWorkspaceDirectory"),
  sendMessage: unused("sendMessage"),
  listQueue: unused("listQueue"),
  listActiveQueues: unused("listActiveQueues"),
  acknowledgeFailedTurn: unused("acknowledgeFailedTurn"),
  setMessageReaction: unused("setMessageReaction"),
  deleteConversationMessage: unused("deleteConversationMessage"),
  listPinnedMessages: unused("listPinnedMessages"),
  setMessagePinned: unused("setMessagePinned"),
  cancelQueuedMessage: unused("cancelQueuedMessage"),
  listWaits: unused("listWaits"),
  cancelWait: unused("cancelWait"),
  steerQueuedMessage: unused("steerQueuedMessage"),
  updateQueuedMessage: unused("updateQueuedMessage"),
  editQueuedMessage: unused("editQueuedMessage"),
  reorderQueue: unused("reorderQueue"),
  interrupt: unused("interrupt"),
  clearAgentContext: unused("clearAgentContext"),
  deleteAgentHistory: unused("deleteAgentHistory"),
  clearChannelContext: unused("clearChannelContext"),
  compactChannelContext: unused("compactChannelContext"),
  deleteChannelHistory: unused("deleteChannelHistory"),
  compactAgentContext: unused("compactAgentContext"),
  compactTaskContext: unused("compactTaskContext"),
  agentIdForRequest: unused("agentIdForRequest"),
  pendingApproval: unused("pendingApproval"),
  pendingMediaApproval: unused("pendingMediaApproval"),
  pendingCreditsHold: unused("pendingCreditsHold"),
  pendingPrompts: unused("pendingPrompts"),
  respondToPrompt: unused("respondToPrompt"),
  respondToApproval: unused("respondToApproval"),
  respondToMediaApproval: unused("respondToMediaApproval"),
  respondToCreditsHold: unused("respondToCreditsHold"),
  respondToBrowserSecret: unused("respondToBrowserSecret"),
  respondToBrowserTakeover: unused("respondToBrowserTakeover"),
};

const browser: TeamApiBrowser = {
  listTabs: () => [],
  getControlState: unused("getControlState"),
  open: unused("open"),
  activate: unused("activate"),
  navigate: unused("navigate"),
  reload: unused("reload"),
  stop: unused("stop"),
  takeUserControl: unused("takeUserControl"),
  releaseUserControl: unused("releaseUserControl"),
  startTeach: unused("startTeach"),
  stopTeach: unused("stopTeach"),
  releaseUserControlHeldBy: () => undefined,
  releaseUserControlRefused: () => undefined,
  close: unused("close"),
  capturePreview: unused("capturePreview"),
  setVisible: unused("setVisible"),
  getDisplayState: () => ({ tabs: [], activeTabId: null }),
  loadUrl: unused("loadUrl"),
  isPrivate: () => false,
  startView: unused("startView"),
  dispatchViewInput: unused("dispatchViewInput"),
  copyViewSelection: unused("copyViewSelection"),
  importSignIn: unused("importSignIn"),
  answerHttpSignIn: unused("answerHttpSignIn"),
};

const mailbox: TeamApiMailbox = { resolveAttachment: () => Effect.succeed(null) };

const probes = new Map<string, number>();
setPerfProbeSink({
  count: (key, amount) => probes.set(key, (probes.get(key) ?? 0) + amount),
  time: () => undefined,
  ipcSend: () => undefined,
});

const nativeStringify = JSON.stringify;
const stringifyCount = { calls: 0, bytes: 0 };
function countingStringify(this: JSON, ...args: Parameters<typeof nativeStringify>): string {
  const result = nativeStringify.apply(this, args);
  stringifyCount.calls += 1;
  if (isString(result)) stringifyCount.bytes += result.length;
  return result;
}

function useStringify(stringify: typeof countingStringify | typeof nativeStringify): void {
  Object.defineProperty(JSON, "stringify", { value: stringify, configurable: true, writable: true });
}

const store = new TeamStore(join(root, "team.json"));
let server: TeamApiServer | null = null;
const results: RunResult[] = [];
const failures: string[] = [];

async function sessionTokens(count: number): Promise<string[]> {
  const ownerPassword = randomBytes(18).toString("hex");
  await runCauseEffect(store.initialize());
  await runCauseEffect(store.configure("Bench Server", "owner", ownerPassword));
  const accounts: [string, string][] = [["owner", ownerPassword]];
  for (let seat = 1; seat < SEATS; seat += 1) {
    const password = randomBytes(18).toString("hex");
    const invite = await runCauseEffect(store.createInvite("member"));
    await runCauseEffect(store.acceptInvite(invite.token, `member${seat}`, password));
    accounts.push([`member${seat}`, password]);
  }
  const tokens: string[] = [];
  const sessions = Math.min(count, accounts.length * INPUT_LIMITS.sessionsPerMember);
  for (let index = 0; index < sessions; index += 1) {
    const [username, password] = accounts[index % accounts.length] ?? accounts[0] ?? ["owner", ownerPassword];
    const session = await runCauseEffect(store.login(username, password));
    tokens.push(session.sessionToken);
  }
  return tokens;
}

async function run(port: number, tokens: readonly string[], clientCount: number, scope: Scope): Promise<RunResult> {
  const includeConversations = scope === "chat";
  const clients: BenchClient[] = [];
  try {
    for (let index = 0; index < clientCount; index += 1) {
      const token = tokens[index % tokens.length] ?? "";
      clients.push(await openClient(port, token, includeConversations));
    }
    const events = replayEvents(options.deltas, options.snapshotEvery);
    for (const client of clients) client.counting = true;
    counters.runtimeSnapshots = 0;
    counters.listAgents = 0;
    probes.clear();
    stringifyCount.calls = 0;
    stringifyCount.bytes = 0;
    const cpuBefore = process.cpuUsage();
    const startedAt = performance.now();
    useStringify(countingStringify);
    try {
      for (const event of events) {
        for (const listener of agentEventListeners) listener(event);
        await new Promise<void>((resolveTick) => setImmediate(resolveTick));
      }
    } finally {
      useStringify(nativeStringify);
    }
    const hostStringify = { ...stringifyCount };
    const hostRuntimeSnapshots = counters.runtimeSnapshots;
    const hostListAgents = counters.listAgents;
    const hostProbes = Object.fromEntries([...probes].sort(([left], [right]) => left.localeCompare(right)));
    await Promise.all(
      clients.map((client) =>
        waitFor(
          client,
          () => client.turnCompleted && (includeConversations || client.completionSnapshot),
          includeConversations ? "turn-completed" : "turn-completed and its runtime snapshot",
        ),
      ),
    );
    const wallMs = Math.round(performance.now() - startedAt);
    const cpu = process.cpuUsage(cpuBefore);
    const byType: Record<string, number> = {};
    for (const client of clients) {
      for (const [type, count] of client.byType) byType[type] = (byType[type] ?? 0) + count;
    }
    for (const type of Object.keys(byType)) byType[type] = Math.round(((byType[type] ?? 0) / clients.length) * 10) / 10;
    const snapshots = events.filter((event) => event.type === "conversation").length;
    const messages = clients.map((client) => client.messages);
    const bytes = clients.map((client) => client.bytes);
    return {
      clients: clientCount,
      sessions: Math.min(clientCount, tokens.length),
      scope,
      includeConversations,
      events: events.length,
      deltas: options.deltas,
      snapshots,
      host: {
        stringifyCalls: hostStringify.calls,
        stringifyBytes: hostStringify.bytes,
        stringifyPerEvent: Math.round((hostStringify.calls / events.length) * 100) / 100,
        runtimeSnapshots: hostRuntimeSnapshots,
        runtimeSnapshotsPerTurn: hostRuntimeSnapshots,
        listAgentsCalls: hostListAgents,
        probes: hostProbes,
      },
      perClient: { messages: spread(messages), bytes: spread(bytes), messagesByType: byType },
      totals: {
        messages: messages.reduce((sum, value) => sum + value, 0),
        bytes: bytes.reduce((sum, value) => sum + value, 0),
      },
      process: { wallMs, cpuUserMs: Math.round(cpu.user / 1000), cpuSystemMs: Math.round(cpu.system / 1000) },
    };
  } finally {
    await Promise.all(clients.map(closeClient));
  }
}

function budgetValues(result: RunResult): Record<string, number> {
  const prefix = `${result.clients}.${result.scope}`;
  return {
    [`${prefix}.stringifyCalls`]: result.host.stringifyCalls,
    [`${prefix}.stringifyPerEvent`]: result.host.stringifyPerEvent,
    [`${prefix}.stringifyBytes`]: result.host.stringifyBytes,
    [`${prefix}.runtimeSnapshotsPerTurn`]: result.host.runtimeSnapshotsPerTurn,
    [`${prefix}.listAgentsCalls`]: result.host.listAgentsCalls,
    [`${prefix}.messagesPerClient`]: result.perClient.messages.max,
    [`${prefix}.bytesPerClient`]: result.perClient.bytes.max,
  };
}

try {
  const largest = Math.max(...options.clients);
  const tokens = await sessionTokens(largest);
  server = new TeamApiServer({
    appVersion: APP_VERSION,
    store,
    agents: fakeAgents,
    mailbox,
    browser,
    logger: createOpenBotLogger("team-api-broadcast-bench", (line) => logged.push(line)),
  });
  const port = await Effect.runPromise(server.start());
  for (const clientCount of options.clients) {
    for (const scope of options.scopes) {
      const result = await run(port, tokens, clientCount, scope);
      results.push(result);
      process.stdout.write(
        `${clientCount} clients, ${scope}: ${result.host.stringifyCalls} stringify calls (${result.host.stringifyPerEvent}/event), ` +
          `${result.host.runtimeSnapshots} runtime snapshots, ${result.perClient.messages.max} messages and ` +
          `${result.perClient.bytes.max} bytes per client, ${result.process.wallMs} ms\n`,
      );
    }
  }
  if (options.budget) {
    const measured = Object.assign({}, ...results.map(budgetValues));
    for (const [key, limit] of Object.entries(options.budget)) {
      const value = measured[key];
      if (!isNumber(value)) failures.push(`Budget key ${key} has no measured value.`);
      else if (value > limit) failures.push(`${key} is ${value}, over its budget of ${limit}.`);
    }
  }
} finally {
  setPerfProbeSink(null);
  if (server) await Effect.runPromise(server.stop()).catch(() => undefined);
  rmSync(root, { recursive: true, force: true });
}

const reportPath = join(OUT, `report-${new Date().toISOString().replaceAll(":", "-")}.json`);
writeFileSync(
  reportPath,
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      method:
        "The host runs in this process. JSON.stringify is wrapped only while the events replay, so stringify counts are host calls. CPU time is for the whole process, clients included.",
      options: {
        clients: options.clients,
        deltas: options.deltas,
        snapshotEvery: options.snapshotEvery,
        scopes: options.scopes,
        budget: options.budget,
      },
      results,
      hostWarnings: logged.filter((line) => line.includes("WARN") || line.includes("warn")).length,
      budgetFailures: failures,
    },
    null,
    2,
  )}\n`,
);
writeFileSync(join(OUT, "latest.json"), readFileSync(reportPath));
process.stdout.write(`Report: ${reportPath}\n`);
if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`Budget failure: ${failure}\n`);
  process.exit(1);
}
process.exit(0);
