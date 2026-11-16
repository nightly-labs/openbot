// Checks #8645 end to end on the real `AgentService`, `OpenBotDatabase`, and Antigravity ACP
// driver against a fake Antigravity CLI 1.5.9:
// 1. A quiet routine run that calls `routine_no_update` gets guidance allowing `[[no-update]]` when
//    the model requires text to end a turn, replies `[[no-update]]`, succeeds, and leaves no
//    assistant message in the thread.
// 2. If Antigravity CLI 1.5.x still emits "\n⚠ Model produced invalid output.\nSem novidades."
//    after `routine_no_update`, the Antigravity flavor treats it as an empty-output completion so
//    the quiet routine run still succeeds with no error or assistant message.
// 3. `settleQuietChannelTurn` also drops `[[no-update]]` from quiet channel routine turns.
// 4. A normal chat turn that produces no output and emits "\n⚠ Model produced invalid output."
//    still fails so real empty-output errors are not hidden.
// `bun run test:antigravity-quiet-turn`. Writes .openbot-build/antigravity-quiet-turn-e2e/report.json.
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  AGENT_PROVIDERS,
  type ConversationSnapshot,
  ROUTINE_QUIET_ANSWER_ITEM_TYPE,
  type RoutineRun,
} from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { settleQuietChannelTurn } from "../src/backend/agent/routine-quiet-runs";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/antigravity-quiet-turn-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-antigravity-quiet-turn-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeLog = join(root, "antigravity.jsonl");
const agentEntry = resolve(import.meta.dirname, "provider-fakes/agents/antigravity-quiet-turn.ts");
const fakeBinary = join(root, process.platform === "win32" ? "antigravity.cmd" : "antigravity");

process.env.HOME = home;
process.env.GEMINI_HOME = join(root, "gemini");
process.env.FAKE_LOG = fakeLog;
process.env.OPENBOT_ANTIGRAVITY_PATH = fakeBinary;
mkdirSync(home, { recursive: true });
mkdirSync(process.env.GEMINI_HOME, { recursive: true });

if (process.platform === "win32") {
  writeFileSync(fakeBinary, `@echo off\r\n"${process.execPath}" "${agentEntry}" %*\r\n`);
} else {
  writeFileSync(fakeBinary, `#!/bin/sh\nexec "${process.execPath}" "${agentEntry}" "$@"\n`);
  chmodSync(fakeBinary, 0o755);
}

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

interface FakeLogEntry {
  method: string;
  sessionId?: string;
  text?: string;
}

const report: {
  passed: boolean;
  checks: { name: string; passed: boolean }[];
  runs: Record<string, { status: string; error: string | null; messages: number }>;
  error?: string;
} = { passed: false, checks: [], runs: {} };

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

async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

