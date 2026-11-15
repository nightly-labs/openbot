// Runs the real mailbox against isolated SQLite profiles. --compare-release also benchmarks v0.71.0.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { MailboxProjectionChanges, MailboxProjectionState } from "../src/backend/database/mailbox-projection";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const projectRoot = resolve(import.meta.dirname, "..");
const output =
  process.env.OPENBOT_TURN_TEST_OUTPUT ?? join(projectRoot, ".openbot-build/mailbox-history-performance-e2e");

class FixtureDatabase extends OpenBotDatabase {
  beforeFailedWrite: (() => void) | undefined;
  normalizationWrites = 0;

  override replaceMailboxState(
    commandId: string,
    state: MailboxProjectionState,
    eventType: string,
    fileDeletions: string[] = [],
    rebaseHistory = false,
  ): boolean {
    if (eventType === "mailbox.normalized") this.normalizationWrites += 1;
    return super.replaceMailboxState(commandId, state, eventType, fileDeletions, rebaseHistory);
  }

  override applyMailboxChanges(
    commandId: string,
    state: MailboxProjectionState,
    changes: MailboxProjectionChanges,
    eventType: string,
    fileDeletions: string[] = [],
  ): boolean {
    if (this.beforeFailedWrite) {
      const read = this.beforeFailedWrite;
      this.beforeFailedWrite = undefined;
      read();
      throw new Error("Injected isolated fixture write failure.");
    }
    return super.applyMailboxChanges(commandId, state, changes, eventType, fileDeletions);
  }
}

