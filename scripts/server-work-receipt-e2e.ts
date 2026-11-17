// Real isolated SQLite, mailbox files, read pages and released stock deletion. No provider or Electron.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isConversationMessage } from "@openbot/contracts/ipc";
import { Effect, Exit, Result, Scope } from "effect";
import { ConversationReader } from "../src/backend/agent/conversation-reader";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { readHandoffHistory, renderProviderHandoff, renderRoutineHandoff } from "../src/backend/agent/handoff-history";
import { MailboxSync } from "../src/backend/agent/mailbox-sync";
import { MessageDeletion } from "../src/backend/agent/message-deletion";
import {
  isServerWorkReceipt,
  SERVER_WORK_RECEIPT_ITEM_TYPE,
  serverWorkReceiptText,
} from "../src/backend/agent/server-work-receipt";
import { AgentStore } from "../src/backend/agent-store";
import { AgentTasks } from "../src/backend/agent-tasks/agent-tasks";
import { AgentThreadStore } from "../src/backend/agent-threads/agent-thread-store";
import { promptMessage } from "../src/backend/conversation-snapshots";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { MessageDeleteRefused } from "../src/backend/message-delete";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const projectRoot = process.env.OPENBOT_RECEIPT_TEST_ROOT ?? resolve(import.meta.dirname, "..");
const output = join(projectRoot, ".openbot-build/server-work-receipt-e2e");
const report: { passed: boolean; checks: string[]; error?: string } = { passed: false, checks: [] };

async function openFixture(root: string) {
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
      hold: () => null,
      queued: () => {},
      turnActive: () => false,
      archived: () => Effect.void,
    },
  });
  const scope = Scope.makeUnsafe();
  const sync = new MailboxSync({
    database,
    mailbox,
    conversation,
    routines: { reconcileDelivery: () => false, stateChanged: () => {} },
    scope: () => scope,
    hooks: { emit: () => {}, emitError: () => {}, queueHold: () => null },
  });
  const reader = new ConversationReader({
    store,
    conversation,
    mailboxSync: sync,
    hooks: { emit: () => {}, listAgents: () => store.list() },
  });
  const deletion = new MessageDeletion({ store, mailbox, conversation, tasks });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    conversation.dispose();
    await Effect.runPromise(Scope.close(scope, Exit.void));
    database.close();
  };
  try {
    await runCauseEffect(store.initialize());
    await runCauseEffect(mailbox.initialize());
    return { database, store, mailbox, conversation, tasks, sync, reader, deletion, close };
  } catch (error) {
    await close();
    throw error;
  }
}

function runChild(name: string, args: string[]): void {
  const child = spawnSync("node", [join(output, name), ...args], {
    cwd: projectRoot,
    env: { ...process.env, OPENBOT_RECEIPT_TEST_ROOT: projectRoot },
    encoding: "utf8",
    windowsHide: true,
    timeout: 45_000,
  });
  process.stdout.write(child.stdout);
  process.stderr.write(child.stderr);
  assert.ifError(child.error);
  assert.equal(child.status, 0, `The ${name} process failed.`);
}

async function stockFixture(root: string, deliveryId: string): Promise<void> {
  // This fresh process bundles the frozen 0.72 MessageDeletion, without the routing receipt guard.
  const fixture = await openFixture(root);
  try {
    const { database, store, mailbox, deletion } = fixture;
    const owner = store.list()[0];
    assert.ok(owner?.threadId);
    const context = mailbox.getDelivery(deliveryId);
    assert.ok(context);
    assert.ok(mailbox.taskIdForDelivery(deliveryId));
    assert.equal(database.readConversationMessages(owner.id, owner.threadId, [deliveryId]).length, 0);
    const result = await Effect.runPromise(
      Effect.result(deletion.delete({ agentId: owner.id, messageId: deliveryId }, { memberId: null, deleteAny: true })),
    );
    assert.ok(Result.isFailure(result) && result.failure instanceof MessageDeleteRefused);
    assert.equal(result.failure.reason, "not-found");
    // Released deleteAgentHistory selects actual main SQL IDs before deleting mailbox records.
    const ids = database.threadMessageIds(owner.threadId);
    assert.equal(ids.includes(deliveryId), false);
    assert.equal(await runCauseEffect(mailbox.deleteShownMessages(owner.id, ids)), "deleted");
    database.deleteThreadHistory({ agentId: owner.id, threadId: owner.threadId });
    assert.ok(mailbox.getDelivery(deliveryId));
    const attachment = context.delivery.attachments[0];
    assert.ok(attachment);
    assert.ok(await runCauseEffect(mailbox.resolveAttachment(attachment.id)));
  } finally {
    await fixture.close();
  }
}

