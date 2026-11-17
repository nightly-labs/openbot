// Real isolated SQLite: internal working state preserves the released latest-page message selection.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ConversationPage, ConversationSnapshot } from "@openbot/contracts/ipc";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const projectRoot = process.env.OPENBOT_WINDOW_TEST_ROOT ?? resolve(import.meta.dirname, "..");
const output = join(projectRoot, ".openbot-build/conversation-working-window-e2e");
const report: { passed: boolean; checks: string[]; publicReadMs?: number; workingReadMs?: number; error?: string } = {
  passed: false,
  checks: [],
};

function snapshot(page: ConversationPage): ConversationSnapshot {
  return {
    agentId: page.agentId,
    threadId: page.threadId,
    activeTurnId: page.activeTurnId,
    revision: page.revision,
    messages: page.messages,
  };
}

async function fixture(): Promise<void> {
  const root = mkdtempSync(join(output, "run-"));
  const database = new OpenBotDatabase(join(root, "profile"));
  try {
    const store = new AgentStore(join(root, "profile"), join(root, "home"), database);
    await runCauseEffect(store.initialize());
    const owner = await runCauseEffect(
      store.createAgent({
        name: "Working window fixture",
        description: "Isolated history",
        avatarSeed: "window",
        avatarHue: null,
      }),
    );
    const threadId = store.ensureThreadIdNow(owner.id);
    const full: ConversationSnapshot = {
      agentId: owner.id,
      threadId,
      revision: 0,
      activeTurnId: "turn-39",
      messages: Array.from({ length: 4000 }, (_, index) => ({
        id: `message-${index}`,
        author: index % 2 === 0 ? "user" : "assistant",
        text: `History ${index}`,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
        turnId: `turn-${Math.floor(index / 100)}`,
        status: "completed",
        ...(index === 3999 ? { replyToMessageId: "message-2" } : {}),
      })),
    };
    database.persistConversation(full, "fixture.history");
    let historyCounts = 0;
    const prepare = database.connection.prepare.bind(database.connection);
    database.connection.prepare = (sql) => {
      if (sql.includes("COUNT(*) AS older_count")) historyCounts++;
      return prepare(sql);
    };
    const publicStart = performance.now();
    const publicPage = database.readConversationPage(owner.id, threadId, { type: "latest" }, 100);
    report.publicReadMs = performance.now() - publicStart;
    assert.equal(historyCounts, 1, "The fixture must observe the released unloaded-history count.");
    assert.equal(publicPage.pageInfo.olderCount, 3900);
    assert.equal(publicPage.references["message-2"]?.id, "message-2");
    const workingStart = performance.now();
    assert.deepEqual(database.readConversationWindow(owner.id, threadId), snapshot(publicPage));
    report.workingReadMs = performance.now() - workingStart;
    assert.equal(historyCounts, 1, "Working state must not count unloaded history.");
    assert.deepEqual(
      database.readConversationWindow(owner.id, null),
      snapshot(database.readConversationPage(owner.id, null)),
    );
    report.checks.push(
      "Latest working messages, active turn and revision match the released page; no unloaded-history count is run.",
    );
    assert.ok(publicPage.pageInfo.olderCursor);
    const older = database.readConversationPage(
      owner.id,
      threadId,
      { type: "before", cursor: publicPage.pageInfo.olderCursor },
      100,
    );
    assert.equal(older.messages.length, 100);
    assert.equal(older.pageInfo.olderCount, 3800);
    assert.equal(older.messages[99]?.id, "message-3899");
    assert.deepEqual(database.readConversationPage(owner.id, threadId, { type: "latest" }, 100), publicPage);
    report.checks.push("Public history totals, reference lookup and older-page cursors retain their released values.");
    const newest = full.messages.at(-1);
    assert.ok(newest);
    database.persistConversationChanges({
      agentId: owner.id,
      threadId,
      activeTurnId: null,
      eventType: "fixture.change",
      changedMessages: [
        { ...newest, text: "Updated history" },
        {
          id: "message-new",
          author: "user",
          text: "New turn",
          createdAt: "2026-01-02T00:00:00.000Z",
          status: "completed",
          turnId: "turn-new",
        },
      ],
    });
    const changedPage = database.readConversationPage(owner.id, threadId, { type: "latest" }, 100);
    const countsBeforeWorking = historyCounts;
    assert.deepEqual(database.readConversationWindow(owner.id, threadId), snapshot(changedPage));
    assert.equal(historyCounts, countsBeforeWorking);
    assert.equal(changedPage.messages.at(-1)?.id, "message-new");
    assert.equal(database.readConversationMessages(owner.id, threadId, [newest.id])[0]?.text, "Updated history");
    report.checks.push("Message edits and a new turn produce the same bounded working snapshot and current revision.");
    report.passed = true;
  } finally {
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
  }
} else {
  const built = await Bun.build({
    entrypoints: [import.meta.filename],
    target: "node",
    format: "esm",
    outdir: output,
    naming: "fixture.mjs",
  });
  assert.ok(built.success, String(built.logs));
  const child = spawnSync("node", [join(output, "fixture.mjs"), "--fixture"], {
    cwd: projectRoot,
    env: { ...process.env, OPENBOT_WINDOW_TEST_ROOT: projectRoot },
    encoding: "utf8",
    windowsHide: true,
    timeout: 45_000,
  });
  // Machine-readable fixture output.
  process.stdout.write(child.stdout);
  process.stderr.write(child.stderr);
  assert.ifError(child.error);
  assert.equal(child.status, 0, "The working-window SQLite fixture failed.");
}
