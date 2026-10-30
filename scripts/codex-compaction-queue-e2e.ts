// Checks that a message sent while Codex compacts the context waits in the queue and runs after the
// compaction, and that no message fails because of a compaction (#1766). Runs the real agent
// service on a temporary profile with a fake Codex app-server that, like Codex 0.160.1, refuses
// `turn/start` with `ActiveTurnNotSteerable { turn_kind: Compact }` while a compaction turn runs.
// Four cases: a compaction that ends by itself, one that runs past the start deadline and ends by
// itself (#3466), one that the run deadline stops, and one that does not stop, so that OpenBot sends
// a turn that Codex refuses. Then a side thread: the runtime snapshot carries its context, and
// `compactTaskContext` compacts its session and not the agent's own chat (#3503). Last, a usage
// report that Codex sends while the stop ends it does not reach the closed database (#3808).
// `bun scripts/codex-compaction-queue-e2e.ts`. Writes .openbot-build/codex-compaction-queue-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { getString, isRecord } from "../src/backend/protocol";

const OUT = resolve(import.meta.dirname, "../.openbot-build/codex-compaction-queue-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-compaction-queue-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const logPath = join(root, "protocol.jsonl");
const controlPath = join(root, "control.json");
const fakeCodex = join(root, "codex");
// Codex must start the compaction in 1 s; a started compaction runs for 10 s at most.
const COMPACTION_TIMEOUT_MS = 1_000;

// Before the service modules load: the Codex process and the stores read the home folder.
process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.OPENBOT_CODEX_PATH = fakeCodex;
process.env.OPENBOT_FAKE_CODEX_LOG = logPath;
process.env.OPENBOT_FAKE_CODEX_CONTROL = controlPath;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { USAGE_CHANGE_DELAY_MS } = await import("../src/backend/agent/context-compaction");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

/**
 * A Codex app-server with the methods that the service calls. Each normal turn reports 90% of the
 * context window, so the next message starts a compaction. `control.json` sets how long the next
 * compaction runs and whether it ignores `turn/interrupt`.
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
let buffer = "";
let threads = 0;
let turns = 0;
/** threadId -> { turnId, finish } of the compaction turn that runs. */
const compacting = new Map();
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
// Like a Codex in the middle of a turn, it can report usage while OpenBot stops it (#3808).
process.on("SIGTERM", () => {
  if (!control().usageOnStop) process.exit(0);
  for (let thread = 1; thread <= threads; thread++) {
    const tokenUsage = { total: { totalTokens: 95000 }, last: { totalTokens: 95000 }, modelContextWindow: 100000 };
    write({ method: "thread/tokenUsage/updated", params: { threadId: "thread-" + thread, turnId: "turn-stop", tokenUsage } });
  }
  log({ usageOnStop: threads });
  process.stdout.write("", () => process.exit(0));
});
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
    case "thread/start": return write({ id: message.id, result: { thread: { id: "thread-" + (++threads), turns: [] } } });
    case "thread/resume": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "thread/unsubscribe": return write({ id: message.id, result: { status: "Unsubscribed" } });
    case "thread/turns/list":
    case "thread/items/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "thread/read": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "turn/start": {
      // Codex 0.160.1 \`start_or_steer_turn\`: an active compaction turn cannot take input.
      if (compacting.has(params.threadId)) {
        log({ refused: params.threadId });
        return write({ id: message.id, error: { code: -32603, message: "failed to submit turn input: ActiveTurnNotSteerable { turn_kind: Compact }" } });
      }
      const turnId = "turn-" + (++turns);
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      write({ method: "thread/tokenUsage/updated", params: { threadId: params.threadId, turnId, tokenUsage: { total: { totalTokens: 90000 }, last: { totalTokens: 90000 }, modelContextWindow: 100000 } } });
      setTimeout(() => {
        const item = { type: "agentMessage", id: "message-" + turnId, text: "Done.", phase: "final_answer" };
        write({ method: "item/completed", params: { threadId: params.threadId, turnId, item } });
        write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: turnId, status: "completed" } } });
      }, 50);
      return;
    }
    case "thread/compact/start": {
      const { compactionMs, ignoreInterrupt } = control();
      const turnId = "compact-turn-" + (++turns);
      const item = { type: "contextCompaction", id: "compact-item-" + turnId };
      write({ id: message.id, result: {} });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      write({ method: "item/started", params: { threadId: params.threadId, turnId, item } });
      const finish = (status) => {
        if (compacting.get(params.threadId)?.turnId !== turnId) return;
        compacting.delete(params.threadId);
        clearTimeout(timer);
        log({ compactionEnded: turnId, threadId: params.threadId, status });
        if (status === "completed") write({ method: "item/completed", params: { threadId: params.threadId, turnId, item } });
        write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: turnId, status } } });
      };
      const timer = setTimeout(() => finish("completed"), compactionMs);
      compacting.set(params.threadId, { turnId, finish, ignoreInterrupt });
      return;
    }
    case "turn/interrupt": {
      write({ id: message.id, result: {} });
      const compaction = compacting.get(params.threadId);
      if (compaction?.turnId === params.turnId) {
        if (!compaction.ignoreInterrupt) compaction.finish("interrupted");
        return;
      }
      return write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: params.turnId, status: "interrupted" } } });
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

