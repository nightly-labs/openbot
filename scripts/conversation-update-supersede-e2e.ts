// Checks that a chat update that the next update replaces whole leaves the event log, and that a
// replay of the log then gives the same chat (bx_b4pehphr: a queue that moved every 0.4 s for a day
// wrote 1.7 million `conversation.snapshot-updated` events, 66 GB). Runs the real agent store and
// SQLite on a temporary profile. Each case writes updates, reads the chat, rebuilds the chat from its
// events (`rebuildThreadProjection`), and compares the two reads and the number of update events.
// No app, provider, account or network is started.
//
// Run: bun scripts/conversation-update-supersede-e2e.ts
// Writes .openbot-build/conversation-update-supersede-e2e/report.json and exits non-zero on a failure.

import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { ConversationMessage } from "@openbot/contracts/ipc";
import { AgentStore } from "../src/backend/agent-store";
import { databaseRows, requiredNumberColumn } from "../src/backend/database/database-rows";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const OUT = resolve(import.meta.dirname, "../.openbot-build/conversation-update-supersede-e2e");
const UPDATED = "conversation.snapshot-updated";

interface CaseReport {
  name: string;
  updateEvents: number;
  expectedUpdateEvents: number;
  updateActivities: number;
  replayMatches: boolean;
  passed: boolean;
}

const report: { cases: CaseReport[]; passed: boolean; error?: string } = { cases: [], passed: false };

const BASE = Date.parse("2026-11-06T12:00:00.000Z");

function message(id: string, minute: number, extra: Partial<ConversationMessage> = {}): ConversationMessage {
  return {
    id,
    author: "agent",
    text: `Message ${id}`,
    createdAt: new Date(BASE + minute * 60_000).toISOString(),
    status: "completed",
    reactions: [],
    reaction: null,
    ...extra,
  };
}

/** A teammate message that waits in a queue at `position`, as mailbox sync writes it. */
function queued(id: string, minute: number, position: number): ConversationMessage {
  return message(id, minute, { delivery: { id, status: "queued", position } });
}

type Write = (input: {
  changedMessages: ConversationMessage[];
  removedMessageIds?: string[];
  activeTurnId?: string | null;
  eventType?: string;
  commandId?: string;
}) => void;

const cases: Array<{ name: string; expectedUpdateEvents: number; run: (write: Write) => void }> = [
  {
    // The incident: the same queued messages, written again with their positions moving by one.
    name: "a moving queue keeps one update",
    expectedUpdateEvents: 1,
    run: (write) => {
      for (let index = 0; index < 400; index++) {
        const shift = index % 2;
        write({
          changedMessages: [queued("q1", 1, 2 - shift), queued("q2", 2, 4 - shift), queued("q3", 3, 5 - shift)],
        });
      }
    },
  },
  {
    name: "a later update with more messages after the same ones replaces the earlier",
    expectedUpdateEvents: 1,
    run: (write) => {
      write({ changedMessages: [message("a", 1)] });
      write({ changedMessages: [message("a", 1, { text: "Edited" }), message("b", 2)] });
    },
  },
  {
    name: "messages in another order are kept",
    expectedUpdateEvents: 2,
    run: (write) => {
      write({ changedMessages: [message("b", 2)] });
      write({ changedMessages: [message("a", 1), message("b", 2, { text: "Edited" })] });
    },
  },
  {
    name: "a key the later message leaves out keeps the earlier update",
    expectedUpdateEvents: 2,
    run: (write) => {
      write({ changedMessages: [message("a", 1, { senderAgentId: "agent-b" })] });
      write({ changedMessages: [message("a", 1, { text: "Edited" })] });
    },
  },
  {
    // With no delivery, a replay keeps the time of the message that came first.
    name: "a later time with no delivery keeps the earlier update",
    expectedUpdateEvents: 2,
    run: (write) => {
      write({ changedMessages: [message("a", 1)] });
      write({ changedMessages: [message("a", 5, { text: "Edited" })] });
    },
  },
  {
    name: "another event between them keeps the earlier update",
    expectedUpdateEvents: 2,
    run: (write) => {
      write({ changedMessages: [message("a", 1)] });
      write({ changedMessages: [message("b", 2)], eventType: "conversation.mailbox-reconciled" });
      write({ changedMessages: [message("a", 1, { text: "Edited" })] });
    },
  },
  {
    name: "another active turn keeps the earlier update",
    expectedUpdateEvents: 2,
    run: (write) => {
      write({ changedMessages: [message("a", 1)], activeTurnId: "turn-1" });
      write({ changedMessages: [message("a", 1, { text: "Edited" })], activeTurnId: null });
    },
  },
  {
    name: "an update that removes a message is kept",
    expectedUpdateEvents: 3,
    run: (write) => {
      write({ changedMessages: [message("gone", 0)] });
      write({ changedMessages: [message("a", 1)], removedMessageIds: ["gone"] });
      write({ changedMessages: [message("a", 1, { text: "Edited" })] });
    },
  },
  {
    name: "an update with its own command id is kept",
    expectedUpdateEvents: 2,
    run: (write) => {
      write({ changedMessages: [message("a", 1)], commandId: "conversation:import:fixed-1" });
      write({ changedMessages: [message("a", 1, { text: "Edited" })] });
    },
  },
];

