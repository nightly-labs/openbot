// Checks that a failed turn end does not leave a delivery `running` and the agent's queue blocked
// (#2214). Runs the real agent service on a temporary profile with a fake Codex app-server, and
// injects one failure at a time into the mailbox or the database of that service:
// (a) boot recovery cannot settle one of three orphaned deliveries: the other two settle, and the drain runs;
// (b) a turn end fails, by a defect or by a stored-state failure: the delivery ends, and the next message runs;
// (c) a late write after the turn ended does not open the turn row again;
// (d) Stop on a delivery that stays running after its turn ended frees the queue;
// (e) Stop while the normal turn end runs does not settle the completed turn as interrupted;
// (f) a turn end that fails after its deliveries settled still closes the stored turn;
// (g) a delivery that runs again under the same turn id, after its session was refused, runs to its end (#2468);
// (h) a turn row that stays `running` although no thread names it as its active turn is closed at restart,
//     in the agent's own chat, a task thread and a channel thread.
// `bun scripts/stuck-running-deliveries-e2e.ts`. Writes .openbot-build/stuck-running-deliveries-e2e/report.json.
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, type AgentEvent } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { getRecord, getString, isRecord } from "../src/backend/protocol";

const OUT = resolve(import.meta.dirname, "../.openbot-build/stuck-running-deliveries-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-stuck-deliveries-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const logPath = join(root, "protocol.jsonl");
const controlPath = join(root, "control.json");
const fakeCodex = join(root, "codex");
/** How long a case waits for the state that the fix gives. Without the fix that state never comes. */
const SETTLE_MS = 10_000;

// Before the service modules load: the Codex process and the stores read the home folder.
process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.OPENBOT_CODEX_PATH = fakeCodex;
process.env.OPENBOT_FAKE_CODEX_LOG = logPath;
process.env.OPENBOT_FAKE_CODEX_CONTROL = controlPath;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentThreadStore } = await import("../src/backend/agent-threads/agent-thread-store");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");
const { StoredStateFailure } = await import("../src/backend/stored-state-effects");

/**
 * A Codex app-server with the methods that the service calls. `control.json` sets whether a new
 * turn is held until `turn/interrupt` or the process exits, how long a turn that is not held runs, and
 * whether `turn/started` comes before the `turn/start` answer. With `clientTurnIds`, a turn takes the
 * `clientUserMessageId` as its id, as Claude, ACP and Pi do, and a new turn is refused while a turn of
 * the thread runs, as Claude refuses it. With `refuseOnce`, the first turn of each id fails as a
 * refused session.
 * Like Codex, `turn/interrupt` for a turn that does not run is refused.
 */