/** One line of the fake Codex log: a message that OpenBot sent, or a fact that the fake reports. */
interface ProtocolEntry {
  method: string | null;
  threadId: string | null;
  turnId: string | null;
  refused: string | null;
  compactionEnded: string | null;
  status: string | null;
  usageOnStop: number | null;
}

interface CaseReport {
  name: string;
  compactionMs: number;
  ignoreInterrupt: boolean;
  threadId: string;
  statusWhileCompacting: string;
  finalStatus: string;
  finalError: string | null;
  compactionEnd: string | null;
  interruptSent: boolean;
  refusedStarts: number;
  passed: boolean;
}

const report: { compactionTimeoutMs: number; cases: CaseReport[]; passed: boolean; error?: string } = {
  compactionTimeoutMs: COMPACTION_TIMEOUT_MS,
  cases: [],
  passed: false,
};

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  beginTakeover: unused,
  endTakeover: () => {},
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
};

function protocol(): ProtocolEntry[] {
  try {
    return readFileSync(logPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => protocolEntry(JSON.parse(line)));
  } catch {
    return [];
  }
}

function protocolEntry(value: unknown): ProtocolEntry {
  const entry = isRecord(value) ? value : {};
  const params = isRecord(entry.params) ? entry.params : {};
  return {
    method: getString(entry, "method"),
    threadId: getString(params, "threadId") ?? getString(entry, "threadId"),
    turnId: getString(params, "turnId"),
    refused: getString(entry, "refused"),
    compactionEnded: getString(entry, "compactionEnded"),
    status: getString(entry, "status"),
    usageOnStop: typeof entry.usageOnStop === "number" ? entry.usageOnStop : null,
  };
}

/** Waits for a state of the service or of the fake Codex. */
async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

await writeFile(fakeCodex, FAKE_CODEX, { mode: 0o755 });
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const agents = new AgentService({
  store,
  mailbox,
  browser,
  preferredProvider: "codex",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
  contextCompactionTimeoutMs: COMPACTION_TIMEOUT_MS,
});
let stopped = false;