async function runCase(name: string, expectedUpdateEvents: number, run: (write: Write) => void): Promise<CaseReport> {
  const root = await mkdtemp(join(tmpdir(), "openbot-update-supersede-"));
  const database = new OpenBotDatabase(join(root, "state"));
  const store = new AgentStore(join(root, "state"), join(root, "home"), database);
  try {
    await runCauseEffect(store.initialize());
    const agent = await runCauseEffect(
      store.createAgent({ name: "Writer", description: "Gets queued work", avatarSeed: "supersede", avatarHue: null }),
    );
    const threadId = store.ensureThreadIdNow(agent.id);
    run((input) => {
      database.persistConversationChanges({
        agentId: agent.id,
        threadId,
        activeTurnId: input.activeTurnId ?? null,
        changedMessages: input.changedMessages,
        removedMessageIds: input.removedMessageIds ?? [],
        eventType: input.eventType ?? UPDATED,
        detail: {},
        ...(input.commandId === undefined ? {} : { commandId: input.commandId }),
      });
    });
    // Before the replay, which writes the activity rows again.
    const updateActivities = requiredNumberColumn(
      databaseRows(
        database.connection
          .prepare(
            "SELECT COUNT(*) AS count FROM projection_thread_activities WHERE thread_id = ? AND activity_type = ?",
          )
          .all(threadId, UPDATED),
      )[0] ?? { count: 0 },
      "count",
    );
    const live = database.readConversation(agent.id, threadId);
    const replayed = database.rebuildThreadProjection(threadId);
    const updateEvents = requiredNumberColumn(
      databaseRows(
        database.connection
          .prepare(
            "SELECT COUNT(*) AS count FROM orchestration_events WHERE aggregate_type = 'thread' AND aggregate_id = ? AND event_type = ?",
          )
          .all(threadId, UPDATED),
      )[0] ?? { count: 0 },
      "count",
    );
    const replayMatches =
      isDeepStrictEqual(replayed.messages, live.messages) && replayed.activeTurnId === live.activeTurnId;
    return {
      name,
      updateEvents,
      expectedUpdateEvents,
      updateActivities,
      replayMatches,
      // Each removed update takes its activity row with it.
      passed: replayMatches && updateEvents === expectedUpdateEvents && updateActivities === updateEvents,
    };
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
}

try {
  for (const { name, expectedUpdateEvents, run } of cases)
    report.cases.push(await runCase(name, expectedUpdateEvents, run));
  report.passed = report.cases.every((result) => result.passed);
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  for (const result of report.cases)
    process.stdout.write(
      `${result.passed ? "ok  " : "FAIL"} ${result.name}: ${result.updateEvents}/${result.expectedUpdateEvents} events, ${result.updateActivities} activities, replay ${result.replayMatches ? "matches" : "differs"}\n`,
    );
  if (report.error) process.stdout.write(`${report.error}\n`);
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (!report.passed) process.exitCode = 1;
}