async function runFixture(): Promise<void> {
  const variant = process.argv.at(-1);
  assert.ok(variant === "original" || variant === "cached");
  const root = mkdtempSync(join(output, `${variant}-`));
  const profile = join(root, "profile");
  const database = new FixtureDatabase(profile);
  const checks: string[] = [];
  try {
    await runCauseEffect(database.initialize());
    const keys: Record<string, string> = {};
    const state: MailboxProjectionState = {
      messages: [],
      deliveries: [],
      drafts: [],
      generatedAttachments: [],
      pausedAgentIds: [],
      reactions: [],
      idempotency: keys,
    };
    for (let i = 0; i < 8_192; i += 1) {
      const id = `message-${i}`;
      state.messages.push({
        id,
        sender: { kind: "agent", agentId: "sender" },
        text: `fixture ${i}: ${"Synthetic history; no user data. ".repeat(240)}`,
        replyToMessageId: null,
        createdAt: new Date(1_700_000_000_000 + i).toISOString(),
        attachments: [],
      });
      keys[`agent:sender:turn-${i}:0`] = id;
    }
    // Preserve the old first-key-wins rule, including an undefined turn from a malformed key.
    state.messages.push({
      id: "duplicate",
      sender: { kind: "agent", agentId: "sender" },
      text: "duplicate key fixture",
      replyToMessageId: null,
      createdAt: new Date(1_700_000_010_000).toISOString(),
      attachments: [],
    });
    keys.first = "duplicate";
    keys["agent:sender:later:0"] = "duplicate";
    database.replaceMailboxState("fixture-seed", state, "mailbox.fixture");
    let mailbox = new MailboxStore(profile, join(root, "shared"), database);
    const loadSamplesMs: number[] = [];
    for (let sample = 0; sample < 3; sample += 1) {
      mailbox = new MailboxStore(profile, join(root, "shared"), database);
      const start = performance.now();
      await runCauseEffect(mailbox.initialize());
      loadSamplesMs.push(performance.now() - start);
    }
    assert.equal(database.normalizationWrites, 0, "Current rows must not trigger full projection rewrites.");
    assert.ok(mailbox.hasRequestFromTurn("sender", "turn-8191"));
    assert.equal(mailbox.hasRequestFromTurn("sender", "missing"), false);
    const conversation = mailbox.conversationMessages("sender");
    assert.equal(conversation.find((message) => message.exchange?.messageId === "message-8191")?.turnId, "turn-8191");
    assert.equal(conversation.find((message) => message.exchange?.messageId === "duplicate")?.turnId, undefined);
    assert.equal(mailbox.hasRequestFromTurn("sender", "later"), false);
    checks.push("Existing turn and conversation results survive SQLite load.");
    const samples: number[] = [];
    for (let round = 0; round < 5; round += 1) {
      const start = performance.now();
      for (let i = 0; i < 100; i += 1) assert.ok(mailbox.hasRequestFromTurn("sender", "turn-8191"));
      samples.push(performance.now() - start);
    }
    const send = (turn: string) =>
      mailbox.enqueue({
        sender: { kind: "agent", agentId: "sender" },
        recipientAgentIds: ["recipient"],
        text: "isolated fixture",
        idempotencyKey: `agent:sender:${turn}:0`,
      });
    const receipt = await runCauseEffect(send("added"));
    assert.ok(mailbox.hasRequestFromTurn("sender", "added"));
    assert.ok(mailbox.hasAgentMessageFromTurnTo("sender", "added", "recipient", new Set()));
    assert.equal((await runCauseEffect(send("added"))).messageId, receipt.messageId);
    checks.push("New keys refresh both lookups and keep idempotent receipt behavior.");
    database.beforeFailedWrite = () => assert.ok(mailbox.hasRequestFromTurn("sender", "rolled-back"));
    await assert.rejects(runCauseEffect(send("rolled-back")));
    assert.equal(mailbox.hasRequestFromTurn("sender", "rolled-back"), false);
    checks.push("A read during a failed write cannot leave a stale turn after rollback.");
    const taskReceipt = await runCauseEffect(
      mailbox.enqueue({
        sender: { kind: "agent", agentId: "sender" },
        recipientAgentIds: ["sender"],
        taskId: "task-rollback",
        text: "isolated task deletion",
        idempotencyKey: "agent:sender:task-kept:0",
      }),
    );
    const taskDelivery = taskReceipt.deliveries[0];
    assert.ok(taskDelivery);
    await runCauseEffect(mailbox.markStarting(taskDelivery.id));
    await runCauseEffect(mailbox.markTerminal(taskDelivery.id, "completed"));
    assert.ok(mailbox.hasRequestFromTurn("sender", "task-kept"));
    database.beforeFailedWrite = () => assert.equal(mailbox.hasRequestFromTurn("sender", "task-kept"), false);
    await assert.rejects(runCauseEffect(mailbox.deleteTaskMessages("sender", "task-rollback")));
    assert.ok(mailbox.hasRequestFromTurn("sender", "task-kept"), "Cloned rollback restores the original source turn.");
    await runCauseEffect(mailbox.deleteTaskMessages("sender", "task-rollback"));
    assert.equal(mailbox.hasRequestFromTurn("sender", "task-kept"), false);
    checks.push("A failed task deletion restores cached turn results from the cloned state; retry deletes the task.");
    mailbox.forgetIdempotencyKeys("agent:sender:added:", new Date(Date.now() + 60_000));
    assert.equal(mailbox.hasRequestFromTurn("sender", "added"), false);
    checks.push("Replacing the key map refreshes the lookup.");
    const deletion = await runCauseEffect(
      mailbox.enqueue({
        sender: { kind: "user" },
        recipientAgentIds: ["recipient"],
        text: "delete only this fixture",
        idempotencyKey: "user:deletion:0",
      }),
    );
    mailbox.conversationMessages("recipient");
    const delivery = deletion.deliveries[0];
    assert.ok(delivery);
    await runCauseEffect(mailbox.markStarting(delivery.id));
    await runCauseEffect(mailbox.markTerminal(delivery.id, "completed"));
    assert.equal(await runCauseEffect(mailbox.deleteShownMessages("recipient", [delivery.id])), "deleted");
    assert.equal(mailbox.receiptForKey("user:deletion:0"), null);
    checks.push("Deleting a fixture removes its key and receipt.");
    // Only this fixture changes: an older spelling, an invalid sender label and an empty reply.
    const legacy = database.connection
      .prepare("SELECT message_json FROM projection_mailbox_messages WHERE message_id='message-0'")
      .get()?.message_json;
    assert.ok(typeof legacy === "string");
    const legacyMessage = JSON.parse(legacy);
    legacyMessage.sender = { kind: "bot", botId: "sender" };
    legacyMessage.senderMember = { invalid: true };
    legacyMessage.replyToMessageId = "";
    database.connection
      .prepare("UPDATE projection_mailbox_messages SET message_json=? WHERE message_id='message-0'")
      .run(JSON.stringify(legacyMessage));
    const repaired = new MailboxStore(profile, join(root, "shared"), database);
    await runCauseEffect(repaired.initialize());
    assert.equal(database.normalizationWrites, 1);
    const repairedJson = database.connection
      .prepare("SELECT message_json FROM projection_mailbox_messages WHERE message_id='message-0'")
      .get()?.message_json;
    assert.ok(typeof repairedJson === "string");
    const repairedMessage = JSON.parse(repairedJson);
    assert.deepEqual(repairedMessage.sender, { kind: "agent", agentId: "sender" });
    assert.equal(repairedMessage.replyToMessageId, null);
    assert.equal(repairedMessage.senderMember, undefined);
    assert.equal(repairedMessage.text, legacyMessage.text);
    checks.push("Legacy key, sender-label and reply repairs still persist without altering message text.");
    const sorted = [...samples].sort((a, b) => a - b);
    writeFileSync(
      join(output, `${variant}.json`),
      JSON.stringify(
        {
          passed: true,
          messages: state.messages.length,
          loadSamplesMs,
          medianLoadMs: [...loadSamplesMs].sort((a, b) => a - b)[1],
          readsPerSample: 100,
          medianMs: sorted[2],
          samplesMs: samples,
          checks,
          conversation,
        },
        null,
        2,
      ),
    );
  } finally {
    database.close();
  }
}