async function fixture(): Promise<void> {
  const root = mkdtempSync(join(output, "run-"));
  let current = await openFixture(root);
  let ownerId = "";
  let mainThreadId = "";
  let sideThreadId = "";
  let preservedId = "";
  let preservedAttachmentId = "";
  try {
    const { database, store, mailbox, conversation, tasks, reader, sync } = current;
    const owner = await runCauseEffect(
      store.createAgent({
        name: "Receipt worker",
        description: "Isolated receipt fixture",
        avatarSeed: "receiptworker",
        avatarHue: null,
      }),
    );
    ownerId = owner.id;
    mainThreadId = store.ensureThreadIdNow(owner.id);
    const task = tasks.create(owner.id, "A real side request", "user");
    sideThreadId = task.threadId;
    const source = join(root, "preserved-attachment.txt");
    const fileText = "The main acknowledgement must not delete this side attachment.";
    writeFileSync(source, fileText);
    const main = conversation.ensureSnapshot(owner.id, mainThreadId);
    // One turn exceeds the wire cap. Slot reservation must also cap complete-turn grouping.
    for (let index = 0; index < 130; index++)
      main.messages.push({
        id: `ordinary-main-${index}`,
        author: "user",
        text: `Ordinary main history ${index}.`,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
        turnId: "large-main-turn",
        status: "completed",
      });
    conversation.emitConversation(main);
    const seed = async (name: string) => {
      const receipt = await runCauseEffect(
        mailbox.enqueue({
          sender: { kind: "user" },
          recipientAgentIds: [owner.id],
          taskId: task.taskId,
          text: `The sole actual side instruction: ${name}.`,
          sourcePaths: [source],
          mainReceipt: () => ({
            threadId: mainThreadId,
            activeTurnId: null,
            text: serverWorkReceiptText(name),
            publish: () => {
              sync.syncMailboxMessages(main);
            },
          }),
        }),
      );
      const deliveryId = receipt.deliveries[0]?.id;
      assert.ok(deliveryId);
      const context = mailbox.getDelivery(deliveryId);
      assert.ok(context);
      const side = tasks.read(owner.id, task.taskId);
      side.messages.push(
        promptMessage(context, {
          id: deliveryId,
          turnId: `fixture-${name}`,
          text: context.delivery.text,
          createdAt: context.delivery.createdAt,
        }),
      );
      conversation.emitConversation(side);
      const acknowledgement = mailbox.workReceipt(owner.id, mainThreadId, deliveryId);
      assert.ok(acknowledgement);
      return { acknowledgement, context, deliveryId };
    };
    const queued = await seed("queued");
    await seed("second");
    const preserved = await seed("preserved");
    preservedId = preserved.deliveryId;
    preservedAttachmentId = preserved.context.delivery.attachments[0]?.id ?? "";
    assert.ok(preservedAttachmentId);
    tasks.discard(task);
    assert.equal(tasks.require(owner.id, task.taskId).threadId, sideThreadId);
    assert.equal(mailbox.getDelivery(preservedId)?.delivery.status, "queued");
    assert.equal(database.readConversationMessages(owner.id, sideThreadId, [preservedId]).length, 1);
    const protectedFile = await runCauseEffect(mailbox.resolveAttachment(preservedAttachmentId));
    assert.ok(protectedFile);
    assert.equal(readFileSync(protectedFile.path, "utf8"), fileText);
    report.checks.push(
      "Discard refuses a populated task and preserves its record, queued request, durable message and file.",
    );
    assert.ok(isServerWorkReceipt(queued.acknowledgement));
    assert.ok(isConversationMessage(queued.acknowledgement));
    assert.equal(isServerWorkReceipt({ ...queued.acknowledgement, author: "user" }), false);
    assert.equal(isServerWorkReceipt({ ...queued.acknowledgement, turnId: "provider-turn" }), false);
    assert.equal(queued.acknowledgement.text.includes("sole actual side instruction"), false);
    assert.ok(serverWorkReceiptText("[Untrusted work](https://example.invalid)").includes("\\[Untrusted work\\]\\("));
    assert.equal(
      serverWorkReceiptText("password=synthetic-receipt-secret").includes("synthetic-receipt-secret"),
      false,
    );
    const full = await Effect.runPromise(reader.readFor(owner.id, "fixture-member"));
    assert.ok(full.messages.some((message) => message.id === queued.deliveryId && isServerWorkReceipt(message)));
    const beforeDeliverySync = structuredClone(full.messages.find((message) => message.id === queued.deliveryId));
    sync.syncDeliveryMessage(full, queued.deliveryId);
    assert.deepEqual(
      full.messages.find((message) => message.id === queued.deliveryId),
      beforeDeliverySync,
    );
    const page = await Effect.runPromise(reader.readPageFor(owner.id, "fixture-member", { type: "latest" }, 50));
    assert.equal(page.messages.length, 100);
    assert.equal(page.messages.filter(isServerWorkReceipt).length, 3);
    const realPage = database.readConversationPage(owner.id, mainThreadId, { type: "latest" }, 47, {}, 97);
    assert.deepEqual(
      page.messages.filter((message) => !isServerWorkReceipt(message)),
      realPage.messages,
    );
    assert.deepEqual(page.pageInfo, realPage.pageInfo);
    assert.ok(page.pageInfo.olderCursor);
    const before = await Effect.runPromise(
      reader.readPageFor(owner.id, "fixture-member", { type: "before", cursor: page.pageInfo.olderCursor }, 50),
    );
    assert.equal(before.messages.some(isServerWorkReceipt), false);
    const around = await Effect.runPromise(
      reader.readPageFor(owner.id, "fixture-member", { type: "around", messageId: queued.deliveryId }, 50),
    );
    assert.ok(around.messages.some((message) => message.id === queued.deliveryId));
    assert.ok(around.messages.length <= 100);
    const cursorBefore = await Effect.runPromise(reader.markRead(owner.id, "fixture-member", "ordinary-main-90"));
    const readNotice = await Effect.runPromise(reader.markRead(owner.id, "fixture-member", queued.deliveryId));
    assert.deepEqual(readNotice, cursorBefore);
    const unreadNotice = await Effect.runPromise(reader.markUnread(owner.id, "fixture-member", queued.deliveryId));
    assert.deepEqual(unreadNotice, cursorBefore);
    report.checks.push(
      "Full/latest reads derive receipts; the page cap and original SQL cursor are preserved; older and virtual-around reads work.",
    );

    database.persistConversation(full, "fixture.full");
    database.persistConversationChanges({
      agentId: owner.id,
      threadId: mainThreadId,
      activeTurnId: null,
      changedMessages: [queued.acknowledgement],
      eventType: "fixture.delta",
    });
    database.persistStreamingMessage({ snapshot: full, messageId: queued.deliveryId, eventType: "fixture.stream" });
    database.appendConversationMessage({
      agentId: owner.id,
      threadId: mainThreadId,
      activeTurnId: null,
      message: queued.acknowledgement,
      eventType: "fixture.append",
    });
    database.upsertProviderHistoryMessage({
      agentId: owner.id,
      threadId: mainThreadId,
      message: queued.acknowledgement,
      eventType: "fixture.import",
    });
    conversation.emitConversation(full);
    sync.reconcilePersistedMailboxMessages(store.list()[0] ?? owner);
    assert.equal(database.changedConversationMessages(mainThreadId, [queued.acknowledgement]).length, 0);
    assert.equal(database.readConversationMessages(owner.id, mainThreadId, [queued.deliveryId]).length, 0);
    assert.equal(database.readConversationMessages(owner.id, sideThreadId, [queued.deliveryId]).length, 1);
    assert.equal(
      database.connection
        .prepare(
          "SELECT count(*) AS n FROM orchestration_events WHERE aggregate_type='thread' AND aggregate_id=? AND instr(payload_json,?)>0",
        )
        .get(mainThreadId, SERVER_WORK_RECEIPT_ITEM_TYPE)?.n,
      0,
    );
    report.checks.push(
      "Full, delta, stream, append, provider import, main flush and mailbox reconciliation cannot persist receipt rows or replay message payloads.",
    );
    const names = new Map([[owner.id, owner.name]]);
    const history = readHandoffHistory(database, owner.id, mainThreadId, names);
    const receiptRow = { message: queued.acknowledgement, providerSessionId: null };
    const raw = { recent: [...history.recent, receiptRow], latest: [receiptRow], hasOlder: false };
    const steps = new Map([[queued.deliveryId, "Receipt-only captured steps"]]);
    const packet = renderProviderHandoff(raw, names, steps);
    assert.ok(packet);
    assert.ok(packet.includes("Ordinary main history"));
    assert.equal(packet.includes(queued.acknowledgement.text), false);
    assert.equal(packet.includes("Receipt-only captured steps"), false);
    const routine = renderRoutineHandoff(raw, names, raw);
    assert.ok(routine);
    assert.equal(routine.includes(queued.acknowledgement.text), false);
    const only = { recent: [receiptRow], latest: [receiptRow], hasOlder: false };
    assert.equal(renderProviderHandoff(only, names, steps), null);
    assert.equal(renderRoutineHandoff(only, names, only), null);
    report.checks.push("Provider and routine handoffs omit receipt text and captured receipt steps.");

    await current.close();
    runChild("stock-fixture.mjs", ["--stock", root, preservedId]);
    current = await openFixture(root);
    report.checks.push(
      "Fresh HEAD stock deletion cannot find a virtual receipt; stock main-history deletion preserves the task request and file.",
    );
    assert.ok(current.mailbox.workReceipt(ownerId, mainThreadId, preservedId));
    assert.equal(current.database.readConversationMessages(ownerId, mainThreadId, [preservedId]).length, 0);
    assert.equal(current.database.readConversationMessages(ownerId, sideThreadId, [preservedId]).length, 1);
    const restored = await Effect.runPromise(current.reader.read(ownerId));
    assert.ok(restored.messages.some((message) => message.id === preservedId));
    // Resolve a receipt without a cached virtual notice.
    current.conversation.setSnapshot(ownerId, current.database.readConversation(ownerId, mainThreadId));
    await Effect.runPromise(
      current.deletion.delete({ agentId: ownerId, messageId: queued.deliveryId }, { memberId: null, deleteAny: true }),
    );
    assert.equal(current.mailbox.workReceipt(ownerId, mainThreadId, queued.deliveryId), null);
    assert.equal(current.mailbox.getDelivery(queued.deliveryId)?.delivery.status, "queued");
    assert.ok(current.database.deletedConversationMessageIds(mainThreadId).has(queued.deliveryId));
    assert.ok(
      await runCauseEffect(current.mailbox.resolveAttachment(queued.context.delivery.attachments[0]?.id ?? "")),
    );
    await runCauseEffect(current.mailbox.clearWorkReceipts(ownerId, mainThreadId));
    current.sync.reconcilePersistedMailboxMessages(current.store.list()[0] ?? owner);
    assert.equal(current.conversation.snapshot(ownerId)?.messages.some(isServerWorkReceipt), false);
    assert.equal(current.mailbox.workReceipts(ownerId, mainThreadId).length, 0);
    report.checks.push(
      "Restart restores custom notices; uncached deletion and main receipt clearing preserve side work and files and remove stale live notices.",
    );
  } finally {
    await current.close();
  }
  current = await openFixture(root);
  try {
    assert.equal(current.mailbox.workReceipts(ownerId, mainThreadId).length, 0);
    assert.equal(current.database.readConversationMessages(ownerId, mainThreadId, [preservedId]).length, 0);
    assert.equal(current.database.readConversationMessages(ownerId, sideThreadId, [preservedId]).length, 1);
    assert.ok(current.mailbox.getDelivery(preservedId));
    const file = await runCauseEffect(current.mailbox.resolveAttachment(preservedAttachmentId));
    assert.ok(file);
    assert.equal(readFileSync(file.path, "utf8"), "The main acknowledgement must not delete this side attachment.");
    report.checks.push("A second SQLite reopen retains hiding and the independent side request and file.");
    report.passed = true;
  } finally {
    await current.close();
  }
}

