// Criterion 6 B: package-context handoffs through real DrainScheduler + ThreadLifecycle.startRoutineThread.
// Fake Codex records thread/start and turn/start. Marked package deliveries must get distinct routine
// sessions (persistSession: false; ephemeral: false per #8743) with no ambient chat/earlier-run
// sentinels; an ordinary routine must still receive ambient.
// omitAmbientHistory comes from batchOmitsAmbientHistory in drain (not a test-only mirror).
//
// Run: bun scripts/workflow-package-session-e2e.ts
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { getString, isRecord } from "../src/backend/protocol";
import {
  batchOmitsAmbientHistory,
  isWorkflowPackageContext,
  withWorkflowPackageContext,
} from "../src/backend/workflows/workflow-package-context";

const OUT = resolve(import.meta.dirname, "../.openbot-build/workflow-package-session-e2e");
const DRAIN_SOURCE = resolve(import.meta.dirname, "../src/backend/agent/drain-scheduler.ts");
const root = await mkdtemp(join(tmpdir(), "openbot-workflow-package-session-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeCodex = join(root, "codex");
const fakeLog = join(root, "codex.jsonl");

process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.OPENBOT_CODEX_PATH = fakeCodex;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

const MAIN_CHAT_SENTINEL = "MAIN_CHAT_SENTINEL_unrelated_alpha";
const OTHER_PACKAGE_SENTINEL = "OTHER_PACKAGE_SENTINEL_bruce_history";
const FOREMAN_BRIEF = "Foreman package brief UNIQUE_A";
const BRUCE_BRIEF = "Bruce package brief UNIQUE_B";
const ORDINARY_MARK = "ORDINARY_ROUTINE_MARK";

interface Report {
  checks: string[];
  sessions: { id: string; payload: string }[];
  passed: boolean;
  failure?: string;
}

const report: Report = { checks: [], sessions: [], passed: false };
const check = (name: string, ok: boolean, detail?: unknown) => {
  assert.ok(ok, `${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  report.checks.push(name);
};

const FAKE_CODEX = `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\\n");
  process.exit(0);
}
const LOG = ${JSON.stringify(fakeLog)};
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
let buffer = "";
let threads = 0;
let turns = 0;
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const log = (entry) => appendFileSync(LOG, JSON.stringify(entry) + "\\n");
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const breakdown = (input, cached, output) => ({ totalTokens: input + output, inputTokens: input, cachedInputTokens: cached, cacheWriteInputTokens: 0, outputTokens: output, reasoningOutputTokens: 0 });
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
      const id = "thread-" + (++threads);
      log({ method: "thread/start", threadId: id, ephemeral: params.ephemeral ?? null, persistSession: params.persistSession ?? null });
      return write({ id: message.id, result: { thread: { id, turns: [] } } });
    }
    case "thread/resume":
      log({ method: "thread/resume", threadId: params.threadId });
      return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "thread/unsubscribe":
      log({ method: "thread/unsubscribe", threadId: params.threadId });
      return write({ id: message.id, result: { status: "Unsubscribed" } });
    case "thread/turns/list":
    case "thread/items/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "thread/read": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "turn/start": {
      const turnId = "turn-" + (++turns);
      const text = (params.input || []).map((item) => item.text || "").join("\\n");
      log({ method: "turn/start", threadId: params.threadId, turnId, text });
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      write({ method: "thread/tokenUsage/updated", params: { threadId: params.threadId, turnId, tokenUsage: { total: breakdown(1000, 0, 50), last: breakdown(1000, 0, 50), modelContextWindow: 1000000 } } });
      setTimeout(() => {
        const item = { type: "agentMessage", id: "message-" + turnId, text: "Done.", phase: "final_answer" };
        write({ method: "item/completed", params: { threadId: params.threadId, turnId, item } });
        write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: turnId, status: "completed" } } });
      }, 10);
      return;
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
  shareTab: () => undefined,
  unshareThread: () => undefined,
  agentTab: () => null,
};

interface FakeLogEntry {
  method?: string;
  threadId?: string;
  turnId?: string;
  text?: string;
  ephemeral?: boolean | null;
  persistSession?: boolean | null;
}

