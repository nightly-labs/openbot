// Checks the open-wait tools on the real SQLite stores and mailbox: an agent fills its open waits to
// the limit with `await_event`, gets its waits back in the refusal, lists them with `list_waits`,
// and closes one by ID. A second agent reads the counts that `list_agents` shows and closes a wait of
// the first agent with `agentId`. Each call goes through `AgentWaits.handleTool`, as the tool router
// sends it. No provider, account or network is started: the user's request is a mailbox delivery
// marked running for a synthetic turn.
// Run: `bun scripts/agent-waits-tools-e2e.ts`.
// Writes .openbot-build/agent-waits-tools-e2e/report.json.

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AgentEvent } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import type { OpenBotToolResponse } from "../src/backend/agent/routine-tools";
import { AgentStore } from "../src/backend/agent-store";
import { AgentWaitStore } from "../src/backend/agent-waits/agent-wait-store";
import { AgentWaits, AWAIT_EVENT_TOOL, CLOSE_WAIT_TOOL, LIST_WAITS_TOOL } from "../src/backend/agent-waits/agent-waits";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "agent-waits-tools-e2e");
const TURN_ID = "agent-waits-e2e-turn";

interface Step {
  name: string;
  passed: boolean;
  detail?: unknown;
  error?: string;
}

interface ListedWait {
  waitId: string;
  note: string;
  openedAt: string;
  routineId: string | null;
  wokenAt: string | null;
  hasRequestText: boolean;
}

const report: { passed: boolean; steps: Step[] } = { passed: false, steps: [] };

