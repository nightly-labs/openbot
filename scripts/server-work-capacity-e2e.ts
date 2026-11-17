// Exercises the real task policy, SQLite mailbox transitions and host TurnSlots with 50 lanes.
// A controlled turn boundary replaces the provider. This does not start 50 provider processes or
// prove DrainScheduler/provider cleanup. Run: bun scripts/server-work-capacity-e2e.ts
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AgentProviderId } from "@openbot/contracts/agent-providers";
import type { AgentSummary, QueueDelivery } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { TurnSlots } from "../src/backend/agent/turn-slots";
import { AgentStore } from "../src/backend/agent-store";
import { AgentTasks } from "../src/backend/agent-tasks/agent-tasks";
import { AgentThreadStore } from "../src/backend/agent-threads/agent-thread-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { defaultServerWorkPolicy, serverWorkPolicyForAgent } from "./server-work-fixture-policy";

const out = resolve(import.meta.dirname, "../.openbot-build/server-work-capacity-e2e");
await mkdir(out, { recursive: true });
const root = await mkdtemp(join(out, "profile-"));
const userData = join(root, "user-data");
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, join(root, "home"), database);
const mailbox = new MailboxStore(userData, store.sharedRoot, database);
const policy = defaultServerWorkPolicy();
let enabled = true;
let provider: AgentProviderId = "codex";
const checks: string[] = [];
const notCovered = [
  "Provider process startup, provider rate limits and measured resource use at 50 turns.",
  "DrainScheduler start/failure/cancellation event wiring and its global provider serialization guard.",
];
let passed = false;
let maximumActive = 0;

