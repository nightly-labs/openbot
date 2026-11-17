// Differential real-store fixture against the pinned upstream main source, with isolated SQLite profiles.
// Requires the pinned baseline commit in local Git history. No live profile or provider is used.
// Run: bun scripts/mailbox-read-index-e2e.ts
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const output = join(projectRoot, ".openbot-build", "mailbox-read-index-e2e");
mkdirSync(output, { recursive: true });
const baselineCommit = "94c8649ca94cb2e120d491ae946f17f9980aec90";
const originalPath = join(projectRoot, "src/backend/mailbox-store.ts");
const baselinePath = join(output, "mailbox-baseline.ts");
const baseline = spawnSync("git", ["show", `${baselineCommit}:src/backend/mailbox-store.ts`], {
  cwd: projectRoot,
  encoding: "utf8",
  windowsHide: true,
  maxBuffer: 2 * 1024 * 1024,
});
assert.ifError(baseline.error);
assert.equal(baseline.status, 0, "The pinned released mailbox baseline must be available in Git history.");
const baselineSha256 = createHash("sha256").update(baseline.stdout).digest("hex");
// Preserve the actual baseline implementation; relocate only its relative import specifiers.
const relocated = baseline.stdout.replace(
  /\bfrom\s+(["'])(\.[^"']+)\1/gu,
  (_match, _quote, path: string) =>
    `from ${JSON.stringify(resolve(dirname(originalPath), path).replaceAll("\\", "/"))}`,
);
writeFileSync(baselinePath, relocated);
const modulePaths = {
  current: originalPath,
  baseline: baselinePath,
  database: join(projectRoot, "src/backend/openbot-database.ts"),
  effects: join(projectRoot, "src/backend/effect-boundary.ts"),
};
let source =
  `const output = ${JSON.stringify(output)};\nconst provenance = ${JSON.stringify({ baselineCommit, baselineSha256 })};\n` +
  String.raw`
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const { MailboxStore: CurrentMailbox } = await IMPORT_CURRENT;
const { MailboxStore: BaselineMailbox } = await IMPORT_BASELINE;
const { OpenBotDatabase } = await IMPORT_DATABASE;
const { runCauseEffect } = await IMPORT_EFFECTS;
const report = { passed: false, ...provenance, checks: [], timings: {}, limitations: [
  "Synthetic isolated profiles and public real-store methods; this is not a live server or provider benchmark.",
  "Timings are recorded without a hardware-dependent pass threshold. Compare live CPU profiles separately.",
] };
const opened = [];
try {
  const seed = { version: 3, messages: [], deliveries: [], drafts: [], generatedAttachments: [], pausedAgentIds: [], idempotency: {}, reactions: [] };
  function add(id, sender, recipients, extra = {}, status = "completed") {
    const createdAt = new Date(Date.UTC(2026, 0, 1) + seed.messages.length * 1000).toISOString();
    const message = { id, sender, text: "Fixture " + id, attachments: [], replyToMessageId: null, createdAt, ...extra };
    seed.messages.push(message);
    for (const recipientAgentId of recipients) seed.deliveries.push({ id: id + ":" + recipientAgentId, messageId: id,
      recipientAgentId, queueOrder: seed.deliveries.length, status, turnId: status === "running" ? "old-live-turn" : null,
      error: null, createdAt });
  }
  const messagingLane = "\u0001messaging";
  let separateMessaging = true;
  add("external-active", { kind: "user" }, ["external-agent"], { messaging: { linkId: "policy-link", authorId: "author", authorName: "Fixture", platformMessageId: "external-active" } }, "running");
  add("external-queued", { kind: "user" }, ["external-agent"], { messaging: { linkId: "policy-link", authorId: "author", authorName: "Fixture", platformMessageId: "external-queued" } }, "queued");
  add("external-main", { kind: "user" }, ["external-agent"], {}, "queued");
  add("initial-request", { kind: "agent", agentId: "steer-sender" }, ["steer-agent"], {}, "queued");
  add("question-back", { kind: "agent", agentId: "steer-sender" }, ["steer-agent"], { replyToMessageId: "initial-request" }, "queued");
  add("single-answer", { kind: "agent", agentId: "steer-agent" }, ["steer-sender"], { replyToMessageId: "initial-request", expectsReply: false }, "queued");
  add("answered-request", { kind: "agent", agentId: "answer-owner" }, ["answer-agent"], {}, "running");
  add("own-reply", { kind: "agent", agentId: "answer-agent" }, ["answer-owner"], { replyToMessageId: "answered-request", expectsReply: false });
  add("old-active", { kind: "user" }, ["agent-0"], {}, "running");
  for (let i = 0; i < 12000; i++) {
    const extra = i % 17 === 0 ? { channelId: "fixture-channel" }
      : i % 19 === 0 ? { messaging: { linkId: "link", authorId: "author", authorName: "Fixture", platformMessageId: "external-" + i } }
      : i % 11 === 0 ? { taskId: "historical-task-" + (i % 50) } : {};
    add("history-" + i, { kind: "agent", agentId: "agent-" + ((i + 1) % 40) }, ["agent-" + (i % 40)], extra);
  }
  for (let i = 0; i < 50; i++) add("work-" + i, { kind: "user" }, ["agent-0"], { taskId: "task-" + i }, "queued");
  add("movable", { kind: "user" }, ["agent-0"], {}, "queued");
  add("task-answer", { kind: "agent", agentId: "agent-1" }, ["agent-0"], { taskId: "answer-task", senderTaskId: "source-task" }, "queued");
  add("multi-request", { kind: "agent", agentId: "reply-owner" }, ["teammate-1", "teammate-2"], {}, "queued");
  add("multi-answer", { kind: "agent", agentId: "teammate-1" }, ["reply-owner"], { replyToMessageId: "multi-request", expectsReply: false }, "queued");
  add("steered", { kind: "user" }, ["agent-2"], {}, "running");
  seed.deliveries.at(-1).steeredAt = "2026-06-01T00:00:00.000Z";
  add("provider-earlier", { kind: "user" }, ["agent-0"]);
  seed.deliveries.at(-1).turnId = "provider-current";
  seed.deliveries.at(-1).resumeAfterUsageLimit = { turnId: "resume-original", workSteps: "Fixture", previousTurnIds: ["provider-collision", "routine-shared-turn"] };
  add("provider-direct", { kind: "user" }, ["agent-0"]);
  seed.deliveries.at(-1).id = "provider-collision";
  add("provider-unmarked", { kind: "user" }, ["agent-0"]);
  seed.deliveries.at(-1).turnId = "unmarked-turn";
  add("provider-plan", { kind: "user" }, ["agent-0"]);
  seed.deliveries.at(-1).planContinuation = { turnIds: ["plan-only-turn"] };
  add("fallback-first", { kind: "user" }, ["agent-0"]);
  seed.deliveries.at(-1).id = "00000000-0000-4000-8000-000000000002";
  add("fallback-later", { kind: "user" }, ["agent-0"]);
  seed.deliveries.at(-1).id = "00000000-0000-4000-8000-000000000001";
  const routineSender = { kind: "routine", routineId: "fixture-routine", runId: "fixture-run", routineName: "Fixture", scheduledFor: "2026-01-01T00:00:00.000Z" };
  add("routine-earlier", routineSender, ["agent-0"]);
  seed.deliveries.at(-1).turnId = "routine-shared-turn";
  seed.deliveries.at(-1).resumeAfterUsageLimit = { turnId: "routine-original", workSteps: "Fixture", previousTurnIds: ["routine-old-turn"] };
  add("routine-later", routineSender, ["agent-0"]);
  seed.deliveries.at(-1).turnId = "routine-shared-turn";
  add("routine-plan", routineSender, ["agent-0"]);
  seed.deliveries.at(-1).planContinuation = { turnIds: ["routine-plan-only"] };
  add("routine-changing", routineSender, ["agent-0"], {}, "queued");
  const routineRequests = ["routine-shared-turn", "routine-old-turn", "routine-plan-only", "routine-changing-current", "routine-changing-prior", "routine-changing-next"];
  for (const turn of routineRequests) {
    const id = "request-" + turn;
    add(id, { kind: "agent", agentId: "agent-0" }, ["agent-1"]);
    seed.idempotency["fixture:" + turn + ":request"] = id;
  }
  add("request-wrong-sender", { kind: "agent", agentId: "agent-1" }, ["agent-0"]);
  seed.idempotency["fixture:routine-shared-turn:wrong-sender"] = "request-wrong-sender";
  add("channel-z-queued", { kind: "user" }, ["agent-0"], { channelId: "z" }, "queued");
  add("channel-a-running", { kind: "user" }, ["agent-0"], { channelId: "a" }, "running");
  add("channel-z-running", { kind: "user" }, ["agent-0"], { channelId: "z" }, "running");
  add("channel-b-completed", { kind: "user" }, ["agent-0"], { channelId: "b" });
  const providerIds = ["provider-collision", "provider-current", "unmarked-turn", "plan-only-turn", "routine-plan-only",
    "00000000-0000-4000-8000-000000000000", "work-5:agent-0", "fixture-turn", "resume-one", "resume-two", "new-current", "plan-new", "plan-follow-up", "plan-follow-up-next", "rollback-only", "missing-provider-id"];
  report.fixture = { messages: seed.messages.length, deliveries: seed.deliveries.length, agents: 40, tasks: 50 };
  async function open(Mailbox, name) {
    const profile = mkdtempSync(join(output, name + "-"));
    const database = new OpenBotDatabase(profile);
    opened.push(database);
    await runCauseEffect(database.initialize());
    database.replaceMailboxState("fixture-seed", structuredClone(seed), "mailbox.fixture");
    const mailbox = new Mailbox(profile, join(profile, "Shared"), database);
    await runCauseEffect(mailbox.initialize());
    mailbox.useMessagingLane(() => separateMessaging);
    return { database, mailbox, aliases: new Map() };
  }
  const current = await open(CurrentMailbox, "indexed");
  const baseline = await open(BaselineMailbox, "baseline");
  const pair = [current, baseline];
  function canonical(value, aliases) {
    if (typeof value === "string") return aliases.get(value) ?? value;
    if (Array.isArray(value)) return value.map((item) => canonical(item, aliases));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, canonical(item, aliases)]));
    return value;
  }
  function inspect(item) {
    const m = item.mailbox;
    const result = {};
    for (const agent of ["agent-0", "agent-1", "agent-2", "reply-owner", "external-agent", "steer-agent", "answer-agent", "missing-agent"]) {
      result[agent] = {
        queue: m.listQueue(agent), queued: m.queuedDeliveryIds(agent), positions: [...m.queuedPositions()],
        conversation: m.conversationMessages(agent), narrow: m.conversationMessages(agent, { limit: 3 }),
        recent: m.conversationMessages(agent, { fromCreatedAt: "2026-01-01T03:00:00.000Z", limit: 7 }),
        future: m.conversationMessages(agent, { fromCreatedAt: "2027-01-01T00:00:00.000Z" }),
        senders: m.senderAgentIdsForRecipient(agent), next: m.nextQueued(agent), mainActive: m.laneActive(agent, null),
        channels: m.channelLanes(agent, true), activeChannels: m.channelLanes(agent),
        sideLanes: m.sideLanes(agent), queuedSideLanes: m.sideLanes(agent, true),
        messagingActive: m.laneActive(agent, messagingLane), messagingNext: m.nextQueued(agent, messagingLane),
        messagingQueued: m.laneQueuedIds(agent, messagingLane),
        unfinished: m.hasUnfinishedDelivery(agent), started: m.hasStartedDelivery(agent),
        outsideTasks: m.hasUnfinishedDeliveryOutsideTasks(agent, false),
        outsideTasksWithChannels: m.hasUnfinishedDeliveryOutsideTasks(agent, true),
        providerMatches: providerIds.map((id) => m.deliveryForProviderMessage(agent, id)),
        routineMatches: [...routineRequests.map((turn) => "request-" + turn), "request-wrong-sender", "missing-request"].map((id) => m.routineDeliveryOfRequest(agent, id)),
      };
    }
    result.tasks = Array.from({ length: 50 }, (_, i) => {
      const task = "task-" + i;
      return { task, next: m.nextQueued("agent-0", task), active: m.laneActive("agent-0", task), busy: m.taskBusy("agent-0", task),
        queued: m.queuedTaskMessages("agent-0", task), queue: m.taskQueue("agent-0", task), ids: m.laneQueuedIds("agent-0", task) };
    });
    result.joinsChatTurn = ["initial-request:steer-agent", "question-back:steer-agent", "single-answer:steer-sender", "multi-answer:reply-owner", "task-answer:agent-0", "external-queued:external-agent", "channel-z-queued:agent-0"].map((id) => m.joinsChatTurn(id));
    result.moved = m.taskQueue("agent-0", "moved-task");
    result.answer = m.taskQueue("agent-0", "answer-task");
    return canonical(result, item.aliases);
  }
  function compare(label) {
    assert.deepEqual(inspect(current), inspect(baseline), label);
    report.checks.push(label);
  }
  async function mutate(label, operation) {
    for (const item of pair) await operation(item.mailbox, item.database);
    compare(label);
  }
  compare("Released baseline agrees for bounded/recent conversation visibility, old active messages, multi-recipient replies, positions, lanes and 50 task queues.");
  assert.equal(current.mailbox.deliveryForProviderMessage("agent-0", "provider-collision").delivery.id, "provider-earlier:agent-0", "Earlier continuation matches precede a later exact delivery ID.");
  assert.equal(current.mailbox.deliveryForProviderMessage("agent-0", "unmarked-turn"), null, "A current turn without a continuation marker is not a provider message match.");
  assert.equal(current.mailbox.deliveryForProviderMessage("agent-0", "00000000-0000-4000-8000-000000000000").delivery.id, "00000000-0000-4000-8000-000000000001", "Fallback origin order takes priority over storage order.");
  assert.equal(current.mailbox.routineDeliveryOfRequest("agent-0", "request-routine-shared-turn").delivery.id, "routine-earlier:agent-0");
  assert.equal(current.mailbox.routineDeliveryOfRequest("agent-0", "request-routine-old-turn").delivery.id, "routine-earlier:agent-0");
  assert.equal(current.mailbox.routineDeliveryOfRequest("agent-0", "request-routine-plan-only"), null, "Routine ancestry does not follow plan-only turns.");
  report.checks.push("Exact provider IDs, current/resumed/plan turns, continuation collisions, XOR run fallback order and routine-only ancestry equal the released baseline.");
  assert.deepEqual(inspect(current).joinsChatTurn, [true, false, true, false, false, false, false]);
  assert.equal(current.mailbox.laneActive("external-agent", messagingLane), true);
  assert.equal(current.mailbox.laneActive("external-agent", null), false);
  separateMessaging = false;
  compare("Changing provider/ownership policy without mailbox mutations moves messaging work to the main lane.");
  assert.equal(current.mailbox.laneActive("external-agent", messagingLane), false);
  assert.equal(current.mailbox.laneActive("external-agent", null), true);
  separateMessaging = true;
  compare("Restoring messaging lane policy without a write updates active, queued and side lane reads.");
  for (const item of pair) item.mailbox.useMessagingLane(() => false);
  compare("Replacing the messaging policy callback after warmup updates existing work.");
  assert.equal(current.mailbox.laneActive("external-agent", null), true);
  for (const item of pair) item.mailbox.useMessagingLane(() => separateMessaging);
  await mutate("A teammate request with an explicit answer stays completed after its provider turn fails.", (m) => runCauseEffect(m.markTerminal("answered-request:answer-agent", "failed", "Fixture failure")));
  assert.equal(current.mailbox.getDelivery("answered-request:answer-agent").delivery.status, "completed");
  await mutate("Current main can requeue completed background work with a resume marker.", (m) => runCauseEffect(m.requeueRefused("provider-earlier:agent-0", { turnId: "provider-current", workSteps: "Fixture", previousTurnIds: ["provider-collision"] }, true)));
  assert.equal(current.mailbox.getDelivery("provider-earlier:agent-0").delivery.status, "queued");
  assert.equal(current.mailbox.conversationMessages("agent-0").find((message) => message.id === "provider-earlier:agent-0").turnId, "provider-collision");
  assert.ok(current.mailbox.conversationMessages("agent-0", { limit: 1, fromCreatedAt: "2027-01-01T00:00:00.000Z" }).some((m) => m.id === "old-active:agent-0"));
  await mutate("Queued to starting updates the active lane before another read.", (m) => runCauseEffect(m.markStarting("work-0:agent-0")));
  await mutate("Running membership remains current.", (m) => runCauseEffect(m.markRunning("work-0:agent-0", "fixture-turn")));
  await mutate("Queued plan continuations keep their released public running state and no queue position.", (m) => runCauseEffect(m.requeueForPlan("work-0:agent-0", "fixture-turn")));
  await mutate("Plan settlement releases task capacity.", (m) => runCauseEffect(m.settlePlanContinuations("agent-0", "task-0")));
  await mutate("Provider matching remains absent for an unmarked current turn.", async (m) => {
    await runCauseEffect(m.markStarting("work-5:agent-0"));
    await runCauseEffect(m.markRunning("work-5:agent-0", "new-current"));
  });
  await mutate("Adding a usage-limit continuation indexes previous provider turns.", (m) => runCauseEffect(m.requeueRefused("work-5:agent-0", { turnId: "resume-original", workSteps: "Fixture", previousTurnIds: ["resume-one", "resume-two"] })));
  await mutate("Starting a resumed turn updates current and historical provider IDs.", async (m) => {
    await runCauseEffect(m.markStarting("work-5:agent-0"));
    await runCauseEffect(m.markRunning("work-5:agent-0", "new-current"));
  });
  await mutate("Adding and extending plan IDs refreshes provider lookup membership.", async (m) => {
    await runCauseEffect(m.requeueForPlan("work-5:agent-0", "plan-new"));
    await runCauseEffect(m.markStarting("work-5:agent-0"));
    await runCauseEffect(m.markRunning("work-5:agent-0", "plan-follow-up"));
  });
  await mutate("Changing only continuation turn lists while already running refreshes both lookups.", (m) => runCauseEffect(m.markRunning("work-5:agent-0", "plan-follow-up-next")));
  await mutate("Routine current-turn lookup tracks a newly started routine.", async (m) => {
    await runCauseEffect(m.markStarting("routine-changing:agent-0"));
    await runCauseEffect(m.markRunning("routine-changing:agent-0", "routine-changing-current"));
  });
  await mutate("Routine ancestry refreshes on resume, preserving previous turns and terminal state.", async (m) => {
    await runCauseEffect(m.requeueRefused("routine-changing:agent-0", { turnId: "routine-changing-current", workSteps: "Fixture", previousTurnIds: ["routine-changing-current", "routine-changing-prior"] }));
    await runCauseEffect(m.markStarting("routine-changing:agent-0"));
    await runCauseEffect(m.markRunning("routine-changing:agent-0", "routine-changing-next"));
    await runCauseEffect(m.markTerminal("routine-changing:agent-0", "failed", "Fixture failure"));
  });
  await mutate("Channel active ordering survives transitions and deduplicates the remaining lane.", async (m) => {
    await runCauseEffect(m.markStarting("channel-z-queued:agent-0"));
    await runCauseEffect(m.markRunning("channel-z-queued:agent-0", "channel-finished"));
    await runCauseEffect(m.markTerminal("channel-z-queued:agent-0", "completed"));
  });
  assert.deepEqual(current.mailbox.channelLanes("agent-0"), ["\u0001channel:a", "\u0001channel:z"]);
  await mutate("Steer restoration updates the time-range view without retaining a stale steered timestamp.", (m) => runCauseEffect(m.restoreUnsteered("steered:agent-2", "old-live-turn")));
  await mutate("Moving a queued user message replaces arrays and reindexes its task lane.", (m) => runCauseEffect(m.moveToTask("agent-0", "movable:agent-0", "moved-task")));
  await mutate("Returning task answers reindexes their main-chat visibility.", (m) => runCauseEffect(m.returnTaskAnswers("agent-0", "answer-task")));
  await mutate("Queue edits change start eligibility without stale cached delivery objects.", (m) => m.beginQueueEdit("agent-0", "work-1:agent-0", "fixture-edit"));
  assert.equal(current.mailbox.nextQueued("agent-0", "task-1"), null);
  const originalNow = Date.now;
  try {
    Date.now = () => originalNow() + 10 * 60_000 + 1;
    compare("An edit hold expires without a mailbox write or cached eligibility change.");
    assert.equal(current.mailbox.nextQueued("agent-0", "task-1")?.delivery.id, "work-1:agent-0");
    await mutate("Starting an expired edit clears its lock and retains its original request.", (m) => runCauseEffect(m.markStarting("work-1:agent-0")));
  } finally { Date.now = originalNow; }
  await mutate("A new explicit edit can finish without changing queue membership.", (m) => {
    m.beginQueueEdit("agent-0", "work-6:agent-0", "fixture-finish");
    m.finishQueueEdit("agent-0", "work-6:agent-0", "fixture-finish");
  });
  await mutate("Queue reordering invalidates only the recipient's sorted queue.", (m) => runCauseEffect(m.reorderQueue("agent-0", m.queuedDeliveryIds("agent-0").reverse())));
  await mutate("Cancellation removes queued and active memberships.", (m) => runCauseEffect(m.cancel("agent-0", "work-2:agent-0")));
  await mutate("Removing finished task messages rebuilds indexes with no stale IDs.", (m) => runCauseEffect(m.deleteTaskMessages("agent-0", "task-0")));
  for (const item of pair) {
    item.database.connection.exec("BEGIN IMMEDIATE");
    await runCauseEffect(item.mailbox.markStarting("work-3:agent-0"));
    await runCauseEffect(item.mailbox.requeueRefused("work-5:agent-0", { turnId: "plan-follow-up-next", workSteps: "Fixture", previousTurnIds: ["rollback-only"] }));
  }
  compare("Optimistic state inside an outer transaction is visible to subsequent reads.");
  for (const item of pair) {
    item.database.connection.exec("ROLLBACK");
    item.mailbox.restorePersistedState();
  }
  compare("Rollback and restore rebuild from the durable state without stale lane or position keys.");
  for (const item of pair) {
    const write = item.database.applyMailboxChanges;
    item.database.applyMailboxChanges = () => {
      item.mailbox.taskBusy("agent-0", "task-4");
      item.mailbox.nextQueued("agent-0", "task-4");
      throw new Error("Isolated persistence failure");
    };
    try { await assert.rejects(runCauseEffect(item.mailbox.cancel("agent-0", "work-4:agent-0")), /Isolated persistence failure/); }
    finally { item.database.applyMailboxChanges = write; }
  }
  compare("A failed optimistic cancellation restores same-object status changes even after an indexed read during the failed write.");
  for (const item of pair) {
    const receipt = await runCauseEffect(item.mailbox.enqueue({ sender: { kind: "user" }, recipientAgentIds: ["agent-0"], taskId: "appended-task", text: "Append after index warmup", idempotencyKey: "fixture-append" }));
    item.aliases.set(receipt.messageId, "appended-message");
    const delivery = receipt.deliveries[0];
    assert.ok(delivery);
    item.aliases.set(delivery.id, "appended-delivery");
    item.aliases.set(item.mailbox.getDelivery(delivery.id).delivery.createdAt, "appended-time");
    assert.equal(item.mailbox.nextQueued("agent-0", "appended-task")?.delivery.id, delivery.id);
    assert.equal(item.mailbox.deliveryForProviderMessage("agent-0", delivery.id)?.delivery.id, delivery.id);
    assert.equal(item.mailbox.receiptForKey("fixture-append").messageId, receipt.messageId);
  }
  compare("Real enqueue appends update message/delivery indexes and preserve idempotent receipts.");
  for (const item of pair) {
    item.mailbox = new (item === current ? CurrentMailbox : BaselineMailbox)(item.database.userDataPath, join(item.database.userDataPath, "Shared"), item.database);
    await runCauseEffect(item.mailbox.initialize());
  }
  compare("A new mailbox instance reloads the same persisted queue, visibility and task state.");
  function workload(m) {
    let observed = 0;
    for (let i = 0; i < 50; i++) {
      const task = "task-" + i;
      observed += Number(Boolean(m.nextQueued("agent-0", task)));
      observed += Number(m.laneActive("agent-0", task));
      observed += m.queuedTaskMessages("agent-0", task).length;
      observed += m.taskQueue("agent-0", task).length;
    }
    observed += m.conversationMessages("agent-0", { fromCreatedAt: "2026-01-01T03:00:00.000Z" }).length;
    for (const id of providerIds) observed += Number(Boolean(m.deliveryForProviderMessage("agent-0", id)));
    for (const turn of routineRequests) observed += Number(Boolean(m.routineDeliveryOfRequest("agent-0", "request-" + turn)));
    observed += m.channelLanes("agent-0").length + m.channelLanes("agent-0", true).length;
    return observed;
  }
  assert.equal(workload(current.mailbox), workload(baseline.mailbox));
  for (const [name, item] of [["baseline", baseline], ["indexed", current]]) {
    const started = performance.now();
    let observed = 0;
    for (let iteration = 0; iteration < 30; iteration++) observed += workload(item.mailbox);
    report.timings[name] = { milliseconds: performance.now() - started, iterations: 30, observed };
  }
  assert.equal(report.timings.baseline.observed, report.timings.indexed.observed);
  report.checks.push("The identical real-store scheduler/task/conversation workload records repeatable observation counts and timing evidence without a speed pass threshold.");
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.stack ?? error.message : String(error);
  process.exitCode = 1;
} finally {
  for (const database of opened) database.close();
  writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify(report) + "\n");
}
`;
for (const [name, path] of Object.entries(modulePaths))
  source = source.replaceAll(`IMPORT_${name.toUpperCase()}`, `import(${JSON.stringify(path.replaceAll("\\", "/"))})`);
const entryPath = join(output, "fixture.ts");
writeFileSync(entryPath, source);
const build = await Bun.build({
  entrypoints: [entryPath],
  target: "node",
  format: "esm",
  outdir: output,
  naming: "fixture.mjs",
});
assert.ok(build.success, String(build.logs));
const child = spawnSync("node", [join(output, "fixture.mjs")], {
  cwd: projectRoot,
  encoding: "utf8",
  windowsHide: true,
  timeout: 120_000,
});
process.stdout.write(child.stdout ?? "");
process.stderr.write(child.stderr ?? "");
assert.ifError(child.error);
assert.equal(child.status, 0, "Mailbox read index differential fixture failed.");