function fakeEntries(): FakeLogEntry[] {
  try {
    return readFileSync(fakeLog, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function pass(name: string, condition: boolean, detail?: unknown) {
  report.checks.push({ name, passed: condition });
  assert.ok(condition, detail === undefined ? name : `${name}: ${JSON.stringify(detail)}`);
}

const ended = (status: string | undefined) =>
  status === "completed" || status === "failed" || status === "interrupted" || status === "cancelled";

const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const agents = new AgentService({
  store,
  mailbox,
  browser,
  preferredProvider: "antigravity",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "antigravity"),
});

try {
  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Shaka",
      description: "Checks quiet Antigravity routine runs.",
      avatarSeed: "shaka",
      avatarHue: null,
      initialMessage: "Hello.",
    }),
  );
  await waitFor("agent thread", () => store.list().find((entry) => entry.id === agent.id)?.threadId);
  await waitFor("initial turn", () =>
    agents.listQueue(agent.id).deliveries.every((delivery) => ended(delivery.status)),
  );
  await runCauseEffect(agents.updateAgent({ agentId: agent.id, allowAutomation: true }));

  async function runQuietRoutine(name: string, instruction: string) {
    const routine = agents.createRoutine({
      agentId: agent.id,
      name,
      instruction,
      active: false,
      timezone: "UTC",
      schedule: { kind: "daily", time: "09:00" },
      runIn: "thread",
    });
    const started: RoutineRun = await runCauseEffect(
      agents.runRoutineFromAutomation({ agentId: agent.id, routineId: routine.id, payload: "" }),
    );
    const deliveryId = started.deliveryId;
    assert.ok(deliveryId, `${name}: missing deliveryId`);
    const delivery = await waitFor(`${name} delivery`, () => {
      const found = mailbox.getDelivery(deliveryId)?.delivery;
      return ended(found?.status) ? found : null;
    });
    const settled = await waitFor(`${name} run`, () => {
      const found = agents
        .listRoutineRuns({ agentId: agent.id, routineId: routine.id })
        .find((entry) => entry.id === started.id);
      return found && !["queued", "running"].includes(found.status) ? found : null;
    });
    const messages = delivery.turnId ? store.database.readTurnAssistantMessages(agent.id, delivery.turnId) : [];
    report.runs[name] = { status: settled.status, error: settled.error, messages: messages.length };
    return { delivery, settled, messages };
  }

  // 1. routine_no_update -> [[no-update]] marker
  const markerRun = await runQuietRoutine("Marker quiet", "CALL-NO-UPDATE-MARKER");
  const markerNote = fakeEntries().find((entry) => entry.method === "routine_no_update")?.text ?? "";
  pass(
    "routine_no_update tells models requiring text that they can reply with [[no-update]]",
    markerNote.includes('"quiet"') && markerNote.includes("[[no-update]]"),
    markerNote,
  );
  pass(
    "A quiet Antigravity routine ending with [[no-update]] succeeds with no assistant message",
    markerRun.settled.status === "succeeded" && markerRun.settled.error === null && markerRun.messages.length === 0,
    report.runs["Marker quiet"],
  );

  // 2. routine_no_update -> CLI 1.5.9 invalid-output warning + retry text
  const invalidRun = await runQuietRoutine("Invalid-output quiet", "CALL-NO-UPDATE-INVALID-OUTPUT");
  pass(
    "A quiet Antigravity routine whose empty step emits 'Model produced invalid output' still succeeds quietly",
    invalidRun.settled.status === "succeeded" && invalidRun.settled.error === null && invalidRun.messages.length === 0,
    report.runs["Invalid-output quiet"],
  );

  // 3. settleQuietChannelTurn drops [[no-update]] cleanly
  const channelSnapshot: ConversationSnapshot = {
    agentId: agent.id,
    threadId: "channel-thread",
    activeTurnId: null,
    revision: 1,
    messages: [
      {
        id: "msg-marker",
        turnId: "turn-channel",
        author: "assistant",
        text: "[[no-update]]",
        createdAt: new Date().toISOString(),
        status: "completed",
      },
      {
        id: "msg-note",
        turnId: "turn-channel",
        author: "assistant",
        text: "Checked PRs; nothing new.",
        createdAt: new Date().toISOString(),
        status: "completed",
      },
    ],
  };
  const channelQuiet = settleQuietChannelTurn(channelSnapshot, "turn-channel");
  pass(
    "settleQuietChannelTurn drops [[no-update]] and keeps non-marker text as quiet step",
    channelQuiet &&
      channelSnapshot.messages.length === 1 &&
      channelSnapshot.messages[0]?.id === "msg-note" &&
      channelSnapshot.messages[0]?.itemType === ROUTINE_QUIET_ANSWER_ITEM_TYPE,
    channelSnapshot.messages,
  );

  // 4. Normal chat turn without output that emits 'Model produced invalid output' still fails
  const failedReceipt = await runCauseEffect(
    agents.sendMessage({ agentId: agent.id, text: "EMPTY-INVALID-OUTPUT-NO-TOOL" }),
  );
  const failedDeliveryId = failedReceipt.deliveries[0]?.id;
  assert.ok(failedDeliveryId, "missing failed chat deliveryId");
  const failedDelivery = await waitFor("failed chat delivery", () => {
    const found = mailbox.getDelivery(failedDeliveryId)?.delivery;
    return ended(found?.status) ? found : null;
  });
  pass(
    "A normal Antigravity chat turn with no output still fails on 'Model produced invalid output'",
    failedDelivery.status === "failed",
    failedDelivery,
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
