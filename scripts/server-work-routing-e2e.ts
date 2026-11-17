// Checks host-only semantic route planning with real SQLite/task stores and an injected decider.
// It never starts a provider, account, network request or user profile.
// Run: bun scripts/server-work-routing-e2e.ts
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { isServerWorkThread } from "../src/backend/agent/server-work-identity";
import { type ServerWorkRouteDecisionInput, ServerWorkRouting } from "../src/backend/agent/server-work-routing";
import { ToolOperationFailed } from "../src/backend/agent/tool-operation";
import { AgentStore } from "../src/backend/agent-store";
import { AgentTasks } from "../src/backend/agent-tasks/agent-tasks";
import { AgentThreadStore } from "../src/backend/agent-threads/agent-thread-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const projectRoot = process.env.OPENBOT_ROUTING_TEST_ROOT ?? resolve(import.meta.dirname, "..");
const output = join(projectRoot, ".openbot-build", "server-work-routing-e2e");
const report: { passed: boolean; checks: string[]; error?: string } = { passed: false, checks: [] };

async function fixture(): Promise<void> {
  const root = mkdtempSync(join(output, "run-"));
  const profile = join(root, "profile");
  const database = new OpenBotDatabase(profile);
  const store = new AgentStore(profile, join(root, "home"), database);
  const mailbox = new MailboxStore(profile, store.sharedRoot, database);
  const conversation = new ConversationRuntime(
    store,
    () => {},
    () => store.list(),
  );
  const tasks = new AgentTasks({
    store: new AgentThreadStore(database),
    mailbox,
    conversation,
    hooks: {
      agent: (id) => store.list().find((agent) => agent.id === id),
      emit: () => {},
      defaultTaskLimit: () => 4,
      serverWorkPolicy: () => ({ maxConcurrentTasks: 50, maxUnfinishedTasks: 50, dispatchMode: "new-thread" }),
      hold: () => null,
      queued: () => {},
      turnActive: () => false,
      archived: () => Effect.void,
    },
  });
  let response: unknown = { kind: "new", title: "Planned fixture work" };
  let duringDecision: (() => void) | null = null;
  let failure: Error | null = null;
  let scopeChanged = false;
  let privateSender = "";
  const seen: ServerWorkRouteDecisionInput[] = [];
  const planner = new ServerWorkRouting({
    tasks,
    mainTitle: () => "Private fixture main subject",
    sharingScope: (sender) =>
      sender === privateSender ? `agent:${sender}` : scopeChanged ? "section:changed" : "section:shared",
    decide: (input) => {
      seen.push(structuredClone(input));
      if (failure) return Effect.fail(new ToolOperationFailed({ cause: failure }));
      return Effect.promise(async () => {
        const run = duringDecision;
        duringDecision = null;
        run?.();
        await Promise.resolve();
        return response;
      });
    },
  });
  try {
    await runCauseEffect(store.initialize());
    await runCauseEffect(mailbox.initialize());
    const create = (name: string) =>
      runCauseEffect(
        store.createAgent({
          name,
          description: "Fixture",
          avatarSeed: name.toLowerCase().replace(/[^a-z0-9]/gu, ""),
          avatarHue: null,
        }),
      );
    const owner = await create("Worker");
    const sender = await create("Sender");
    const outsider = await create("Private sender");
    const otherOwner = await create("Another worker");
    privateSender = outsider.id;
    const input = {
      agentId: owner.id,
      senderAgentId: sender.id,
      text: "Route this incoming fixture request.",
      requestId: "request-one",
    };
    const first = await runCauseEffect(planner.plan(input));
    const repeated = await runCauseEffect(planner.plan(input));
    assert.equal(
      seen.at(-1)?.mainTitle,
      undefined,
      "Teammate classification never receives the recipient's private main subject.",
    );
    assert.equal(first.kind, "new");
    assert.ok(first.taskId && isServerWorkThread(first.taskId));
    assert.equal(first.taskId, repeated.taskId);
    assert.equal(planner.isPlanCurrent(input, first), true);
    scopeChanged = true;
    assert.equal(
      planner.isPlanCurrent(input, first),
      false,
      "A new plan cannot enter a scope that has changed while it waits.",
    );
    scopeChanged = false;
    assert.equal(tasks.openTaskIds(owner.id).length, 0, "A plan never creates or queues work.");
    const different = await runCauseEffect(planner.plan({ ...input, requestId: "request-two" }));
    assert.notEqual(first.taskId, different.taskId);
    const otherScope = await runCauseEffect(planner.plan({ ...input, senderAgentId: outsider.id }));
    assert.notEqual(first.taskId, otherScope.taskId);
    report.checks.push(
      "New-work plans have stable scoped request IDs without creating a task, message or provider turn.",
    );

    const createManaged = async (senderAgentId: string, requestId: string, title: string, agentId = owner.id) => {
      response = { kind: "new", title };
      const plan = await runCauseEffect(planner.plan({ ...input, agentId, senderAgentId, requestId }));
      assert.ok(plan.taskId);
      return runCauseEffect(tasks.withWorkAdmission(agentId, tasks.createWork(agentId, title, plan.taskId)));
    };
    const related = await createManaged(sender.id, "related", "Related fixture issue");
    const privateWork = await createManaged(outsider.id, "private", "Private fixture issue");
    const archived = await createManaged(sender.id, "archived", "Archived fixture issue");
    tasks.close(archived);
    const foreign = await createManaged(sender.id, "foreign", "Another owner's work", otherOwner.id);
    const ordinary = tasks.create(owner.id, "Ordinary client thread", "user");
    await runCauseEffect(
      mailbox.enqueue({
        sender: { kind: "user" },
        recipientAgentIds: [owner.id],
        taskId: related.taskId,
        text: "private-transcript-marker: the decider must never see this transcript.",
      }),
    );

    response = { kind: "existing", taskId: related.taskId };
    const selected = await runCauseEffect(planner.plan(input));
    assert.equal(selected.taskId, related.taskId);
    assert.equal(selected.generation, related.createdAt);
    assert.equal(planner.isPlanCurrent(input, selected), true);
    const permitted = seen.at(-1)?.candidates ?? [];
    assert.deepEqual(
      permitted.map((candidate) => candidate.taskId),
      [related.taskId],
    );
    assert.equal(JSON.stringify(permitted).includes("private-transcript-marker"), false);
    assert.equal(planner.isAllowed(input, related.taskId), true);
    assert.equal(planner.isAllowed(input, privateWork.taskId), false);
    report.checks.push(
      "A teammate can select only supplied open managed work in its scope; candidates contain metadata, not transcripts.",
    );

    response = { kind: "existing", taskId: privateWork.taskId };
    const own = await runCauseEffect(planner.plan({ ...input, senderAgentId: owner.id }));
    assert.equal(
      seen.at(-1)?.mainTitle,
      "Private fixture main subject",
      "The owner's own route can use its bounded main subject.",
    );
    assert.equal(own.taskId, privateWork.taskId);
    assert.ok(seen.at(-1)?.candidates.some((candidate) => candidate.taskId === privateWork.taskId));
    response = { kind: "existing", taskId: ordinary.taskId };
    assert.equal((await runCauseEffect(planner.plan({ ...input, senderAgentId: owner.id }))).taskId, ordinary.taskId);
    response = { kind: "main" };
    assert.deepEqual(await runCauseEffect(planner.plan(input)), { kind: "main" });
    report.checks.push(
      "The owner can select its own managed work across scopes or an existing ordinary client thread; main remains explicit.",
    );

    const invalid: unknown[] = [
      null,
      [],
      '{"kind":"main"}',
      { kind: "run-command", command: "ignored" },
      { kind: "new", title: "" },
      { kind: "new", title: "Work", command: "ignored" },
      { kind: "main", taskId: related.taskId },
      { kind: "existing" },
      { kind: "existing", taskId: related.taskId, generation: "model-supplied-generation" },
      ...[privateWork.taskId, archived.taskId, foreign.taskId, ordinary.taskId, "missing-task"].map((taskId) => ({
        kind: "existing",
        taskId,
      })),
    ];
    const before = tasks.openTaskIds(owner.id).length;
    for (const value of invalid) {
      response = value;
      await assert.rejects(runCauseEffect(planner.plan(input)));
    }
    assert.equal(tasks.openTaskIds(owner.id).length, before);
    report.checks.push(
      "Malformed decisions, extra fields, private, archived, ordinary, missing and wrong-owner task IDs are refused without mutation.",
    );

    response = { kind: "existing", taskId: related.taskId };
    duringDecision = () => tasks.close(tasks.require(owner.id, related.taskId));
    await assert.rejects(runCauseEffect(planner.plan(input)));
    assert.equal(planner.isAllowed(input, related.taskId), false);
    tasks.reopen(tasks.require(owner.id, related.taskId));
    duringDecision = () => {
      scopeChanged = true;
    };
    await assert.rejects(runCauseEffect(planner.plan(input)));
    scopeChanged = false;
    await runCauseEffect(planner.plan(input));
    tasks.close(tasks.require(owner.id, related.taskId));
    assert.throws(() => planner.assertAllowed(input, related.taskId));
    assert.equal(planner.isPlanCurrent(input, selected), false);
    tasks.reopen(tasks.require(owner.id, related.taskId));
    report.checks.push(
      "A task archive or scope change during the decider wait is refused; the commit helper rechecks current access.",
    );

    const previousGeneration = await createManaged(sender.id, "generation", "Generation fixture");
    // Seed a historical creation date, so recreation is deterministic without an elapsed-time sleep.
    database.connection
      .prepare("UPDATE projection_agent_threads SET created_at=? WHERE thread_id=?")
      .run("2000-01-01T00:00:00.000Z", previousGeneration.threadId);
    response = { kind: "existing", taskId: previousGeneration.taskId };
    const admittedLater = await runCauseEffect(planner.plan(input));
    assert.equal(admittedLater.generation, "2000-01-01T00:00:00.000Z");
    tasks.discard(tasks.require(owner.id, previousGeneration.taskId));
    await runCauseEffect(
      tasks.withWorkAdmission(
        owner.id,
        tasks.createWork(owner.id, "Recreated generation fixture", previousGeneration.threadId),
      ),
    );
    assert.equal(planner.isAllowed(input, previousGeneration.taskId), true);
    assert.equal(
      planner.isPlanCurrent(input, admittedLater),
      false,
      "A permitted recreated task does not inherit an earlier generation's pending route.",
    );
    assert.equal(planner.isPlanCurrent(input, { kind: "main" }), true);
    report.checks.push(
      "Plans waiting for admission recheck scope, archive and task generation without a time-based sleep.",
    );

    const gone = await createManaged(sender.id, "gone", "Deleted during routing");
    response = { kind: "existing", taskId: gone.taskId };
    duringDecision = () => tasks.discard(tasks.require(owner.id, gone.taskId));
    await assert.rejects(runCauseEffect(planner.plan(input)));
    failure = new Error("Injected route decider failure.");
    await assert.rejects(runCauseEffect(planner.plan(input)), (error: unknown) => error === failure);
    assert.equal(
      mailbox.listQueue(owner.id).deliveries.length,
      0,
      "The planner never silently queues or drops incoming work.",
    );
    report.checks.push(
      "Deletion and decider failures propagate to the caller's failure policy without sending or replaying work.",
    );
    report.passed = true;
  } finally {
    conversation.dispose();
    database.close();
  }
}

mkdirSync(output, { recursive: true });
if (process.argv.includes("--fixture")) {
  try {
    await fixture();
  } catch (error) {
    report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.exitCode = 1;
  } finally {
    writeFileSync(join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(report)}\n`);
  }
} else {
  const build = await Bun.build({
    entrypoints: [import.meta.filename],
    target: "node",
    format: "esm",
    outdir: output,
    naming: "fixture.mjs",
  });
  assert.ok(build.success, String(build.logs));
  const child = spawnSync("node", [join(output, "fixture.mjs"), "--fixture"], {
    cwd: projectRoot,
    env: { ...process.env, OPENBOT_ROUTING_TEST_ROOT: projectRoot },
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
  });
  process.stdout.write(child.stdout);
  process.stderr.write(child.stderr);
  assert.ifError(child.error);
  assert.equal(child.status, 0, "Server work route planning check failed.");
}
