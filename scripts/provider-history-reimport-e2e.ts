import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { type AgentProviderId, type QueueDelivery, ROUTINE_QUIET_ANSWER_ITEM_TYPE } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { DeliveryContext } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { isRecord } from "../src/backend/protocol";
import type { ProviderHistoryFragment, ReadProviderHistory } from "../src/backend/provider-history";
import { importProviderHistory, type ProviderHistoryImportResult } from "../src/backend/provider-history-import";

const REPORT_NAME = "provider-history-reimport-report.json";
const SENTINEL_TIME = "1970-01-01T00:00:00.000Z";
const QUIET_DELIVERY_ID = "quiet-routine-delivery";
const QUIET_ANSWER = "Nothing new since the last run.";
const quietRoutineDelivery: DeliveryContext = {
  delivery: {
    id: QUIET_DELIVERY_ID,
    messageId: "quiet-routine-message",
    recipientAgentId: "provider-history-reimport-agent",
    sender: {
      kind: "routine",
      routineId: "quiet-routine",
      runId: "quiet-routine-run",
      routineName: "Quiet routine",
      scheduledFor: new Date(9_000).toISOString(),
    },
    text: "Check for news.",
    attachments: [],
    replyToMessageId: null,
    status: "completed",
    position: null,
    turnId: "claude-quiet-turn",
    error: null,
    createdAt: new Date(9_000).toISOString(),
  } satisfies QueueDelivery,
  managedAttachments: [],
};

const FAILED_DELIVERY_ID = "failed-routine-delivery";
const FAILED_ANSWER = "The server is not reachable.";
/** A scheduled run whose agent called `routine_report_failure`: its delivery completed with the reason. */
const failedRoutineDelivery: DeliveryContext = {
  ...quietRoutineDelivery,
  delivery: {
    ...quietRoutineDelivery.delivery,
    id: FAILED_DELIVERY_ID,
    messageId: "failed-routine-message",
    turnId: "claude-failed-turn",
    error: "ssh: connect to host 10.0.0.5 port 22: Connection refused",
  },
};

interface Report {
  schemaVersion: 1;
  generatedAt: string;
  command: string;
  imports: Record<string, ProviderHistoryImportResult>;
  acceptance: Record<string, boolean>;
}

/**
 * Imports the same provider history more than once into a real database, as each start does, and
 * records that only new or changed turns are written again.
 */