try {
  await runCauseEffect(store.initialize());
  await runCauseEffect(mailbox.initialize());
  const agent = await runCauseEffect(
    store.createAgent({
      name: "Capacity",
      description: "Isolated capacity fixture.",
      avatarSeed: "capacity",
      avatarHue: null,
    }),
  );
  const findAgent = (id: string): AgentSummary | undefined => {
    const found = store.list().find((candidate) => candidate.id === id);
    return found ? { ...found, provider } : undefined;
  };
  const conversation = new ConversationRuntime(
    store,
    () => {},
    () => store.list(),
  );
  const hooks = {
    emit: () => {},
    agent: findAgent,
    defaultTaskLimit: () => 50,
    serverWorkPolicy: (id: string) => serverWorkPolicyForAgent({ ...policy, enabled }, id),
    hold: () => null,
    queued: () => {},
    turnActive: () => false,
    archived: () => Effect.void,
  };
  const tasks = new AgentTasks({ store: new AgentThreadStore(database), mailbox, conversation, hooks });
  assert.equal(tasks.limit(agent.id), 50, "The fixture models an official host limit of 50.");
  assert.equal(tasks.oneTurnAtATime(agent.id), false);
  checks.push("the real AgentTasks controller uses the configured 50-turn fixture policy");

  const taskIds = Array.from({ length: 50 }, (_, index) => tasks.create(agent.id, `Work ${index + 1}`, "user").taskId);
  const lanes = new Map<string, string | null>([["main", null], ...taskIds.map((id): [string, string] => [id, id])]);
  const slots = new TurnSlots({
    limit: () => 50,
    lanes: () => [...lanes.keys()],
    isRunning: (id) => mailbox.laneActive(agent.id, lanes.get(id) ?? null),
    isWaiting: (id) => mailbox.nextQueued(agent.id, lanes.get(id) ?? null) !== null,
    head: (id) => mailbox.nextQueued(agent.id, lanes.get(id) ?? null)?.delivery ?? null,
  });
  const activeCount = () => [...lanes.values()].filter((id) => mailbox.laneActive(agent.id, id)).length;
  const currentHead = (id: string) => mailbox.nextQueued(agent.id, lanes.get(id) ?? null)?.delivery;
  async function enqueue(taskId: string | null, sender: QueueDelivery["sender"], text: string): Promise<string> {
    const receipt = await runCauseEffect(
      mailbox.enqueue({
        ...(taskId === null ? {} : { taskId }),
        sender,
        recipientAgentIds: [agent.id],
        text,
      }),
    );
    const delivery = receipt.deliveries[0];
    assert.ok(delivery);
    return delivery.id;
  }
  async function start(id: string): Promise<string> {
    assert.ok(slots.mayStart(id), `No host slot for ${id}.`);
    const delivery = currentHead(id);
    assert.ok(delivery);
    await runCauseEffect(mailbox.markStarting(delivery.id));
    await runCauseEffect(mailbox.markRunning(delivery.id, `turn-${delivery.id}`));
    maximumActive = Math.max(maximumActive, activeCount());
    assert.ok(activeCount() <= 50);
    return delivery.id;
  }

  for (const taskId of taskIds) await enqueue(taskId, { kind: "agent", agentId: "source-agent" }, "Independent work.");
  const active = new Map<string, string>();
  for (let index = 0; index < 50; index += 1) {
    const lane = taskIds.find((id) => currentHead(id) && slots.mayStart(id));
    assert.ok(lane, `Task ${index + 1} could not acquire a free slot.`);
    active.set(lane, await start(lane));
  }
  assert.equal(activeCount(), 50);
  assert.equal(tasks.snapshot(agent.id).tasks.filter((task) => task.state === "running").length, 50);
  const mainRequest = await enqueue(null, { kind: "user" }, "Main chat request after 50 starts.");
  assert.equal(slots.mayStart("main"), false);
  assert.equal(mailbox.getDelivery(mainRequest)?.delivery.status, "queued");
  checks.push("50 persisted independent turns acquire slots; a51st main turn stays queued at total50");

  const first = active.entries().next().value;
  assert.ok(first);
  await runCauseEffect(mailbox.markTerminal(first[1], "interrupted"));
  assert.equal(activeCount(), 49);
  const runningMain = await start("main");
  assert.equal(runningMain, mainRequest);
  assert.equal(activeCount(), 50);
  checks.push("an interrupted turn releases a slot that the waiting main request acquires");

  const botFollowup = await enqueue(first[0], { kind: "agent", agentId: "source-agent" }, "Older independent work.");
  const nextMain = await enqueue(null, { kind: "user" }, "Newer user work.");
  await runCauseEffect(mailbox.markTerminal(runningMain, "completed"));
  assert.equal(slots.mayStart(first[0]), false);
  assert.equal(slots.mayStart("main"), true);
  assert.equal(await start("main"), nextMain);
  checks.push("the real host gate gives a user main request priority over older agent work");

  const second = [...active.entries()].find(([id]) => id !== first[0]);
  assert.ok(second);
  await runCauseEffect(mailbox.markTerminal(second[1], "failed", "Controlled provider failure."));
  assert.equal(activeCount(), 49);
  assert.equal(await start(first[0]), botFollowup);
  assert.equal(activeCount(), 50);
  checks.push("a failed turn releases a slot for the queued independent turn");

  const sameThread = await enqueue(first[0], { kind: "user" }, "Follow-up in the running conversation.");
  assert.equal(mailbox.nextQueued(agent.id, first[0]), null);
  assert.equal(mailbox.getDelivery(sameThread)?.delivery.status, "queued");
  await runCauseEffect(mailbox.cancel(agent.id, sameThread));
  assert.equal(mailbox.getDelivery(sameThread)?.delivery.status, "cancelled");
  assert.equal(activeCount(), 50);
  checks.push("a same-thread follow-up stays serial; cancelling queued work does not alter active slots");
  assert.throws(() => tasks.create(agent.id, "Thread51", "user"));
  checks.push("the51st open side thread is refused without exceeding the released50-thread bound");

  enabled = false;
  await runCauseEffect(store.updateAgent({ agentId: agent.id, taskLimit: 4 }));
  assert.equal(tasks.limit(agent.id), 4);
  enabled = true;
  provider = "acp";
  assert.equal(tasks.limit(agent.id), 1);
  assert.equal(tasks.oneTurnAtATime(agent.id), true);
  checks.push("disabled Thread policy restores the saved agent limit; an ACP provider still runs one turn");
  passed = true;
} finally {
  database.close();
  await writeFile(
    join(out, "report.json"),
    `${JSON.stringify({ passed, profile: root, maximumActive, checks, notCovered }, null, 2)}\n`,
  );
}