try {
  await runCauseEffect(agents.initialize());

  const cases = [
    {
      name: "compaction ends by itself",
      compactionMs: 400,
      ignoreInterrupt: false,
      end: "completed",
      interrupt: false,
    },
    {
      name: "compaction runs past the start deadline",
      compactionMs: 3_000,
      ignoreInterrupt: false,
      end: "completed",
      interrupt: false,
    },
    {
      name: "deadline stops the compaction",
      compactionMs: 60_000,
      ignoreInterrupt: false,
      end: "interrupted",
      interrupt: true,
    },
    {
      name: "refused start waits for the compaction",
      compactionMs: 12_000,
      ignoreInterrupt: true,
      end: "completed",
      interrupt: true,
    },
  ] as const;

  for (const [index, entry] of cases.entries()) {
    await writeFile(controlPath, JSON.stringify(entry));
    const agent = await runCauseEffect(
      agents.createAgent({
        name: `Compaction ${index + 1}`,
        description: "Checks the queue during a compaction.",
        avatarSeed: `compaction-${index}`,
        avatarHue: null,
        initialMessage: "First message.",
      }),
    );
    // The first turn reports 90% of the context window.
    const threadId = await waitFor("the first turn to end", () => {
      const session = store.activeProviderSession(agent.id)?.externalSessionId;
      const started = protocol().some((line) => line.method === "turn/start" && line.threadId === session);
      const busy = agents
        .listQueue(agent.id)
        .deliveries.some((delivery) => ["queued", "starting", "running"].includes(delivery.status));
      return session && started && !busy ? session : null;
    });

    const receipt = await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: "Second message." }));
    const deliveryId = receipt.deliveries[0]?.id;
    assert.ok(deliveryId, `${entry.name}: no delivery`);
    const compactionTurn = await waitFor("the compaction to start", () =>
      protocol().find((line) => line.method === "thread/compact/start" && line.threadId === threadId),
    );
    assert.ok(compactionTurn);
    const statusWhileCompacting = mailbox.getDelivery(deliveryId)?.delivery.status ?? "missing";

    const finalStatus = await waitFor("the second message to end", () => {
      const status = mailbox.getDelivery(deliveryId)?.delivery.status;
      return status === "completed" || status === "failed" || status === "interrupted" ? status : null;
    });
    const entries = protocol();
    const threadEntries = entries.filter((line) => line.threadId === threadId || line.refused === threadId);
    const result: CaseReport = {
      name: entry.name,
      compactionMs: entry.compactionMs,
      ignoreInterrupt: entry.ignoreInterrupt,
      threadId,
      statusWhileCompacting,
      finalStatus,
      finalError: mailbox.getDelivery(deliveryId)?.delivery.error ?? null,
      compactionEnd: entries.find((line) => line.compactionEnded && line.threadId === threadId)?.status ?? null,
      interruptSent: threadEntries.some(
        (line) => line.method === "turn/interrupt" && line.turnId?.startsWith("compact-turn-"),
      ),
      refusedStarts: threadEntries.filter((line) => line.refused === threadId).length,
      passed: false,
    };
    report.cases.push(result);
    assert.equal(result.statusWhileCompacting, "queued", `${entry.name}: the message did not wait`);
    assert.equal(result.finalStatus, "completed", `${entry.name}: ${result.finalError ?? result.finalStatus}`);
    assert.equal(result.compactionEnd, entry.end, `${entry.name}: the compaction did not end as expected`);
    assert.equal(result.interruptSent, entry.interrupt, `${entry.name}: turn/interrupt`);
    if (entry.ignoreInterrupt) assert.ok(result.refusedStarts > 0, "Codex refused no start");
    else assert.equal(result.refusedStarts, 0, `${entry.name}: Codex refused a start`);
    result.passed = true;
  }

  // A side thread shows its own context, and Compact compacts only its session (#3503).
  await writeFile(controlPath, JSON.stringify({ compactionMs: 200, ignoreInterrupt: false }));
  const owner = await runCauseEffect(
    agents.createAgent({
      name: "Side thread",
      description: "Checks the context of a side thread.",
      avatarSeed: "compaction-thread",
      avatarHue: null,
      initialMessage: "First message.",
    }),
  );
  const mainSession = await waitFor("the agent's first turn to end", () => {
    const session = store.activeProviderSession(owner.id)?.externalSessionId;
    const busy = agents.listQueue(owner.id).deliveries.some((delivery) => delivery.status !== "completed");
    return session && !busy ? session : null;
  });
  const mainContext = () =>
    agents.getRuntimeSnapshot().contextStates?.find((state) => state.agentId === owner.id) ?? null;
  const mainCompactStarts = () =>
    protocol().filter((line) => line.method === "thread/compact/start" && line.threadId === mainSession).length;
  // The agent's own first turn reports 90% too, so its chat compacts first.
  const mainBefore = await waitFor(
    "the agent's own compaction",
    () => mainContext()?.compaction?.status === "completed" && mainContext(),
  );
  const mainStartsBefore = mainCompactStarts();
  const task = await runCauseEffect(agents.startTask({ agentId: owner.id, text: "Thread message." }));
  const taskSession = await waitFor(
    "the thread session",
    () => store.database.activeProviderSession(task.threadId, "codex")?.externalSessionId,
  );
  const threadContext = () =>
    agents.getRuntimeSnapshot().threadContextStates?.find((state) => state.threadId === task.threadId) ?? null;
  const compactions = () => protocol().filter((line) => line.compactionEnded && line.threadId === taskSession);
  // The thread's turn reports 90% of the window, so the thread compacts at the end of the turn.
  const automatic = await waitFor("the thread's automatic compaction", () => {
    const state = threadContext();
    const idle = agents.listTasks(owner.id).tasks.find((candidate) => candidate.id === task.id)?.state === "idle";
    return idle && compactions().length === 1 && state?.compaction?.status === "completed" ? state : null;
  });
  await runCauseEffect(agents.compactTaskContext({ agentId: owner.id, taskId: task.id }));
  const manual = await waitFor("the thread's manual compaction", () => {
    const state = threadContext();
    return compactions().length === 2 && state?.compaction?.status === "completed" ? state : null;
  });
  const mainAfter = mainContext();
  const sideThread = {
    threadUsage: automatic.usage,
    automaticCompaction: automatic.compaction?.id ?? null,
    manualCompaction: manual.compaction?.id ?? null,
    threadCompactions: compactions().map((line) => line.status),
    mainCompactStarts: mainCompactStarts() - mainStartsBefore,
    mainContextUnchanged: JSON.stringify(mainAfter) === JSON.stringify(mainBefore),
  };
  Object.assign(report, { sideThread });
  assert.equal(sideThread.threadUsage?.usedTokens, 90_000, "side thread: no usage");
  assert.notEqual(sideThread.manualCompaction, sideThread.automaticCompaction, "side thread: no new compaction");
  assert.deepEqual(sideThread.threadCompactions, ["completed", "completed"], "side thread: compactions");
  assert.equal(sideThread.mainCompactStarts, 0, "side thread: the agent's own chat compacted");
  assert.ok(sideThread.mainContextUnchanged, "side thread: the agent's own context changed");

  // Codex reports usage while the stop ends it. The quit closes the database next, and a late
  // usage snapshot then failed with "OpenBot database is not initialized." (#3808).
  await writeFile(controlPath, JSON.stringify({ compactionMs: 200, ignoreInterrupt: false, usageOnStop: true }));
  const lateErrors: string[] = [];
  const collect = (error: unknown) => lateErrors.push(error instanceof Error ? error.message : String(error));
  process.on("uncaughtException", collect);
  await runCauseEffect(agents.stop());
  database.close();
  stopped = true;
  // Not a guessed delay: timers of the same delay fire in creation order, so a usage timer that the
  // stop started fires before this one.
  await new Promise((done) => setTimeout(done, USAGE_CHANGE_DELAY_MS));
  process.off("uncaughtException", collect);
  const usageOnStop = {
    reportedThreads: protocol().find((line) => line.usageOnStop !== null)?.usageOnStop ?? 0,
    lateErrors,
  };
  Object.assign(report, { usageOnStop });
  assert.ok(usageOnStop.reportedThreads > 0, "stop: Codex reported no usage");
  assert.deepEqual(usageOnStop.lateErrors, [], "stop: a late usage report used the closed database");
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  if (!stopped) {
    await runCauseEffect(agents.stop()).catch(() => {});
    database.close();
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