async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  process.stdout.write(`- ${name}\n`);
  try {
    const value = await run();
    report.steps.push({ name, passed: true, detail: value });
    return value;
  } catch (error) {
    report.steps.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/** The JSON body of a tool answer. */
function body(response: OpenBotToolResponse | null): { success: boolean; value: DynamicRecord } {
  assert.ok(response, "AgentWaits answers the tool.");
  const item = response.contentItems[0];
  assert.ok(item && item.type === "inputText", "The answer is text.");
  const value = JSON.parse(item.text);
  assert.ok(isDynamicRecord(value), "The answer is a JSON object.");
  return { success: response.success, value };
}

const root = await mkdtemp(join(tmpdir(), "openbot-agent-waits-"));
const database = new OpenBotDatabase(join(root, "state"));
const store = new AgentStore(join(root, "state"), join(root, "home"), database);
const mailbox = new MailboxStore(join(root, "state"), store.sharedRoot, database);
const conversation = new ConversationRuntime(
  store,
  () => {},
  () => store.list(),
);
const events: AgentEvent[] = [];
const waits = new AgentWaits({
  store: new AgentWaitStore({ database }),
  mailbox,
  hooks: {
    emit: (event) => events.push(event),
    ownsRoutine: () => true,
    hasRoutine: () => true,
    requireKnownAgent: (agentId) => {
      conversation.requireKnownAgent(agentId);
    },
  },
});

function call(agentId: string, tool: string, args: unknown) {
  return body(
    waits.handleTool(
      {
        threadId: `thread-${agentId}`,
        turnId: TURN_ID,
        callId: crypto.randomUUID(),
        namespace: "openbot",
        tool,
        arguments: args,
      },
      { agentId, inExecutionThread: false },
    ),
  );
}

function listed(value: DynamicRecord): ListedWait[] {
  assert.ok(Array.isArray(value.waits), "The answer lists waits.");
  return value.waits.map((wait: unknown) => {
    assert.ok(isDynamicRecord(wait), "Each wait is a JSON object.");
    assert.equal(typeof wait.waitId, "string");
    assert.equal(typeof wait.note, "string");
    assert.equal(typeof wait.openedAt, "string");
    return {
      waitId: String(wait.waitId),
      note: String(wait.note),
      openedAt: String(wait.openedAt),
      routineId: typeof wait.routineId === "string" ? wait.routineId : null,
      wokenAt: typeof wait.wokenAt === "string" ? wait.wokenAt : null,
      hasRequestText: "requestText" in wait,
    };
  });
}

try {
  await runCauseEffect(store.initialize());
  await runCauseEffect(mailbox.initialize());
  const worker = await runCauseEffect(
    store.createAgent({ name: "Deployer", description: "Waits for deploys", avatarSeed: "waits-a", avatarHue: null }),
  );
  const coordinator = await runCauseEffect(
    store.createAgent({
      name: "Coordinator",
      description: "Follows teammates",
      avatarSeed: "waits-b",
      avatarHue: null,
    }),
  );

  await step("The user's request runs in a turn of the worker", async () => {
    const receipt = await runCauseEffect(
      mailbox.enqueue({ sender: { kind: "user" }, recipientAgentIds: [worker.id], text: "Deploy and check the site." }),
    );
    const delivery = receipt.deliveries[0];
    assert.ok(delivery, "The request has a delivery.");
    await runCauseEffect(mailbox.markStarting(delivery.id));
    await runCauseEffect(mailbox.markRunning(delivery.id, TURN_ID));
    return { deliveryId: delivery.id };
  });

  await step("A note over the limit is refused with the limit, not as a missing note", async () => {
    const long = call(worker.id, AWAIT_EVENT_TOOL, { note: "x".repeat(INPUT_LIMITS.agentWaitNote + 1) });
    assert.equal(long.success, false);
    assert.match(String(long.value.error), new RegExp(String(INPUT_LIMITS.agentWaitNote)));
    const empty = call(worker.id, AWAIT_EVENT_TOOL, { note: " " });
    assert.equal(empty.success, false);
    assert.doesNotMatch(String(empty.value.error), new RegExp(String(INPUT_LIMITS.agentWaitNote)));
    return { long: long.value.error, empty: empty.value.error };
  });

  const opened = await step("await_event reports the count and warns near the limit", async () => {
    const ids: string[] = [];
    const answers: DynamicRecord[] = [];
    for (let index = 0; index < INPUT_LIMITS.agentWaits; index++) {
      const { success, value } = call(worker.id, AWAIT_EVENT_TOOL, { note: `Deploy ${index + 1}` });
      assert.equal(success, true);
      assert.equal(value.openWaits, index + 1);
      assert.equal(value.limit, INPUT_LIMITS.agentWaits);
      ids.push(String(value.waitId));
      answers.push(value);
    }
    assert.equal(answers[0]?.nearLimit, undefined, "A first wait has no warning.");
    assert.equal(typeof answers.at(-1)?.nearLimit, "string", "The last wait before the limit warns.");
    const firstWarning = answers.findIndex((value) => value.nearLimit !== undefined) + 1;
    assert.equal(firstWarning, INPUT_LIMITS.agentWaits - 3, "The warning starts three waits before the limit.");
    return { ids, firstWarningAt: firstWarning };
  });

  await step("At the limit, the refusal lists the open waits", async () => {
    const { success, value } = call(worker.id, AWAIT_EVENT_TOOL, { note: "One more" });
    assert.equal(success, false);
    assert.equal(typeof value.error, "string");
    const refused = listed(value);
    assert.equal(refused.length, INPUT_LIMITS.agentWaits);
    assert.ok(
      refused.some((wait) => wait.note === "Deploy 1"),
      "The refusal has the notes.",
    );
    assert.equal(refused[0]?.hasRequestText, false, "The list leaves the request text out.");
    return { error: value.error, listed: refused.length };
  });

  await step("list_waits returns the IDs, and close_wait closes one by ID", async () => {
    const before = listed(call(worker.id, LIST_WAITS_TOOL, {}).value);
    // Waits opened in the same millisecond sort by ID, so the IDs are compared as a set.
    assert.deepEqual(
      before.map((wait) => wait.waitId).sort(),
      [...opened.ids].sort(),
      "The list has the IDs that await_event returned.",
    );
    const target = before[0];
    assert.ok(target);
    assert.ok(target.openedAt);
    assert.equal(target.routineId, null);
    const closed = call(worker.id, CLOSE_WAIT_TOOL, { waitId: target.waitId });
    assert.equal(closed.success, true);
    const after = listed(call(worker.id, LIST_WAITS_TOOL, {}).value);
    assert.equal(after.length, INPUT_LIMITS.agentWaits - 1);
    assert.ok(!after.some((wait) => wait.waitId === target.waitId));
    const reopened = call(worker.id, AWAIT_EVENT_TOOL, { note: "One more" });
    assert.equal(reopened.success, true, "A new wait opens after one is closed.");
    return { closed: target.waitId, reopened: reopened.value.waitId };
  });

  await step("The counts for list_agents show the worker's open waits", async () => {
    const counts = waits.countByAgent();
    assert.equal(counts.get(worker.id), INPUT_LIMITS.agentWaits);
    assert.equal(counts.has(coordinator.id), false, "An agent with no waits has no count.");
    return Object.fromEntries(counts);
  });

  await step("A coordinator lists and closes a wait of another agent with agentId", async () => {
    const theirs = listed(call(coordinator.id, LIST_WAITS_TOOL, { agentId: worker.id }).value);
    assert.equal(theirs.length, INPUT_LIMITS.agentWaits);
    const target = theirs[1];
    assert.ok(target);
    const before = events.length;
    const closed = call(coordinator.id, CLOSE_WAIT_TOOL, { agentId: worker.id, waitId: target.waitId });
    assert.equal(closed.success, true);
    assert.ok(
      events.slice(before).some((event) => event.type === "waits-changed" && event.snapshot.agentId === worker.id),
      "The worker's chat gets the change.",
    );
    assert.equal(waits.list(worker.id).waits.length, INPUT_LIMITS.agentWaits - 1);
    const own = call(coordinator.id, CLOSE_WAIT_TOOL, { waitId: theirs[2]?.waitId });
    assert.equal(own.success, false, "Without agentId, close_wait closes only the caller's own waits.");
    return { closed: target.waitId };
  });

  await step("An unknown agentId is refused", async () => {
    const listing = call(coordinator.id, LIST_WAITS_TOOL, { agentId: "no-such-agent" });
    assert.equal(listing.success, false);
    const closing = call(coordinator.id, CLOSE_WAIT_TOOL, { agentId: "no-such-agent", waitId: "x" });
    assert.equal(closing.success, false);
    return { list: listing.value.error, close: closing.value.error };
  });

  report.passed = true;
} finally {
  conversation.dispose();
  database.close();
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
}