const FAKE_CODEX = `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\\n");
  process.exit(0);
}
const log = (entry) => fs.appendFileSync(process.env.OPENBOT_FAKE_CODEX_LOG, JSON.stringify(entry) + "\\n");
const control = () => JSON.parse(fs.readFileSync(process.env.OPENBOT_FAKE_CODEX_CONTROL, "utf8"));
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
const prefix = "p" + process.pid + "-";
let buffer = "";
let threads = 0;
let turns = 0;
/** turnId -> { threadId, timer } of each turn that runs. */
const running = new Map();
/** The turn ids that refuseOnce already refused. */
const refused = new Set();
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const finish = (turnId, status) => {
  const turn = running.get(turnId);
  if (!turn) return;
  running.delete(turnId);
  clearTimeout(turn.timer);
  log({ turnEnded: turnId, threadId: turn.threadId, status });
  if (status === "completed") {
    const item = { type: "agentMessage", id: "message-" + turnId, text: "Done.", phase: "final_answer" };
    write({ method: "item/completed", params: { threadId: turn.threadId, turnId, item } });
  }
  write({ method: "turn/completed", params: { threadId: turn.threadId, turn: { id: turnId, status } } });
};
const answer = (message) => {
  const params = message.params || {};
  switch (message.method) {
    case "initialize": return write({ id: message.id, result: {} });
    case "account/read": return write({ id: message.id, result: { account: { type: "chatgpt", email: "codex@example.com" } } });
    case "account/rateLimits/read": return write({ id: message.id, result: { rateLimits: { limitId: "codex", primary: null, secondary: null }, rateLimitsByLimitId: null } });
    case "model/list": return write({ id: message.id, result: { data: [{ model: "gpt-5.5", displayName: "GPT-5.5" }] } });
    case "plugin/list": return write({ id: message.id, result: { marketplaces: [] } });
    case "config/read": return write({ id: message.id, result: config });
    case "config/batchWrite": return write({ id: message.id, result: {} });
    case "thread/start": return write({ id: message.id, result: { thread: { id: prefix + "thread-" + (++threads), turns: [] } } });
    case "thread/resume": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "thread/unsubscribe": return write({ id: message.id, result: { status: "Unsubscribed" } });
    case "thread/turns/list":
    case "thread/items/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "thread/read": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "turn/start": {
      const { holdTurns, turnMs, startedFirst, clientTurnIds, refuseOnce } = control();
      const turnId = clientTurnIds && params.clientUserMessageId ? params.clientUserMessageId : prefix + "turn-" + (++turns);
      if (clientTurnIds && [...running.values()].some((turn) => turn.threadId === params.threadId))
        return write({ id: message.id, error: { code: -32600, message: "The thread already has an active turn." } });
      const started = { method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } };
      if (startedFirst) write(started);
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      if (!startedFirst) write(started);
      if (refuseOnce && !refused.has(turnId)) {
        refused.add(turnId);
        const refuse = () => {
          const error = { message: "Item with encrypted_content was not issued to this caller." };
          write({ method: "error", params: { threadId: params.threadId, turnId, error, willRetry: false } });
          finish(turnId, "failed");
        };
        running.set(turnId, { threadId: params.threadId, timer: setTimeout(refuse, 200) });
        return;
      }
      const timer = holdTurns ? undefined : setTimeout(() => finish(turnId, "completed"), turnMs);
      running.set(turnId, { threadId: params.threadId, timer });
      return;
    }
    case "turn/interrupt": {
      if (!running.has(params.turnId)) return write({ id: message.id, error: { code: -32600, message: "no active turn to interrupt" } });
      write({ id: message.id, result: {} });
      return finish(params.turnId, "interrupted");
    }
    default:
      return write({ id: message.id, error: { code: -32601, message: "Method not found: " + message.method } });
  }
};
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line) {
      const message = JSON.parse(line);
      log({ method: message.method ?? null, id: message.id ?? null, params: message.params ?? null });
      if (message.method && message.id !== undefined) answer(message);
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

type Database = InstanceType<typeof OpenBotDatabase>;
type Mailbox = InstanceType<typeof MailboxStore>;
type Store = InstanceType<typeof AgentStore>;
type Service = InstanceType<typeof AgentService>;

interface Instance {
  database: Database;
  store: Store;
  mailbox: Mailbox;
  agents: Service;
  errors: { code: string; agentId: string | null }[];
}

/** What a case saw, as it goes into the report. */
type ReportValue = string | number | boolean | null | ReportValue[] | { [key: string]: ReportValue };
type Details = { [key: string]: ReportValue };

interface CaseReport {
  name: string;
  passed: boolean;
  failure: string | null;
  details: Details;
}

const report: {
  cases: CaseReport[];
  codexStarts: number;
  errorEvents: { code: string; agentId: string | null }[];
  passed: boolean;
  error?: string;
} = { cases: [], codexStarts: 0, errorEvents: [], passed: false };

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  beginTakeover: unused,
  endTakeover: () => {},
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
};

function codexStarts(): number {
  try {
    return readFileSync(logPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line): unknown => JSON.parse(line))
      .filter((entry) => isRecord(entry) && getString(entry, "method") === "initialize").length;
  } catch {
    return 0;
  }
}

/** Waits for a state of the service. Gives null when the state does not come in time. */
async function waitFor<T>(read: () => T | null | undefined | false, timeoutMs = SETTLE_MS): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await new Promise((done) => setTimeout(done, 25));
  }
}

/** Like `waitFor`, for a state that the case needs before its check starts. */
async function need<T>(label: string, read: () => T | null | undefined | false): Promise<T> {
  const value = await waitFor(read, 20_000);
  if (!value) throw new Error(`Timed out waiting for ${label}.`);
  return value;
}

async function control(value: {
  holdTurns: boolean;
  turnMs: number;
  startedFirst?: boolean;
  clientTurnIds?: boolean;
  refuseOnce?: boolean;
}): Promise<void> {
  await writeFile(controlPath, JSON.stringify(value));
}

async function start(): Promise<Instance> {
  const database = new OpenBotDatabase(userData);
  const store = new AgentStore(userData, home, database);
  const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
  const agents = new AgentService({
    store,
    mailbox,
    browser,
    preferredProvider: "codex",
    offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
    busyMessageMode: () => "queue",
  });
  const errors: Instance["errors"] = [];
  agents.on("event", (event) => {
    if (event.type === "error") errors.push({ code: event.code, agentId: event.agentId ?? null });
  });
  return { database, store, mailbox, agents, errors };
}

async function initialize(instance: Instance): Promise<string | null> {
  try {
    await runCauseEffect(instance.agents.initialize());
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function shutdown(instance: Instance): Promise<void> {
  await runCauseEffect(instance.agents.stop()).catch(() => {});
  report.errorEvents.push(...instance.errors);
  instance.database.close();
}

function status(mailbox: Mailbox, deliveryId: string): string {
  return mailbox.getDelivery(deliveryId)?.delivery.status ?? "missing";
}

const isTerminal = (value: string) => value === "completed" || value === "failed" || value === "interrupted";

type TurnRow = { status: string; completedAt: string | null };

function turnRow(database: Database, turnId: string): TurnRow | null {
  const row = database.connection
    .prepare("SELECT status, completed_at FROM projection_turns WHERE turn_id = ?")
    .get(turnId);
  if (!isRecord(row)) return null;
  return { status: getString(row, "status") ?? "missing", completedAt: getString(row, "completed_at") };
}

/** Creates an agent, and waits until its first message runs in a provider turn. */
async function agentWithRunningTurn(
  instance: Instance,
  name: string,
): Promise<{ agentId: string; deliveryId: string; turnId: string }> {
  const agent = await runCauseEffect(
    instance.agents.createAgent({
      name,
      description: "Checks that a failed turn end frees the queue.",
      avatarSeed: name.toLowerCase().replaceAll(" ", "-"),
      avatarHue: null,
      initialMessage: "First message.",
    }),
  );
  const deliveryId = await need(
    `the first delivery of ${name}`,
    () => instance.agents.listQueue(agent.id).deliveries[0]?.id,
  );
  const turnId = await need(`the turn of ${name}`, () => {
    const delivery = instance.mailbox.getDelivery(deliveryId)?.delivery;
    return delivery?.status === "running" && delivery.turnId;
  });
  return { agentId: agent.id, deliveryId, turnId };
}

/** Sends a second message while the first runs, and checks that it waits in the queue. */
async function queueSecond(instance: Instance, agentId: string): Promise<string> {
  const receipt = await runCauseEffect(instance.agents.sendMessage({ agentId, text: "Second message." }));
  const deliveryId = receipt.deliveries[0]?.id;
  if (!deliveryId) throw new Error("The second message has no delivery.");
  const waiting = status(instance.mailbox, deliveryId);
  if (waiting !== "queued") throw new Error(`The second message did not wait: ${waiting}.`);
  return deliveryId;
}

async function runCase(name: string, body: (details: Details) => Promise<string | null>) {
  const details: Details = {};
  let failure: string | null;
  try {
    failure = await body(details);
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  report.cases.push({ name, passed: failure === null, failure, details });
}

const injected = (label: string) => new Error(`Injected ${label} failure (#2214 check).`);

await writeFile(fakeCodex, FAKE_CODEX, { mode: 0o755 });
let current: Instance | null = null;

try {
  // (a) Three agents with a turn that runs when OpenBot stops, and a second message in each queue.
  await control({ holdTurns: true, turnMs: 0 });
  const first = await start();
  current = first;
  const firstError = await initialize(first);
  if (firstError) throw new Error(`The first start failed: ${firstError}`);
  const orphans: { agentId: string; deliveryId: string; turnId: string; queuedId: string }[] = [];
  for (const index of [1, 2, 3]) {
    const running = await agentWithRunningTurn(first, `Recovery ${index}`);
    orphans.push({ ...running, queuedId: await queueSecond(first, running.agentId) });
  }
  await shutdown(first);
  current = null;

  await control({ holdTurns: false, turnMs: 100 });
  const second = await start();
  current = second;
  const { mailbox } = second;
  const markTerminal = mailbox.markTerminal;
  const orphanIds = new Set(orphans.map((orphan) => orphan.deliveryId));
  let recoveryFailedId: string | null = null;
  // The first orphan that the recovery reaches cannot be stored as settled.
  mailbox.markTerminal = (deliveryId, terminal, error = null) => {
    if (recoveryFailedId === null && orphanIds.has(deliveryId)) {
      recoveryFailedId = deliveryId;
      return Effect.fail(new StoredStateFailure({ cause: injected("boot recovery") }));
    }
    return markTerminal(deliveryId, terminal, error);
  };
  const secondError = await initialize(second);

  await runCase("a: boot recovery failure for one of three deliveries", async (details) => {
    details.initializeError = secondError;
    const others = () => orphans.filter((orphan) => orphan.deliveryId !== recoveryFailedId);
    await waitFor(
      () =>
        recoveryFailedId !== null &&
        others().every(
          (orphan) =>
            isTerminal(status(mailbox, orphan.deliveryId)) && status(mailbox, orphan.queuedId) === "completed",
        ),
    );
    details.recoveryFailedDelivery =
      recoveryFailedId === null ? null : orphans.findIndex((orphan) => orphan.deliveryId === recoveryFailedId) + 1;
    details.deliveries = orphans.map((orphan, index) => ({
      agent: index + 1,
      first: status(mailbox, orphan.deliveryId),
      second: status(mailbox, orphan.queuedId),
    }));
    const reported = second.errors.some((event) => event.code === "delivery_reconcile_failed");
    details.reconcileErrorReported = reported;
    if (recoveryFailedId === null) return "The recovery did not reach the orphaned deliveries.";
    for (const orphan of others()) {
      if (status(mailbox, orphan.deliveryId) !== "interrupted") return "An orphan that could settle stays open.";
      if (status(mailbox, orphan.queuedId) !== "completed") return "The drain did not run the next message.";
    }
    if (!reported) return "The recovery failure was not reported.";
    return null;
  });
  mailbox.markTerminal = markTerminal;

  await runCase("c: a late write after the turn ended does not open the turn row", async (details) => {
    const { agentId, deliveryId, turnId } = await agentWithRunningTurn(second, "Late write");
    await need("the turn to end", () => status(mailbox, deliveryId) === "completed");
    const threadId = await need(
      "the thread",
      () => second.store.list().find((agent) => agent.id === agentId)?.threadId,
    );
    const ended = await need("the ended turn row", () => {
      const row = turnRow(second.database, turnId);
      return row?.completedAt ? row : null;
    });
    details.afterEnd = ended;
    second.database.persistConversationChanges({
      agentId,
      threadId,
      activeTurnId: turnId,
      changedMessages: [],
      eventType: "conversation.snapshot-updated",
      detail: {},
    });
    const afterLateChanges = turnRow(second.database, turnId);
    details.afterLateChanges = afterLateChanges;
    second.database.persistConversation(
      { ...second.database.readConversation(agentId, threadId), activeTurnId: turnId },
      "conversation.snapshot-updated",
    );
    const afterLateSnapshot = turnRow(second.database, turnId);
    details.afterLateSnapshot = afterLateSnapshot;
    // The thread row took the late turn id too; the check puts back what the service wrote.
    second.database.persistConversation(
      { ...second.database.readConversation(agentId, threadId), activeTurnId: null },
      "conversation.snapshot-updated",
    );
    const reopened = (row: TurnRow | null) => !row || row.status !== ended.status || row.completedAt === null;
    if (reopened(afterLateChanges)) return "The changes write opened the ended turn again.";
    if (reopened(afterLateSnapshot)) return "The snapshot write opened the ended turn again.";
    return null;
  });

  const completionFailure = async (
    details: Details,
    name: string,
    arm: (target: { agentId: string; deliveryId: string; turnId: string }) => () => void,
  ) => {
    await control({ holdTurns: false, turnMs: 1_500 });
    const target = await agentWithRunningTurn(second, name);
    const queuedId = await queueSecond(second, target.agentId);
    const disarm = arm(target);
    try {
      await waitFor(() => isTerminal(status(mailbox, target.deliveryId)) && status(mailbox, queuedId) === "completed");
    } finally {
      disarm();
    }
    const first = status(mailbox, target.deliveryId);
    const next = status(mailbox, queuedId);
    const reported = second.errors.some(
      (event) => event.code === "turn_completion_failed" && event.agentId === target.agentId,
    );
    details.first = first;
    details.second = next;
    details.turnRow = turnRow(second.database, target.turnId);
    details.completionErrorReported = reported;
    if (!isTerminal(first)) return "The first delivery stays open after its turn ended.";
    if (next !== "completed") return "The next queued message did not run.";
    if (!reported) return "The completion failure was not reported.";
    return null;
  };

  await runCase("b1: a defect in the turn end", (details) =>
    completionFailure(details, "Completion defect", (target) => {
      const findDeliveriesByTurn = mailbox.findDeliveriesByTurn.bind(mailbox);
      let armed = true;
      mailbox.findDeliveriesByTurn = (agentId, turnId) => {
        if (armed && agentId === target.agentId && turnId === target.turnId) {
          armed = false;
          throw injected("turn completion");
        }
        return findDeliveriesByTurn(agentId, turnId);
      };
      return () => {
        mailbox.findDeliveriesByTurn = findDeliveriesByTurn;
      };
    }),
  );

  await runCase("b2: a stored-state failure in the turn end", (details) =>
    completionFailure(details, "Completion store failure", (target) => {
      let armed = true;
      mailbox.markTerminal = (deliveryId, terminal, error = null) => {
        if (armed && deliveryId === target.deliveryId) {
          armed = false;
          return Effect.fail(new StoredStateFailure({ cause: injected("turn completion") }));
        }
        return markTerminal(deliveryId, terminal, error);
      };
      return () => {
        mailbox.markTerminal = markTerminal;
      };
    }),
  );

  await runCase("d: Stop on a delivery that stays running after its turn ended", async (details) => {
    await control({ holdTurns: false, turnMs: 1_000 });
    const target = await agentWithRunningTurn(second, "Orphan stop");
    const queuedId = await queueSecond(second, target.agentId);
    // Every attempt to store the end fails, so the delivery stays running.
    mailbox.markTerminal = (deliveryId, terminal, error = null) =>
      deliveryId === target.deliveryId
        ? Effect.fail(new StoredStateFailure({ cause: injected("turn completion") }))
        : markTerminal(deliveryId, terminal, error);
    try {
      await need("the turn end to fail", () =>
        second.errors.some((event) => event.code === "turn_completion_failed" && event.agentId === target.agentId),
      );
    } finally {
      mailbox.markTerminal = markTerminal;
    }
    details.beforeStop = { first: status(mailbox, target.deliveryId), second: status(mailbox, queuedId) };
    if (status(mailbox, target.deliveryId) !== "running")
      return "The injected failure did not leave the delivery running.";
    await runCauseEffect(second.agents.interrupt(target.agentId, target.turnId));
    await waitFor(() => isTerminal(status(mailbox, target.deliveryId)) && status(mailbox, queuedId) === "completed");
    details.afterStop = { first: status(mailbox, target.deliveryId), second: status(mailbox, queuedId) };
    details.turnRow = turnRow(second.database, target.turnId);
    if (status(mailbox, target.deliveryId) !== "interrupted") return "Stop did not end the running delivery.";
    if (status(mailbox, queuedId) !== "completed") return "The next queued message did not run after Stop.";
    return null;
  });

  await runCase("e: Stop while the turn end runs", async (details) => {
    // `turn/started` comes first, so the turn takes its delivery itself. That write is held, and the
    // normal end of the turn waits for it: a Stop in that wait comes after the provider ended the
    // turn and before the end settled it.
    await control({ holdTurns: false, turnMs: 1_000, startedFirst: true });
    const target = await agentWithRunningTurn(second, "Stop during end");
    const queuedId = await queueSecond(second, target.agentId);
    const markRunning = mailbox.markRunning;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let secondTurnId: string | null = null;
    mailbox.markRunning = (deliveryId, turnId) => {
      if (deliveryId !== queuedId) return markRunning(deliveryId, turnId);
      secondTurnId = turnId;
      return markRunning(deliveryId, turnId).pipe(Effect.andThen(Effect.promise(() => gate)));
    };
    const completions: string[] = [];
    const onEvent = (event: AgentEvent) => {
      if (event.type === "turn-completed" && event.agentId === target.agentId) completions.push(event.turnId);
    };
    second.agents.on("event", onEvent);
    try {
      const turnId = await need("the second turn", () => secondTurnId);
      await need("the end of the second turn", () => second.agents.earliestRunningTurnStartedAt() === null);
      details.stop = await runCauseEffect(second.agents.interrupt(target.agentId, turnId)).then(
        () => "sent",
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      );
      release();
      await waitFor(() => isTerminal(status(mailbox, queuedId)) && completions.includes(turnId));
      details.turnRow = turnRow(second.database, turnId);
    } finally {
      release();
      mailbox.markRunning = markRunning;
      second.agents.off("event", onEvent);
    }
    details.first = status(mailbox, target.deliveryId);
    details.second = status(mailbox, queuedId);
    details.completions = completions;
    if (status(mailbox, queuedId) !== "completed") return "Stop settled a turn that completed.";
    if (completions.filter((turnId) => turnId === secondTurnId).length !== 1) return "The turn did not end once.";
    return null;
  });

  await runCase("f: a turn end that fails after its deliveries settled closes the stored turn", async (details) => {
    await control({ holdTurns: false, turnMs: 1_000 });
    const target = await agentWithRunningTurn(second, "Late end failure");
    const queuedId = await queueSecond(second, target.agentId);
    const updatePreview = second.store.updatePreview;
    let armed = true;
    second.store.updatePreview = (id, preview) => {
      if (armed && id === target.agentId) {
        armed = false;
        return Effect.fail(new StoredStateFailure({ cause: injected("preview") }));
      }
      return updatePreview(id, preview);
    };
    try {
      await waitFor(() => isTerminal(status(mailbox, target.deliveryId)) && status(mailbox, queuedId) === "completed");
    } finally {
      second.store.updatePreview = updatePreview;
    }
    const row = turnRow(second.database, target.turnId);
    details.first = status(mailbox, target.deliveryId);
    details.second = status(mailbox, queuedId);
    details.turnRow = row;
    details.previewFailed = !armed;
    if (armed) return "The turn end did not reach the injected failure.";
    if (status(mailbox, target.deliveryId) !== "completed") return "The first delivery did not complete.";
    if (status(mailbox, queuedId) !== "completed") return "The next queued message did not run.";
    if (!row?.completedAt || row.status === "running") return "The stored turn stays running.";
    return null;
  });

  await runCase("g: a delivery that runs again under the same turn id runs to its end", async (details) => {
    await control({ holdTurns: false, turnMs: 1_000, clientTurnIds: true, refuseOnce: true });
    const agent = await runCauseEffect(
      second.agents.createAgent({
        name: "Same turn id",
        description: "Checks that a retried delivery is not taken for its first, ended turn.",
        avatarSeed: "same-turn-id",
        avatarHue: null,
        initialMessage: "First message.",
      }),
    );
    const deliveryId = await need("the first delivery", () => second.agents.listQueue(agent.id).deliveries[0]?.id);
    await waitFor(() => isTerminal(status(mailbox, deliveryId)));
    const nextId = (await runCauseEffect(second.agents.sendMessage({ agentId: agent.id, text: "Next message." })))
      .deliveries[0]?.id;
    if (!nextId) return "The next message has no delivery.";
    await waitFor(() => isTerminal(status(mailbox, nextId)));
    const starts = readFileSync(logPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line): unknown => JSON.parse(line))
      .filter(
        (entry) =>
          isRecord(entry) &&
          getString(entry, "method") === "turn/start" &&
          getString(getRecord(entry, "params"), "clientUserMessageId") === deliveryId,
      ).length;
    details.turnStarts = starts;
    details.first = status(mailbox, deliveryId);
    details.next = status(mailbox, nextId);
    const row = turnRow(second.database, deliveryId);
    details.turnRow = row;
    if (starts !== 2) return "The refused delivery did not run again under the same turn id.";
    if (status(mailbox, deliveryId) !== "completed") return "The second run of the delivery did not complete.";
    if (status(mailbox, nextId) !== "completed") return "The next message did not run.";
    if (row?.status !== "completed") return "The stored turn of the second run did not complete.";
    return null;
  });

  await runCase("h: a running turn row that no thread names is closed at restart", async (details) => {
    const agent = second.store.list()[0];
    if (!agent?.threadId) return "No agent thread survived the restart.";
    // The agent's own chat, a task thread and a channel thread each keep one stale row.
    const taskThreadId = new AgentThreadStore(second.database).create({
      agentId: agent.id,
      origin: "user",
      title: "Stale turn task",
      titleSource: "auto",
    }).threadId;
    const channels = second.agents.channels.store;
    const channelId = `channel-${randomUUID()}`;
    channels.commit(randomUUID(), {
      channel: channels.create(channelId, {
        name: "stale-turns",
        title: "Stale turns",
        instructions: "",
        members: [{ agentId: agent.id }],
        leadAgentId: agent.id,
      }),
      messages: [],
      tasks: [],
      assignments: [],
    });
    const channelThreadId = channels.context(channelId, agent.id).threadId;
    const staleTurns = {
      agent: { threadId: agent.threadId, turnId: "stale-turn-of-a-dead-run" },
      task: { threadId: taskThreadId, turnId: "stale-task-turn-of-a-dead-run" },
      channel: { threadId: channelThreadId, turnId: "stale-channel-turn-of-a-dead-run" },
    };
    const insert = second.database.connection.prepare(
      `INSERT INTO projection_turns
         (turn_id, thread_id, provider_session_id, status, started_at, completed_at, last_event_sequence)
       VALUES (?, ?, NULL, 'running', ?, NULL, 0)`,
    );
    for (const stale of Object.values(staleTurns)) insert.run(stale.turnId, stale.threadId, new Date().toISOString());
    await shutdown(second);
    current = null;
    const third = await start();
    current = third;
    const thirdError = await initialize(third);
    details.initializeError = thirdError;
    const rows = Object.fromEntries(
      Object.entries(staleTurns).map(([kind, stale]) => [kind, turnRow(third.database, stale.turnId)]),
    );
    details.turnRows = rows;
    if (thirdError) return "The restart failed.";
    for (const [kind, row] of Object.entries(rows)) {
      if (!row) return `The stale ${kind} turn row is gone.`;
      if (row.status !== "interrupted" || !row.completedAt)
        return `The stale ${kind} turn row stays running after the restart.`;
    }
    return null;
  });

  report.passed = report.cases.length === 9 && report.cases.every((entry) => entry.passed);
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  if (current) await shutdown(current);
  report.codexStarts = codexStarts();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