mkdirSync(output, { recursive: true });
if (process.argv.includes("--stock")) {
  const index = process.argv.indexOf("--stock");
  const root = process.argv[index + 1];
  const delivery = process.argv[index + 2];
  assert.ok(root && delivery);
  await stockFixture(root, delivery);
} else if (process.argv.includes("--fixture")) {
  try {
    await fixture();
  } catch (error) {
    report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.exitCode = 1;
  } finally {
    writeFileSync(join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  }
} else {
  const stockDeletion = readFileSync(join(projectRoot, "scripts/fixtures/message-deletion-v072.ts.txt"), "utf8");
  assert.equal(
    stockDeletion.includes("isServerWorkReceipt"),
    false,
    "The rollback fixture must use released stock deletion.",
  );
  for (const stock of [false, true]) {
    const built = await Bun.build({
      entrypoints: [import.meta.filename],
      target: "node",
      format: "esm",
      outdir: output,
      naming: stock ? "stock-fixture.mjs" : "fixture.mjs",
      plugins: stock
        ? [
            {
              name: "released-message-deletion",
              setup(build) {
                build.onLoad({ filter: /[\\/]src[\\/]backend[\\/]agent[\\/]message-deletion\.ts$/ }, () => ({
                  contents: stockDeletion,
                  loader: "ts",
                  resolveDir: join(projectRoot, "src/backend/agent"),
                }));
              },
            },
          ]
        : [],
    });
    assert.ok(built.success, String(built.logs));
  }
  runChild("fixture.mjs", ["--fixture"]);
}