async function runDriver(): Promise<void> {
  mkdirSync(output, { recursive: true });
  const compareRelease = process.argv.includes("--compare-release");
  const variants = compareRelease ? ["original", "cached"] : ["cached"];
  for (const variant of variants) {
    const bundle = join(output, `${variant}.mjs`);
    const plugins: Bun.BunPlugin[] = [];
    if (variant === "original") {
      const original = spawnSync("git", ["show", "v0.71.0:src/backend/mailbox-store.ts"], {
        cwd: projectRoot,
        encoding: "utf8",
        windowsHide: true,
      });
      assert.equal(original.status, 0, "Fetch tag v0.71.0 before using --compare-release.");
      plugins.push({
        name: "released-mailbox",
        setup(builder) {
          builder.onLoad({ filter: /[\\/]src[\\/]backend[\\/]mailbox-store\.ts$/ }, (args) => ({
            contents: original.stdout,
            loader: "ts",
            resolveDir: resolve(args.path, ".."),
          }));
        },
      });
    }
    const build = await Bun.build({
      entrypoints: [import.meta.filename],
      target: "node",
      format: "esm",
      outdir: output,
      naming: `${variant}.mjs`,
      plugins,
    });
    assert.ok(build.success, String(build.logs));
    const run = spawnSync("node", [bundle, "--fixture", variant], {
      cwd: projectRoot,
      env: { ...process.env, OPENBOT_TURN_TEST_OUTPUT: output },
      encoding: "utf8",
      windowsHide: true,
      timeout: 60_000,
    });
    assert.equal(run.status, 0, run.stderr + run.stdout);
  }
  const cachedReport = JSON.parse(readFileSync(join(output, "cached.json"), "utf8"));
  writeFileSync(
    join(output, "report.json"),
    JSON.stringify({ passed: cachedReport.passed, checks: cachedReport.checks }, null, 2),
  );
  if (!compareRelease) return;
  const originalReport = JSON.parse(readFileSync(join(output, "original.json"), "utf8"));
  assert.deepEqual(cachedReport.conversation, originalReport.conversation);
  writeFileSync(
    join(output, "comparison.json"),
    JSON.stringify(
      {
        passed: true,
        originalMedianMs: originalReport.medianMs,
        cachedMedianMs: cachedReport.medianMs,
        originalMedianLoadMs: originalReport.medianLoadMs,
        cachedMedianLoadMs: cachedReport.medianLoadMs,
        scope:
          "8193 synthetic messages (~64 MB text): mailbox load and 100 repeated turn lookups; excludes app startup and integrity scan",
        limitations: [
          "Shared SQLite connection already initialized; OS cache is warm.",
          "Three load samples per version, original then optimized; this is not production startup timing.",
        ],
        checks: cachedReport.checks,
      },
      null,
      2,
    ),
  );
}

if (process.argv.includes("--fixture")) await runFixture();
else await runDriver();