async function runProviderHistoryReimportCheck(outputPath: string): Promise<Report> {
  const databaseRoot = await mkdtemp(join(tmpdir(), "openbot-provider-history-reimport-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "openbot-provider-history-reimport-home-"));
  const database = new OpenBotDatabase(databaseRoot);
  const agentStore = new AgentStore(databaseRoot, homeRoot, database);
  const agentId = "provider-history-reimport-agent";
  try {
    await runCauseEffect(agentStore.initialize());
    const agent = await runCauseEffect(
      agentStore.getOrCreate(agentId, "Provider history reimport", "Provider history reimport"),
    );
    const threadId = await runCauseEffect(agentStore.ensureThreadId(agent.id));

    const runImport = (sessionId: string, provider: AgentProviderId, fragments: readonly ProviderHistoryFragment[]) => {
      const readHistory: ReadProviderHistory = (_request, consume) =>
        Effect.gen(function* () {
          for (const fragment of fragments) if (!(yield* consume(fragment))) return;
        });
      return Effect.runPromise(
        importProviderHistory({
          database,
          readHistory,
          sessionId,
          provider,
          externalSessionId: `${sessionId}-external`,
          agentId,
          publicThreadId: threadId,
          findDelivery: (deliveryId) =>
            deliveryId === QUIET_DELIVERY_ID
              ? quietRoutineDelivery
              : deliveryId === FAILED_DELIVERY_ID
                ? failedRoutineDelivery
                : null,
          findMessageDelivery: () => null,
          quietRoutineDelivery: (deliveryId) => deliveryId === QUIET_DELIVERY_ID || deliveryId === FAILED_DELIVERY_ID,
        }),
      );
    };
    const stampStaging = () => {
      database.connection.prepare("UPDATE provider_history_staging SET updated_at = ?").run(SENTINEL_TIME);
      database.connection.prepare("UPDATE provider_history_turns SET updated_at = ?").run(SENTINEL_TIME);
    };
    const stagingRewritten = () =>
      count(database, "SELECT COUNT(*) AS count FROM provider_history_staging WHERE updated_at <> ?", SENTINEL_TIME) +
      count(database, "SELECT COUNT(*) AS count FROM provider_history_turns WHERE updated_at <> ?", SENTINEL_TIME);
    const events = () => count(database, "SELECT COUNT(*) AS count FROM orchestration_events");
    const messageTexts = () => database.readConversation(agentId, threadId).messages.map((message) => message.text);

    const turn1 = turn("codex-turn-1", 1);
    const turn3 = turn("codex-turn-3", 3);
    const recordsOnlyTurn: ProviderHistoryFragment = { ...turn("codex-records-only", 4), recordsOnly: true };
    const codexHistory = [turn1, turn("codex-turn-2", 2), turn3, recordsOnlyTurn];

    const first = await runImport("codex-session", "codex", codexHistory);
    const messagesAfterFirst = messageTexts();

    stampStaging();
    const eventsBeforeRepeat = events();
    const repeat = await runImport("codex-session", "codex", codexHistory);
    const repeatWroteNoRow = stagingRewritten() === 0;
    const repeatWroteNoEvent = events() === eventsBeforeRepeat;
    const repeatKeptMessages = JSON.stringify(messageTexts()) === JSON.stringify(messagesAfterFirst);

    // A start that stops after it staged unchanged turns must not move the time of the last full read.
    database.connection
      .prepare("UPDATE provider_history_imports SET updated_at = ? WHERE session_id = ?")
      .run(SENTINEL_TIME, "codex-session");
    database.ensureProviderHistoryImport({
      sessionId: "codex-session",
      threadId,
      provider: "codex",
      externalSessionId: "codex-session-external",
    });
    for (const fragment of codexHistory)
      database.stageProviderHistoryFragment({ sessionId: "codex-session", fragment });
    const partialRead = database.providerHistoryImport("codex-session");

    const editedHistory = [turn1, turn("codex-turn-2", 2, "edited"), turn3, recordsOnlyTurn];
    const edited = await runImport("codex-session", "codex", editedHistory);
    const messagesAfterEdit = messageTexts();

    const appended = await runImport("codex-session", "codex", [...editedHistory, turn("codex-turn-5", 5)]);
    const messagesAfterAppend = messageTexts();

    const claudeHistory = [turn("claude-turn-1", 6), turn("claude-turn-2", 7)];
    const claudeFirst = await runImport("claude-session", "claude", claudeHistory);
    const claudeRepeat = await runImport("claude-session", "claude", claudeHistory);

    // A turn in two fragments: a change in the first one must still import the turn.
    const splitFirst = await runImport("split-session", "codex", splitTurn("split-turn", 8));
    const splitRepeat = await runImport("split-session", "codex", splitTurn("split-turn", 8));
    const splitEdited = await runImport("split-session", "codex", splitTurn("split-turn", 8, "edited"));
    const messagesAfterSplitEdit = messageTexts();

    // A quiet routine run that a Claude agent answered live, and that the next start imports.
    const quietTurnId = "claude-quiet-turn";
    database.persistConversationChanges({
      agentId,
      threadId,
      activeTurnId: null,
      changedMessages: [
        {
          id: `${quietTurnId}:assistant`,
          turnId: quietTurnId,
          author: "assistant",
          text: QUIET_ANSWER,
          createdAt: new Date(9_000).toISOString(),
          status: "completed",
          itemType: ROUTINE_QUIET_ANSWER_ITEM_TYPE,
        },
      ],
      eventType: "turn.completed",
    });
    const claudeQuiet = await runImport("claude-quiet-session", "claude", [quietRoutineTurn(quietTurnId, 9)]);
    const quietAnswers = database
      .readConversation(agentId, threadId)
      .messages.filter((message) => message.turnId === quietTurnId && message.author === "assistant");

    // A run that reported a failure is never quiet, also after a no-update call.
    const failedTurnId = "claude-failed-turn";
    const claudeFailed = await runImport("claude-failed-session", "claude", [
      quietRoutineTurn(failedTurnId, 10, FAILED_DELIVERY_ID, FAILED_ANSWER),
    ]);
    const failedAnswers = database
      .readConversation(agentId, threadId)
      .messages.filter((message) => message.turnId === failedTurnId && message.author === "assistant");

    // A turn that an import did not finish keeps `imported = 0` and is imported at the next start.
    database.connection
      .prepare("UPDATE provider_history_turns SET imported = 0 WHERE session_id = ? AND turn_id = ?")
      .run("codex-session", "codex-turn-3");
    const unfinished = await runImport("codex-session", "codex", [...editedHistory, turn("codex-turn-5", 5)]);

    const report: Report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      command: process.argv.join(" "),
      imports: {
        first,
        repeat,
        edited,
        appended,
        claudeFirst,
        claudeRepeat,
        splitFirst,
        splitRepeat,
        splitEdited,
        claudeQuiet,
        claudeFailed,
        unfinished,
      },
      acceptance: {
        firstImportsEveryTurn: first.turns === codexHistory.length && messagesAfterFirst.length === 6,
        repeatImportsNoTurn: repeat.turns === 0 && repeat.messages === 0,
        repeatWritesNoStagedRow: repeatWroteNoRow,
        repeatWritesNoConversationEvent: repeatWroteNoEvent,
        repeatKeepsMessages: repeatKeptMessages,
        partialReadKeepsLastFullReadTime: partialRead?.state === "complete" && partialRead.updatedAt === SENTINEL_TIME,
        editImportsOnlyChangedTurn: edited.turns === 1 && edited.messages === 2,
        editUpdatesMessage: messagesAfterEdit.includes("Answer 2 edited") && !messagesAfterEdit.includes("Answer 2"),
        appendImportsOnlyNewTurn: appended.turns === 1 && messagesAfterAppend.includes("Answer 5"),
        claudeRepeatImportsNoTurn: claudeFirst.turns === 2 && claudeRepeat.turns === 0,
        splitRepeatImportsNoTurn: splitFirst.turns === 1 && splitRepeat.turns === 0,
        splitEditInFirstFragmentImportsTurn:
          splitEdited.turns === 1 && messagesAfterSplitEdit.includes("Part A 8 edited"),
        claudeQuietAnswerStoredOnce:
          claudeQuiet.turns === 1 &&
          quietAnswers.length === 1 &&
          quietAnswers[0]?.id === `${quietTurnId}:assistant` &&
          quietAnswers[0]?.itemType === ROUTINE_QUIET_ANSWER_ITEM_TYPE,
        claudeFailedRunAnswerIsNotQuiet:
          claudeFailed.turns === 1 &&
          failedAnswers.length === 1 &&
          failedAnswers[0]?.text === FAILED_ANSWER &&
          failedAnswers[0]?.itemType !== ROUTINE_QUIET_ANSWER_ITEM_TYPE,
        unfinishedTurnImportsAgain: unfinished.turns === 1,
        importCompleted: database.providerHistoryImport("codex-session")?.state === "complete",
      },
    };
    await mkdir(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    return report;
  } finally {
    database.close();
    await rm(databaseRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
}

function turn(turnId: string, startedAt: number, suffix?: string): ProviderHistoryFragment {
  const text = (label: string) => (suffix ? `${label} ${startedAt} ${suffix}` : `${label} ${startedAt}`);
  return {
    turnId,
    status: "completed",
    startedAt,
    itemOffset: 0,
    complete: true,
    items: [
      { type: "agentMessage", id: `${turnId}-commentary`, text: text("Commentary"), phase: "commentary" },
      { type: "agentMessage", id: `${turnId}-answer`, text: text("Answer"), status: "completed" },
    ],
  };
}

/** A scheduled run that called the no-update tool and wrote a short answer, as Claude stores it. */
function quietRoutineTurn(
  turnId: string,
  startedAt: number,
  deliveryId = QUIET_DELIVERY_ID,
  answer = QUIET_ANSWER,
): ProviderHistoryFragment {
  return {
    turnId,
    status: "completed",
    startedAt,
    itemOffset: 0,
    complete: true,
    items: [
      { type: "userMessage", id: `${turnId}-prompt`, clientId: deliveryId, content: [] },
      { type: "toolCall", id: `${turnId}-tool`, name: "mcp__openbot__routine_no_update", status: "completed" },
      { type: "agentMessage", id: `${turnId}-answer`, text: answer, status: "completed" },
    ],
  };
}

function splitTurn(turnId: string, startedAt: number, suffix?: string): ProviderHistoryFragment[] {
  const first = suffix ? `Part A ${startedAt} ${suffix}` : `Part A ${startedAt}`;
  return [
    {
      turnId,
      status: "completed",
      startedAt,
      itemOffset: 0,
      complete: false,
      items: [{ type: "agentMessage", id: `${turnId}-a`, text: first, status: "completed" }],
    },
    {
      turnId,
      status: "completed",
      startedAt,
      itemOffset: 1,
      complete: true,
      items: [{ type: "agentMessage", id: `${turnId}-b`, text: `Part B ${startedAt}`, status: "completed" }],
    },
  ];
}

function count(database: OpenBotDatabase, sql: string, ...parameters: string[]): number {
  const row = database.connection.prepare(sql).get(...parameters);
  if (!isRecord(row) || typeof row.count !== "number") throw new Error("The reimport check read an invalid count.");
  return row.count;
}

if (import.meta.main) {
  const outputPath = resolve(process.cwd(), ".openbot-build", REPORT_NAME);
  const report = await runProviderHistoryReimportCheck(outputPath);
  const failed = Object.entries(report.acceptance).flatMap(([name, passed]) => (passed ? [] : [name]));
  if (failed.length > 0) throw new Error(`Provider history reimport check failed: ${failed.join(", ")}. ${outputPath}`);
  process.stdout.write(`Provider history reimport check passed. Wrote ${outputPath}.\n`);
}