function fakeEntries(): FakeLogEntry[] {
  try {
    return readFileSync(fakeLog, "utf8")
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        const parsed = JSON.parse(line);
        if (!isRecord(parsed)) return [];
        return [
          {
            method: getString(parsed, "method") ?? undefined,
            threadId: getString(parsed, "threadId") ?? undefined,
            turnId: getString(parsed, "turnId") ?? undefined,
            text: getString(parsed, "text") ?? undefined,
            ephemeral:
              typeof parsed.ephemeral === "boolean" ? parsed.ephemeral : parsed.ephemeral === null ? null : undefined,
            persistSession:
              typeof parsed.persistSession === "boolean"
                ? parsed.persistSession
                : parsed.persistSession === null
                  ? null
                  : undefined,
          },
        ];
      });
  } catch {
    return [];
  }
}

async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

const ended = (status: string | undefined) =>
  status === "completed" || status === "failed" || status === "interrupted" || status === "cancelled";

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

try {
  const drainSource = readFileSync(DRAIN_SOURCE, "utf8");
  check(
    "drain passes batchOmitsAmbientHistory into startRoutineThread",
    /omitAmbientHistory\s*=\s*batchOmitsAmbientHistory\(batch\)/.test(drainSource) &&
      drainSource.includes("startRoutineThread(agent, client, execution?.threadId, { omitAmbientHistory })"),
  );
  check(
    "drainRoutineSessionFirstTurn is not a production drain path",
    !drainSource.includes("drainRoutineSessionFirstTurn"),
  );

  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Package session",
      description: "Criterion 6 package-session fixture",
      avatarSeed: "package-session",
      avatarHue: null,
      initialMessage: "Hello.",
    }),
  );
  await waitFor("agent thread", () => store.list().find((entry) => entry.id === agent.id)?.threadId);
  await waitFor("initial turn settled", () =>
    agents.listQueue(agent.id).deliveries.every((delivery) => ended(delivery.status)),
  );

  // Seed ambient chat history that startRoutineThread would inject when omitAmbientHistory is false.
  await runCauseEffect(
    agents.sendMessage({
      agentId: agent.id,
      text: `Chat context with ${MAIN_CHAT_SENTINEL} and earlier note ${OTHER_PACKAGE_SENTINEL}.`,
    }),
  );
  await waitFor("ambient seed settled", () =>
    agents.listQueue(agent.id).deliveries.every((delivery) => ended(delivery.status)),
  );

  const packageInstruction = (caseId: string, brief: string, runLabel: string) =>
    withWorkflowPackageContext(
      [
        `Workflow ID: workflow-shared-00`,
        `Workflow run ID: ${runLabel}`,
        `Case bindings:\ncaseId=${caseId}\ninput=${brief}`,
        `Predecessor output: step-prompt for ${caseId}`,
      ].join("\n\n"),
    );

  const foremanText = packageInstruction("product-foreman", FOREMAN_BRIEF, "run-foreman-1");
  const bruceText = packageInstruction("product-bruce", BRUCE_BRIEF, "run-bruce-1");
  check("foreman delivery text is package-context", isWorkflowPackageContext(foremanText));
  check("bruce delivery text is package-context", isWorkflowPackageContext(bruceText));
  check(
    "batchOmitsAmbientHistory true for marked package batch",
    batchOmitsAmbientHistory([
      {
        delivery: {
          sender: { kind: "routine" },
          text: foremanText,
        },
      },
    ]),
  );

  async function runMarkedRoutine(name: string, instruction: string) {
    const routine = agents.createRoutine({
      agentId: agent.id,
      name,
      instruction,
      active: false,
      timezone: "UTC",
      schedule: { kind: "daily", time: "09:00" },
      runIn: "thread",
    });
    const beforeTurns = fakeEntries().filter((entry) => entry.method === "turn/start").length;
    const beforeStarts = fakeEntries().filter((entry) => entry.method === "thread/start").length;
    const queued = await runCauseEffect(agents.testRoutine({ agentId: agent.id, routineId: routine.id }));
    const deliveryId = queued.deliveryId;
    assert.ok(deliveryId, `${name}: no delivery`);
    await waitFor(`${name} delivery settled`, () => {
      const found = mailbox.getDelivery(deliveryId)?.delivery;
      return ended(found?.status) ? found : null;
    });
    const turn = await waitFor(`${name} turn/start`, () => {
      const turns = fakeEntries().filter((entry) => entry.method === "turn/start");
      return turns.length > beforeTurns ? (turns.at(-1) ?? null) : null;
    });
    const starts = fakeEntries().filter((entry) => entry.method === "thread/start");
    const newStarts = starts.slice(beforeStarts);
    // Routine sessions are not ephemeral (#8743); they still start a fresh non-persisted thread.
    const routineStart = newStarts.find((entry) => entry.persistSession === false && entry.ephemeral === false);
    assert.ok(routineStart, `${name}: no routine thread/start (persistSession:false)`);
    const threadId = routineStart.threadId;
    assert.ok(threadId, `${name}: missing thread id`);
    check(`${name} turn used the new routine session`, turn.threadId === threadId);
    return { threadId, text: String(turn.text ?? ""), deliveryId };
  }

  const foreman = await runMarkedRoutine("Foreman package", foremanText);
  const bruce = await runMarkedRoutine("Bruce package", bruceText);
  report.sessions.push({ id: foreman.threadId, payload: foreman.text }, { id: bruce.threadId, payload: bruce.text });

  check("two package handoffs use distinct provider session ids", foreman.threadId !== bruce.threadId);
  for (const [label, session, brief, caseId] of [
    ["product-foreman", foreman, FOREMAN_BRIEF, "product-foreman"],
    ["product-bruce", bruce, BRUCE_BRIEF, "product-bruce"],
  ] as const) {
    check(`marker stripped from first-turn for ${label}`, !session.text.includes("OpenBot-Package-Context:"));
    check(
      `required brief present for ${label}`,
      session.text.includes(brief) && session.text.includes(`caseId=${caseId}`),
    );
    check(
      `unrelated ambient sentinels absent for ${label}`,
      !session.text.includes(MAIN_CHAT_SENTINEL) &&
        !session.text.includes(OTHER_PACKAGE_SENTINEL) &&
        !session.text.includes("--- recent messages ---"),
    );
    check(
      `complete first-turn payload clean for ${session.threadId}`,
      session.text.includes("Workflow ID:") &&
        session.text.includes("Case bindings:") &&
        session.text.includes("Predecessor output:") &&
        !session.text.includes("Continue this OpenBot conversation."),
    );
  }
  check(
    "two package first-turns stay disjoint",
    foreman.text.includes(FOREMAN_BRIEF) &&
      bruce.text.includes(BRUCE_BRIEF) &&
      !foreman.text.includes(BRUCE_BRIEF) &&
      !bruce.text.includes(FOREMAN_BRIEF),
  );

  // Ordinary routine (no marker): production must still inject ambient — proves omit propagation matters.
  const ordinary = agents.createRoutine({
    agentId: agent.id,
    name: "Ordinary routine",
    instruction: `${ORDINARY_MARK}: ordinary task without package marker.`,
    active: false,
    timezone: "UTC",
    schedule: { kind: "daily", time: "11:00" },
    runIn: "thread",
  });
  check(
    "ordinary instruction is not package-context",
    !isWorkflowPackageContext(ordinary.instruction) &&
      !batchOmitsAmbientHistory([{ delivery: { sender: { kind: "routine" }, text: ordinary.instruction } }]),
  );
  const beforeOrdinary = fakeEntries().filter((entry) => entry.method === "turn/start").length;
  const ordinaryQueued = await runCauseEffect(agents.testRoutine({ agentId: agent.id, routineId: ordinary.id }));
  const ordinaryDeliveryId = ordinaryQueued.deliveryId;
  assert.ok(ordinaryDeliveryId);
  await waitFor("ordinary delivery settled", () => {
    const found = mailbox.getDelivery(ordinaryDeliveryId)?.delivery;
    return ended(found?.status) ? found : null;
  });
  const ordinaryTurn = await waitFor("ordinary turn/start", () => {
    const turns = fakeEntries().filter((entry) => entry.method === "turn/start");
    return turns.length > beforeOrdinary ? (turns.at(-1) ?? null) : null;
  });
  const ordinaryText = String(ordinaryTurn.text ?? "");
  check(
    "ordinary routine still receives ambient history (new session alone is not clean)",
    ordinaryText.includes(ORDINARY_MARK) &&
      ordinaryText.includes(MAIN_CHAT_SENTINEL) &&
      ordinaryText.includes("--- recent messages ---"),
  );
  check(
    "disabling omit propagation would fail: marked packages stay clean while ordinary has ambient",
    !foreman.text.includes(MAIN_CHAT_SENTINEL) &&
      !bruce.text.includes(MAIN_CHAT_SENTINEL) &&
      ordinaryText.includes(MAIN_CHAT_SENTINEL),
  );

  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  report.passed = false;
} finally {
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  await rm(root, { recursive: true, force: true });
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);

process.stdout.write(
  `${report.passed ? "workflow-package-session-e2e passed" : "FAILED"}: ${report.checks.length} checks; ${OUT}/report.json\n`,
);
if (report.failure) process.stderr.write(`${report.failure}\n`);
process.exitCode = report.passed ? 0 : 1;
