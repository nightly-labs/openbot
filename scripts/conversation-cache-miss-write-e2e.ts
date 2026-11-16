// Checks that a chat update on a snapshot that the runtime cache no longer holds writes only the
// messages that changed, and that those changes are stored. Runs the real SQLite database and
// conversation runtime on a temporary profile. The chat has more messages than the 100 the runtime
// keeps. A caller takes the chat, then something replaces the cached copy, then the caller edits one
// message and adds one, and publishes its copy. Before the fix (#8166), each such update wrote every
// message of the chat again into the event log.
//
// The cases:
// - `provider-read`: a provider read replaces the cached chat.
// - `idle-eviction`: the idle sweep removes the cached chat.
// - `other-thread`: a read of another thread of the same agent replaces the cached chat.
// No app, provider, account or network is started.
//
// Run: bun scripts/conversation-cache-miss-write-e2e.ts
// Writes .openbot-build/conversation-cache-miss-write-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ConversationMessage, ConversationSnapshot } from "@openbot/contracts/ipc";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const OUT = resolve(import.meta.dirname, "../.openbot-build/conversation-cache-miss-write-e2e");
/** More than `CONVERSATION_SNAPSHOT_MESSAGE_LIMIT`, so the runtime keeps only part of the chat. */
const SEEDED_MESSAGES = 150;
const IDLE_LATER_MS = 24 * 60 * 60 * 1000;

type CaseName = "provider-read" | "idle-eviction" | "other-thread";

interface CaseReport {
  name: CaseName;
  heldMessages: number;
  writtenMessageIds: string[];
  storedEditedText: string | null;
  storedAddedText: string | null;
  passed: boolean;
  error?: string;
}

const report: { cases: CaseReport[]; passed: boolean } = { cases: [], passed: false };

function answer(index: number): ConversationMessage {
  return {
    id: `answer-${index}`,
    turnId: `turn-${index}`,
    author: "assistant",
    text: `Answer ${index}`,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, index)).toISOString(),
    status: "completed",
  };
}

async function runCase(name: CaseName, result: CaseReport): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "openbot-cache-miss-write-"));
  const database = new OpenBotDatabase(join(root, "state"));
  const store = new AgentStore(join(root, "state"), join(root, "home"), database);
  const conversation = new ConversationRuntime(
    store,
    () => {},
    () => store.list(),
  );
  try {
    await runCauseEffect(store.initialize());
    const writes: string[][] = [];
    const persistConversationChanges = database.persistConversationChanges.bind(database);
    database.persistConversationChanges = (input) => {
      writes.push(input.changedMessages.map((message) => message.id));
      return persistConversationChanges(input);
    };
    const agent = await runCauseEffect(
      store.createAgent({ name: "Writer", description: "Answers", avatarSeed: "cache-miss", avatarHue: null }),
    );
    const threadId = store.ensureThreadIdNow(agent.id);
    const seeded: ConversationSnapshot = {
      agentId: agent.id,
      threadId,
      activeTurnId: null,
      revision: 0,
      messages: Array.from({ length: SEEDED_MESSAGES }, (_, index) => answer(index)),
    };
    conversation.emitConversation(seeded, "e2e.seeded", {});

    const held = conversation.ensureSnapshot(agent.id, threadId);
    if (name === "provider-read") conversation.setSnapshot(agent.id, structuredClone(held));
    else if (name === "idle-eviction") conversation.evictIdleSnapshots(Date.now() + IDLE_LATER_MS);
    else conversation.ensureSnapshot(agent.id, `${threadId}-other`);

    const edited = held.messages.at(-1);
    assert.ok(edited);
    edited.text = `Edited after ${name}`;
    const added = { ...answer(SEEDED_MESSAGES), text: `Added after ${name}` };
    held.messages.push(added);
    result.heldMessages = held.messages.length;
    const first = writes.length;
    conversation.emitConversation(held);
    result.writtenMessageIds = writes.slice(first).flat();

    // A page read returns at most 100 messages, so the rows are read directly.
    const stored = database.connection
      .prepare("SELECT message_id, message_json FROM projection_thread_messages WHERE thread_id = ?")
      .all(threadId)
      .map((row) => ({ id: String(row.message_id), message: JSON.parse(String(row.message_json)) }));
    const storedText = (id: string): string | null => stored.find((row) => row.id === id)?.message.text ?? null;
    result.storedEditedText = storedText(edited.id);
    result.storedAddedText = storedText(added.id);

    assert.deepEqual(
      [...result.writtenMessageIds].sort(),
      [edited.id, added.id].sort(),
      "only the edited and the added message are written",
    );
    assert.equal(result.storedEditedText, edited.text, "the edit is stored");
    assert.equal(result.storedAddedText, added.text, "the added message is stored");
    assert.equal(stored.length, SEEDED_MESSAGES + 1, "no stored message is lost");
    result.passed = true;
  } finally {
    conversation.dispose();
    database.close();
    await rm(root, { recursive: true, force: true });
  }
}

for (const name of ["provider-read", "idle-eviction", "other-thread"] as const) {
  const result: CaseReport = {
    name,
    heldMessages: 0,
    writtenMessageIds: [],
    storedEditedText: null,
    storedAddedText: null,
    passed: false,
  };
  report.cases.push(result);
  try {
    await runCase(name, result);
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }
}
report.passed = report.cases.every((result) => result.passed);
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
for (const result of report.cases)
  process.stdout.write(
    `${result.passed ? "PASS" : "FAIL"} ${result.name}: wrote ${result.writtenMessageIds.length} of ${result.heldMessages}${result.error ? ` (${result.error})` : ""}\n`,
  );
process.stdout.write(`passed: ${report.passed}, report: ${join(OUT, "report.json")}\n`);
if (!report.passed) process.exit(1);
