// Checks a thread rewind through the database facade on a temporary profile.
// Run: bun scripts/thread-rewind-e2e.ts
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachmentReferences, serializeAttachmentReference } from "@openbot/contracts/attachment-references";
import type { ConversationMessage } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const root = await mkdtemp(join(tmpdir(), "openbot-thread-rewind-"));
const database = new OpenBotDatabase(join(root, "state"));

function message(id: string, author: "user" | "assistant", turnId: string, second: number): ConversationMessage {
  return {
    id,
    turnId,
    author,
    text: id,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, second)).toISOString(),
    status: "completed",
  };
}

try {
  const store = new AgentStore(join(root, "state"), join(root, "home"), database);
  await runCauseEffect(store.initialize());
  const agent = await runCauseEffect(
    store.createAgent({ name: "Rewind test", description: "Checks history", avatarSeed: "rewind", avatarHue: null }),
  );
  const threadId = store.ensureThreadIdNow(agent.id);
  const original = [
    message("first-question", "user", "turn-one", 1),
    message("first-answer", "assistant", "turn-one", 2),
    message("second-question", "user", "turn-two", 3),
    message("second-answer", "assistant", "turn-two", 4),
  ];
  database.persistConversation(
    { agentId: agent.id, threadId, activeTurnId: null, revision: 0, messages: original },
    "turn.completed",
  );

  const rewound = database.rewindConversation(agent.id, threadId, "second-question");
  assert.equal(rewound.threadId, threadId);
  assert.deepEqual(
    rewound.messages.map((entry) => entry.id),
    ["first-question", "first-answer"],
  );
  assert.deepEqual(
    database.readConversation(agent.id, threadId).messages.map((entry) => entry.id),
    ["first-question", "first-answer"],
  );

  database.persistConversation(
    { ...rewound, messages: [...rewound.messages, message("rewritten-question", "user", "turn-three", 5)] },
    "turn.started",
  );
  const retained = database.connection
    .prepare("SELECT payload_json FROM orchestration_events WHERE aggregate_id = ? AND event_type = 'thread.rewound'")
    .get(threadId);
  assert.equal(typeof retained?.payload_json, "string");
  const payload = JSON.parse(String(retained?.payload_json));
  assert.ok(isDynamicRecord(payload) && isDynamicRecord(payload.detail) && Array.isArray(payload.detail.priorMessages));
  assert.deepEqual(
    payload.detail.priorMessages.map((entry: unknown) => (isDynamicRecord(entry) ? entry.id : null)),
    original.map((entry) => entry.id),
  );
  assert.deepEqual([...database.rewoundMessageIds(threadId)], ["second-question", "second-answer"]);

  // A second rewrite keeps the earlier archive and excludes both removed suffixes from mailbox sync.
  database.rewindConversation(agent.id, threadId, "first-question");
  assert.deepEqual(database.readConversation(agent.id, threadId).messages, []);
  assert.deepEqual([...database.rewoundMessageIds(threadId)].sort(), [
    "first-answer",
    "first-question",
    "rewritten-question",
    "second-answer",
    "second-question",
  ]);
  const archives = database.connection
    .prepare(
      "SELECT COUNT(*) AS count FROM orchestration_events WHERE aggregate_id = ? AND event_type = 'thread.rewound'",
    )
    .get(threadId);
  assert.equal(archives?.count, 2);

  const mailbox = new MailboxStore(join(root, "state"), store.sharedRoot, database);
  await runCauseEffect(mailbox.initialize());
  const source = join(root, "question.txt");
  await writeFile(source, "context from the original question");
  const audio = join(root, "question.wav");
  await writeFile(audio, "recorded question");
  const receipt = await runCauseEffect(
    mailbox.enqueue({
      sender: { kind: "user" },
      recipientAgentIds: [agent.id],
      text: `Use ${serializeAttachmentReference("question.txt", "old-attachment")}`,
      sourceAttachments: [{ id: "old-attachment", path: source }],
      voiceRecordingSource: { path: audio, mimeType: "audio/wav" },
    }),
  );
  const rewritten = mailbox.conversationMessages(agent.id).find((entry) => entry.id === receipt.deliveries[0]?.id);
  assert.ok(rewritten);
  assert.equal(rewritten.attachments?.length, 1);
  assert.equal(attachmentReferences(rewritten.text)[0]?.attachmentId, rewritten.attachments?.[0]?.id);
  assert.notEqual(rewritten.attachments?.[0]?.id, "old-attachment");
  assert.equal(rewritten.voiceRecording?.mimeType, "audio/wav");
  if (receipt.deliveries[0]) mailbox.cancelNow(agent.id, receipt.deliveries[0].id);

  // The persisted rewrite intent keeps a queued delivery from starting before a recovered cut.
  database.persistConversation(
    {
      agentId: agent.id,
      threadId,
      activeTurnId: null,
      revision: 0,
      messages: [message("pending-question", "user", "pending-turn", 6)],
    },
    "turn.completed",
  );
  const pending = await runCauseEffect(
    mailbox.enqueue({
      sender: { kind: "user" },
      recipientAgentIds: [agent.id],
      text: "Rewritten after restart",
      rewriteSource: { threadId, messageId: "pending-question" },
    }),
  );
  assert.equal(mailbox.nextQueued(agent.id), null);
  const restoredMailbox = new MailboxStore(join(root, "state"), store.sharedRoot, database);
  await runCauseEffect(restoredMailbox.initialize());
  assert.equal(restoredMailbox.pendingRewrites()[0]?.deliveryId, pending.deliveries[0]?.id);
  assert.equal(restoredMailbox.nextQueued(agent.id), null);
  database.rewindConversation(agent.id, threadId, "pending-question");
  assert.equal(restoredMailbox.nextQueued(agent.id)?.delivery.id, pending.deliveries[0]?.id);
  assert.ok(restoredMailbox.pendingRewrites().some((intent) => intent.deliveryId === pending.deliveries[0]?.id));
  process.stdout.write("thread rewind: history, attachment references, and durable delivery hold passed\n");
} finally {
  database.close();
  await rm(root, { recursive: true, force: true });
}
