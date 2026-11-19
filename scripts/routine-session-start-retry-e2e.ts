import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/routine-session-start-retry-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-routine-start-retry-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeCodex = join(root, "codex");
const fakeLog = join(root, "codex.jsonl");
const fakeHang = join(root, "hang");

const ROUTINE_WAITS_MS = new Set([5 * 60_000, 15 * 60_000, 30 * 60_000]);
const SPEED = 300;
const nativeSetTimeout = globalThis.setTimeout;
function fasterSetTimeout(...args: Parameters<typeof setTimeout>) {
  const [handler, delay, ...rest] = args;
  const faster = typeof delay === "number" && ROUTINE_WAITS_MS.has(delay) ? delay / SPEED : delay;
  return nativeSetTimeout(handler, faster, ...rest);
}
Object.defineProperty(globalThis, "setTimeout", { value: fasterSetTimeout, configurable: true, writable: true });

process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.OPENBOT_CODEX_PATH = fakeCodex;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

const FAKE_CODEX = `#!/usr/bin/env node
const { appendFileSync, existsSync } = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.170.0\\n");
  process.exit(0);
}
const LOG = ${JSON.stringify(fakeLog)};
const HANG = ${JSON.stringify(fakeHang)};
const config = { config: { mcp_servers: {} }, layers: [] };
let buffer = "";
let threads = 0;
let turns = 0;
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const log = (entry) => appendFileSync(LOG, JSON.stringify(entry) + "\\n");
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const answer = (message) => {
  const params = message.params || {};
  switch (message.method) {
    case "initialize": return write({ id: message.id, result: {} });
    case "account/read": return write({ id: message.id, result: { account: { type: "chatgpt", email: "codex@example.com" } } });
    case "account/rateLimits/read": return write({ id: message.id, result: { rateLimits: { limitId: "codex", primary: null, secondary: null }, rateLimitsByLimitId: null } });
    case "model/list": return write({ id: message.id, result: { data: [{ model: "gpt-6-luna", displayName: "GPT-6 Luna" }] } });
    case "plugin/list": return write({ id: message.id, result: { marketplaces: [] } });
    case "config/read": return write({ id: message.id, result: config });
    case "config/batchWrite": return write({ id: message.id, result: {} });
    case "thread/start": {
      if (existsSync(HANG)) return log({ method: "thread/start", hung: true });
      const id = "thread-" + (++threads);
      log({ method: "thread/start", hung: false, threadId: id });
      return write({ id: message.id, result: { thread: { id, turns: [] } } });
    }
    case "thread/resume": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "thread/unsubscribe": return write({ id: message.id, result: { status: "Unsubscribed" } });
    case "thread/archive": return write({ id: message.id, result: {} });
    case "thread/turns/list":
    case "thread/items/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "thread/read": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "turn/start": {
      const turnId = "turn-" + (++turns);
      log({ method: "turn/start", threadId: params.threadId, turnId });
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      const item = { type: "agentMessage", id: "message-" + turnId, text: "Report: all good.", phase: "final_answer" };
      write({ method: "item/completed", params: { threadId: params.threadId, turnId, item } });
      return write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: turnId, status: "completed" } } });
    }
    case "turn/interrupt": {
      write({ id: message.id, result: {} });
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
      if (message.method && message.id !== undefined) answer(message);
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

interface LogEntry {
  method: string;
  hung?: boolean;
  threadId?: string;
}

const report: {
  recovered?: { hungStarts: number; statusWhileWaiting: string; finalStatus: string; runStatus: string };
  stuck?: { hungStarts: number; finalStatus: string; error: string | null; runStatus: string };
  checks: { name: string; passed: boolean }[];
  passed: boolean;
  error?: string;
} = { checks: [], passed: false };

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  prepareSecret: unused,
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
  shareTab: () => undefined,
  unshareThread: () => undefined,
  agentTab: () => null,
};

async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => nativeSetTimeout(done, 50));
  }
}

function fakeEntries(): LogEntry[] {
  if (!existsSync(fakeLog)) return [];
  return readFileSync(fakeLog, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const hungStarts = () => fakeEntries().filter((entry) => entry.method === "thread/start" && entry.hung).length;

function pass(name: string, condition: boolean, detail?: string) {
  report.checks.push({ name, passed: condition });
  assert.ok(condition, detail ? `${name}: ${detail}` : name);
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
});

const status = (deliveryId: string) => mailbox.getDelivery(deliveryId)?.delivery.status ?? "missing";
const ended = (deliveryId: string) => {
  const value = status(deliveryId);
  return value === "completed" || value === "failed" || value === "interrupted" ? value : null;
};

try {
  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Supervisor",
      description: "Checks progress.",
      avatarSeed: "supervisor",
      avatarHue: null,
      initialMessage: "Hello.",
    }),
  );
  await waitFor(
    "the first chat turn to end",
    () =>
      agents
        .listQueue(agent.id)
        .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status)),
    60_000,
  );
  const routine = agents.createRoutine({
    agentId: agent.id,
    name: "Progress check",
    instruction: "Check the progress and report.",
    active: false,
    timezone: "UTC",
    schedule: { kind: "daily", time: "09:00" },
    runIn: "thread",
  });
  const runStatus = (deliveryId: string) =>
    agents.listRoutineRuns({ agentId: agent.id, routineId: routine.id }).find((run) => run.deliveryId === deliveryId)
      ?.status ?? "missing";

  await writeFile(fakeHang, "");
  const first = await runCauseEffect(agents.testRoutine({ agentId: agent.id, routineId: routine.id }));
  assert.ok(first.deliveryId, "first run: no delivery");
  const firstId = first.deliveryId;
  await waitFor("the first session start to hang", () => hungStarts() === 1, 10_000);
  const waitingStatus = await waitFor(
    "the run to wait after the timeout",
    () => (status(firstId) === "queued" ? "queued" : ended(firstId) ? `ended:${status(firstId)}` : null),
    45_000,
  );
  pass("A run whose session did not open waits in the queue", waitingStatus === "queued", waitingStatus);
  await rm(fakeHang);
  const firstEnd = await waitFor("the first run to end", () => ended(firstId), 60_000);
  const firstRun = await waitFor(
    "the first run record",
    () => (runStatus(firstId) === "succeeded" ? "succeeded" : null),
    10_000,
  );
  report.recovered = {
    hungStarts: hungStarts(),
    statusWhileWaiting: waitingStatus,
    finalStatus: firstEnd,
    runStatus: firstRun,
  };
  pass(
    "The run starts again and finishes when Codex answers",
    firstEnd === "completed",
    mailbox.getDelivery(firstId)?.delivery.error ?? firstEnd,
  );

  const hungBefore = hungStarts();
  await writeFile(fakeHang, "");
  const second = await runCauseEffect(agents.testRoutine({ agentId: agent.id, routineId: routine.id }));
  assert.ok(second.deliveryId, "second run: no delivery");
  const secondId = second.deliveryId;
  const secondEnd = await waitFor("the second run to end", () => ended(secondId), 4 * 45_000);
  const error = mailbox.getDelivery(secondId)?.delivery.error ?? null;
  const secondRun = await waitFor(
    "the second run record",
    () => (runStatus(secondId) === "failed" ? "failed" : null),
    10_000,
  );
  report.stuck = { hungStarts: hungStarts() - hungBefore, finalStatus: secondEnd, error, runStatus: secondRun };
  pass("A run whose session never opens tries 4 times", report.stuck.hungStarts === 4, String(report.stuck.hungStarts));
  pass("Then the run fails", secondEnd === "failed", secondEnd);
  pass(
    "The failure says what to do, with no protocol words",
    Boolean(
      error?.includes("did not open a new chat in time") &&
        error.includes("Restart") &&
        !error.includes("thread/start"),
    ),
    String(error),
  );
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
