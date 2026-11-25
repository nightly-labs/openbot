import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentSummary, ConversationMessage } from "@openbot/contracts/ipc";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const REPORT_DIRECTORY = resolve(import.meta.dirname, "../.openbot-build/conversation-ownership-e2e");
const steps: { name: string; passed: boolean; error?: string }[] = [];

function step(name: string, run: () => void): void {
  try {
    run();
    steps.push({ name, passed: true });
  } catch (error) {
    steps.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) });
  }
}

function agent(id: string): AgentSummary {
  return {
    id,
    provider: "codex",
    name: id,
    title: `${id} agent`,
    description: "",
    notifications: true,
    model: "gpt-5.6-luna",
    reasoningEffort: "medium",
    threadId: `openbot-thread-${id}`,
    workspacePath: `/tmp/openbot-${id}`,
    preview: "",
    updatedAt: "2026-11-23T10:00:00.000Z",
    avatarSeed: id,
    avatarHue: null,
    avatarUrl: null,
  };
}

function message(id: string, createdAt: string, extra: Partial<ConversationMessage> = {}): ConversationMessage {
  return { id, author: "user", text: id, status: "completed", createdAt, turnId: `${id}-turn`, ...extra };
}

const root = await mkdtemp(join(tmpdir(), "openbot-conversation-ownership-"));
const database = new OpenBotDatabase(root);
await runCauseEffect(database.initialize());
try {
  const first = agent("first");
  const second = agent("second");
  const secondThreadId = `openbot-thread-${second.id}`;
  database.replaceAgents("conversation-ownership", [first, second], "agents.imported");
  database.persistConversation(
    {
      agentId: first.id,
      threadId: first.threadId,
      activeTurnId: null,
      revision: 0,
      messages: [message("first-message", "2026-11-23T10:00:00.000Z")],
    },
    "conversation.seeded",
  );
  database.persistConversation(
    {
      agentId: second.id,
      threadId: secondThreadId,
      activeTurnId: null,
      revision: 0,
      messages: [
        message("second-root", "2026-11-23T10:00:00.000Z"),
        message("second-reply", "2026-11-23T10:01:00.000Z", {
          author: "assistant",
          replyToMessageId: "second-root",
        }),
      ],
    },
    "conversation.seeded",
  );

  step("another agent cannot read the full conversation", () => {
    assert.deepEqual(database.readConversation(first.id, secondThreadId).messages, []);
  });
  step("another agent cannot read one turn", () => {
    assert.deepEqual(database.readTurnConversation(first.id, secondThreadId, "second-reply-turn").messages, []);
  });
  step("another agent gets an empty page with no references", () => {
    const page = database.readConversationPage(first.id, secondThreadId);
    assert.deepEqual(page.messages, []);
    assert.deepEqual(page.references, {});
    assert.equal(page.pageInfo.hasOlder, false);
  });
  step("the owner reads the full conversation", () => {
    assert.deepEqual(
      database.readConversation(second.id, secondThreadId).messages.map(({ id }) => id),
      ["second-root", "second-reply"],
    );
  });
  step("the owner reads one turn", () => {
    assert.equal(database.readTurnConversation(second.id, secondThreadId, "second-reply-turn").messages.length, 1);
  });
  step("the owner reads a page with its reply reference", () => {
    const page = database.readConversationPage(second.id, secondThreadId, { type: "latest" }, 1);
    assert.deepEqual(
      page.messages.map(({ id }) => id),
      ["second-reply"],
    );
    assert.deepEqual(Object.keys(page.references), ["second-root"]);
    assert.equal(page.references["second-root"]?.text, "second-root");
  });
} finally {
  database.close();
  await rm(root, { recursive: true, force: true });
}

const failed = steps.filter((entry) => !entry.passed);
await mkdir(REPORT_DIRECTORY, { recursive: true });
await writeFile(
  resolve(REPORT_DIRECTORY, "report.json"),
  `${JSON.stringify({ passed: failed.length === 0, steps }, null, 2)}\n`,
);
for (const entry of failed) process.stderr.write(`FAIL ${entry.name}: ${entry.error}\n`);
if (failed.length > 0) process.exitCode = 1;
