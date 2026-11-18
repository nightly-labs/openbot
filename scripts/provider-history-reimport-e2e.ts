import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { type AgentProviderId, type QueueDelivery, ROUTINE_QUIET_ANSWER_ITEM_TYPE } from "@openbot/contracts/ipc";
import { Duration, Effect } from "effect";
import { AgentStore } from "../src/backend/agent-store";
import { compactedItemJson } from "../src/backend/database/provider-history-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { DeliveryContext } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { isRecord } from "../src/backend/protocol";
import type { ProviderHistoryFragment, ReadProviderHistory } from "../src/backend/provider-history";
import {
  compactImportedProviderHistory,
  importProviderHistory,
  type ProviderHistoryCompactionResult,
  type ProviderHistoryImportResult,
  retiredSessionNeedsHistoryRead,
} from "../src/backend/provider-history-import";

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

const REQUEST_DELIVERY_ID = "teammate-request-delivery";
const REQUEST_ANSWER = "READY went to the teammate.";
/** A teammate's request that the agent answered with its own reply (#7465). */
const teammateRequestDelivery: DeliveryContext = {
  ...quietRoutineDelivery,
  delivery: {
    ...quietRoutineDelivery.delivery,
    id: REQUEST_DELIVERY_ID,
    messageId: "teammate-request-message",
    sender: { kind: "agent", agentId: "teammate-agent" },
    text: "Reply with READY.",
    turnId: "claude-request-turn",
  },
};

const QUESTION_DELIVERY_ID = "teammate-question-delivery";
const QUESTION_ANSWER = "I sent the result and asked you which file to keep.";
/** An answered teammate request whose turn also asked the user a question: the turn stays shown. */
const teammateQuestionDelivery: DeliveryContext = {
  ...teammateRequestDelivery,
  delivery: {
    ...teammateRequestDelivery.delivery,
    id: QUESTION_DELIVERY_ID,
    messageId: "teammate-question-message",
    turnId: "claude-question-turn",
  },
};

interface Report {
  schemaVersion: 1;
  generatedAt: string;
  command: string;
  imports: Record<string, ProviderHistoryImportResult>;
  retiredStarts: { turns: number; state: string | undefined }[];
  compaction: {
    belowMarker: ProviderHistoryCompactionResult;
    existingRows: ProviderHistoryCompactionResult;
    repeat: ProviderHistoryCompactionResult;
  };
  acceptance: Record<string, boolean>;
}

/**
 * Imports the same provider history more than once into a real database, as each start does, and
 * records that only new or changed turns are written again. It also records that an imported Codex
 * or Claude turn keeps only item hashes, and that a changed turn imports only from full items.
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
                : deliveryId === REQUEST_DELIVERY_ID
                  ? teammateRequestDelivery
                  : deliveryId === QUESTION_DELIVERY_ID
                    ? teammateQuestionDelivery
                    : null,
          findMessageDelivery: () => null,
          quietRoutineDelivery: (deliveryId) => deliveryId === QUIET_DELIVERY_ID || deliveryId === FAILED_DELIVERY_ID,
          quietTeammateThread: true,
          requestAnswered: (deliveryId) => deliveryId === REQUEST_DELIVERY_ID || deliveryId === QUESTION_DELIVERY_ID,
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
    const turnMessages = (turnId: string) =>
      JSON.stringify(
        database
          .readConversation(agentId, threadId)
          .messages.filter((message) => message.turnId === turnId)
          .map(({ id, text, status, itemType }) => ({ id, text, status, itemType })),
      );
    const stagedRows = (sessionId: string, turnId?: string) =>
      count(
        database,
        `SELECT COUNT(*) AS count FROM provider_history_staging WHERE session_id = ?${turnId ? " AND turn_id = ?" : ""}`,
        ...(turnId ? [sessionId, turnId] : [sessionId]),
      );
    const compactedRows = (sessionId: string, turnId?: string) =>
      count(
        database,
        `SELECT COUNT(*) AS count FROM provider_history_staging
         WHERE session_id = ? AND substr(item_json, 1, 8) = '"sha256:'${turnId ? " AND turn_id = ?" : ""}`,
        ...(turnId ? [sessionId, turnId] : [sessionId]),
      );
    const storedItemJson = (sessionId: string, itemKey: string) => {
      const row = database.connection
        .prepare("SELECT item_json FROM provider_history_staging WHERE session_id = ? AND item_key = ?")
        .get(sessionId, itemKey);
      return isRecord(row) && typeof row.item_json === "string" ? row.item_json : null;
    };

    const turn1 = turn("codex-turn-1", 1);
    const turn3 = turn("codex-turn-3", 3);
    const recordsOnlyTurn: ProviderHistoryFragment = { ...turn("codex-records-only", 4), recordsOnly: true };
    const codexHistory = [turn1, turn("codex-turn-2", 2), turn3, recordsOnlyTurn];

    const first = await runImport("codex-session", "codex", codexHistory);
    const messagesAfterFirst = messageTexts();
    // Three imported turns of two items each keep only hashes. The records-only turn stays in full.
    const compactedAfterFirst = compactedRows("codex-session");
    const recordsOnlyKeptFull =
      stagedRows("codex-session", "codex-records-only") === 2 &&
      compactedRows("codex-session", "codex-records-only") === 0;
    const firstAnswer = turn1.items[1];
    const hashMatchesItem =
      firstAnswer !== undefined &&
      storedItemJson("codex-session", "codex-turn-1-answer") === compactedItemJson(JSON.stringify(firstAnswer));

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

    const claudeCompacted = compactedRows("claude-session") === 4;

    // ACP transcripts are user data: their items stay in full after import.
    const grokFirst = await runImport("grok-session", "grok", [{ ...turn("grok-turn-1", 20), recordsOnly: true }]);
    const grokKeptFull = stagedRows("grok-session") === 2 && compactedRows("grok-session") === 0;

    // A turn in two fragments whose second fragment changes. The first read writes the second fragment
    // in full but must not import: the first fragment holds only a hash. The next read writes the first
    // fragment in full, then imports the whole turn.
    const lateTurnId = "late-split-turn";
    const lateFirst = await runImport("late-split-session", "codex", splitTurn(lateTurnId, 13));
    const lateCompacted = compactedRows("late-split-session") === 2;
    const lateMessagesBefore = turnMessages(lateTurnId);
    const eventsBeforeLateEdit = events();
    const lateEdited = splitTurn(lateTurnId, 13, "edited", "b");
    const lateWaiting = await runImport("late-split-session", "codex", lateEdited);
    const lateWaitWroteNoMessage =
      lateWaiting.turns === 0 &&
      lateWaiting.messages === 0 &&
      events() === eventsBeforeLateEdit &&
      turnMessages(lateTurnId) === lateMessagesBefore;
    const lateWaitKeptFirstHash =
      compactedRows("late-split-session") === 1 &&
      compactedRows("late-split-session", lateTurnId) === 1 &&
      storedItemJson("late-split-session", `${lateTurnId}-b`)?.includes("Part B 13 edited") === true;
    const lateImported = await runImport("late-split-session", "codex", lateEdited);
    const lateTexts = messageTexts();
    const lateImportedFullTurn =
      lateImported.turns === 1 &&
      lateTexts.includes("Part A 13") &&
      lateTexts.includes("Part B 13 edited") &&
      !lateTexts.includes("Part B 13") &&
      compactedRows("late-split-session") === 2;

    // The provider drops an item and changes another. The dropped item's hash is deleted after the
    // full read, so the turn imports in the same read and does not wait for an item that never comes.
    const staleTurnId = "stale-turn";
    const staleFull: ProviderHistoryFragment = {
      ...turn(staleTurnId, 14),
      items: [
        ...turn(staleTurnId, 14).items,
        { type: "agentMessage", id: `${staleTurnId}-dropped`, text: "Dropped 14", status: "completed" },
      ],
    };
    const staleFirst = await runImport("stale-session", "codex", [staleFull]);
    const staleCompacted = compactedRows("stale-session") === 3;
    const staleEdited = await runImport("stale-session", "codex", [turn(staleTurnId, 14, "edited")]);
    const staleDropped =
      staleEdited.turns === 1 &&
      messageTexts().includes("Answer 14 edited") &&
      stagedRows("stale-session") === 2 &&
      compactedRows("stale-session") === 2;

    // A retired session whose compacted turn changed in its second fragment. Each start reads a retired
    // session only while `retiredSessionNeedsHistoryRead` (the rule of `boot-recovery.ts`) says so. The
    // first changed read must not end the import, or no later start reads the session again.
    const retiredSessionId = "retired-session";
    const retiredTurnId = "retired-split-turn";
    const retiredFirst = await runImport(retiredSessionId, "codex", splitTurn(retiredTurnId, 21));
    // The provider changed the turn after the last complete read, then the session was retired.
    const retiredAt = "2001-01-01T00:00:00.000Z";
    database.connection
      .prepare("UPDATE provider_history_imports SET updated_at = ? WHERE session_id = ?")
      .run("2000-01-01T00:00:00.000Z", retiredSessionId);
    const retiredEdited = splitTurn(retiredTurnId, 21, "edited", "b");
    const retiredStarts: { turns: number; state: string | undefined }[] = [];
    while (
      retiredStarts.length < 5 &&
      retiredSessionNeedsHistoryRead(database.providerHistoryImport(retiredSessionId), retiredAt)
    ) {
      const result = await runImport(retiredSessionId, "codex", retiredEdited);
      retiredStarts.push({ turns: result.turns, state: database.providerHistoryImport(retiredSessionId)?.state });
    }
    const retiredTexts = messageTexts();
    const retiredWaitingTurnImports =
      retiredFirst.turns === 1 &&
      JSON.stringify(retiredStarts) ===
        JSON.stringify([
          { turns: 0, state: "active" },
          { turns: 1, state: "complete" },
        ]) &&
      retiredTexts.includes("Part B 21 edited") &&
      !retiredTexts.includes("Part B 21") &&
      compactedRows(retiredSessionId) === 2;

    // A database from before compaction: imported Codex rows in full, a Codex turn that is not
    // imported, and Grok rows. Only the imported Codex rows are compacted, in small batches.
    const legacyHistory = [turn("legacy-turn-1", 15), turn("legacy-turn-2", 16)];
    const legacyFirst = await runImport("legacy-session", "codex", legacyHistory);
    const restoreFull = database.connection.prepare(
      "UPDATE provider_history_staging SET item_json = ? WHERE session_id = ? AND item_key = ?",
    );
    for (const fragment of legacyHistory)
      for (const item of fragment.items) restoreFull.run(JSON.stringify(item), "legacy-session", item.id ?? "");
    database.stageProviderHistoryFragment({
      sessionId: "legacy-session",
      fragment: { ...turn("legacy-running-turn", 17), complete: false },
    });
    const legacyFullBefore = stagedRows("legacy-session") === 6 && compactedRows("legacy-session") === 0;
    // Without the schema 64 marker, an older release can open the file, so nothing is compacted: not
    // the existing rows, and not a turn that an import writes.
    const marker = database.connection.prepare("SELECT applied_at FROM schema_migrations WHERE version = 64").get();
    database.connection.prepare("DELETE FROM schema_migrations WHERE version = 64").run();
    const belowMarkerRows = await Effect.runPromise(compactImportedProviderHistory(database, Duration.zero));
    const belowMarkerImport = await runImport("below-marker-session", "codex", [turn("below-marker-turn", 18)]);
    const belowMarkerKeptFull =
      marker !== undefined &&
      belowMarkerRows.rows === 0 &&
      compactedRows("legacy-session") === 0 &&
      belowMarkerImport.turns === 1 &&
      stagedRows("below-marker-session") === 2 &&
      compactedRows("below-marker-session") === 0;
    database.connection
      .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (64, ?)")
      .run(String(marker?.applied_at));
    const existingRows = await Effect.runPromise(compactImportedProviderHistory(database, Duration.zero));
    const legacyCompacted =
      compactedRows("legacy-session", "legacy-turn-1") === 2 &&
      compactedRows("legacy-session", "legacy-turn-2") === 2 &&
      compactedRows("legacy-session", "legacy-running-turn") === 0 &&
      compactedRows("grok-session") === 0;
    const repeatCompaction = await Effect.runPromise(compactImportedProviderHistory(database, Duration.zero));
    stampStaging();
    const eventsBeforeLegacyRepeat = events();
    const legacyRepeat = await runImport("legacy-session", "codex", legacyHistory);
    const legacyRepeatWroteNothing =
      legacyRepeat.turns === 0 && stagingRewritten() === 0 && events() === eventsBeforeLegacyRepeat;

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

    // An answered teammate request whose agent wrote text and did not call the no-update tool: the
    // turn completion made the text quiet, so the import does too (#7465).
    const requestTurnId = "claude-request-turn";
    const claudeRequest = await runImport("claude-request-session", "claude", [
      {
        turnId: requestTurnId,
        status: "completed",
        startedAt: 11,
        itemOffset: 0,
        complete: true,
        items: [
          { type: "userMessage", id: `${requestTurnId}-prompt`, clientId: REQUEST_DELIVERY_ID, content: [] },
          { type: "agentMessage", id: `${requestTurnId}-answer`, text: REQUEST_ANSWER, status: "completed" },
        ],
      },
    ]);
    const requestAnswers = database
      .readConversation(agentId, threadId)
      .messages.filter((message) => message.turnId === requestTurnId && message.author === "assistant");

    // The same, but the turn also asked the user a question. OpenBot stored the question in the chat,
    // and the provider history does not hold it, so the import reads it there and keeps the turn shown.
    const questionTurnId = "claude-question-turn";
    database.persistConversationChanges({
      agentId,
      threadId,
      activeTurnId: null,
      changedMessages: [
        {
          id: `question-prompt:${questionTurnId}:1`,
          turnId: questionTurnId,
          author: "assistant",
          text: "Which file should I keep?",
          createdAt: new Date(12_000).toISOString(),
          status: "completed",
          itemType: "question_prompt",
        },
      ],
      eventType: "turn.completed",
    });
    const claudeQuestion = await runImport("claude-question-session", "claude", [
      {
        turnId: questionTurnId,
        status: "completed",
        startedAt: 12,
        itemOffset: 0,
        complete: true,
        items: [
          { type: "userMessage", id: `${questionTurnId}-prompt`, clientId: QUESTION_DELIVERY_ID, content: [] },
          { type: "agentMessage", id: `${questionTurnId}-answer`, text: QUESTION_ANSWER, status: "completed" },
        ],
      },
    ]);
    const questionAnswer = database
      .readConversation(agentId, threadId)
      .messages.find((message) => message.turnId === questionTurnId && message.text === QUESTION_ANSWER);

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
        claudeRequest,
        claudeQuestion,
        unfinished,
        grokFirst,
        lateFirst,
        lateWaiting,
        lateImported,
        staleFirst,
        staleEdited,
        retiredFirst,
        legacyFirst,
        legacyRepeat,
        belowMarkerImport,
      },
      retiredStarts,
      compaction: { belowMarker: belowMarkerRows, existingRows, repeat: repeatCompaction },
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
        claudeAnsweredRequestIsQuiet:
          claudeRequest.turns === 1 &&
          requestAnswers.length === 1 &&
          requestAnswers[0]?.text === REQUEST_ANSWER &&
          requestAnswers[0]?.itemType === ROUTINE_QUIET_ANSWER_ITEM_TYPE,
        claudeAnsweredRequestWithQuestionIsShown:
          claudeQuestion.turns === 1 &&
          questionAnswer !== undefined &&
          questionAnswer.itemType !== ROUTINE_QUIET_ANSWER_ITEM_TYPE,
        unfinishedTurnImportsAgain: unfinished.turns === 1,
        importedCodexTurnsKeepOnlyHashes: compactedAfterFirst === 6,
        compactedRowIsHashOfItem: hashMatchesItem,
        recordsOnlyTurnKeptFull: recordsOnlyKeptFull,
        importedClaudeTurnsKeepOnlyHashes: claudeCompacted,
        grokTurnKeptFull: grokFirst.turns === 1 && grokKeptFull,
        lateSplitTurnCompacted: lateFirst.turns === 1 && lateCompacted,
        lateSplitEditWritesNoPartialMessage: lateWaitWroteNoMessage,
        lateSplitEditKeepsFirstHashUntilNextRead: lateWaitKeptFirstHash,
        lateSplitEditImportsFullTurnNextRead: lateImportedFullTurn,
        staleHashDroppedAfterFullRead: staleFirst.turns === 1 && staleCompacted && staleDropped,
        retiredSessionWaitingTurnImportsOnNextStart: retiredWaitingTurnImports,
        existingRowsWereFull: legacyFirst.turns === 2 && legacyFullBefore,
        noCompactionBelowSchema64: belowMarkerKeptFull,
        // Four legacy rows, the two rows of the turn imported below schema 64, and the two rows of the
        // records-only Codex turn above: only ACP and Pi send records-only turns
        // (`provider-history-persistence.ts`), so a real Codex session has none.
        existingImportedRowsCompacted:
          existingRows.rows === 8 && legacyCompacted && compactedRows("below-marker-session") === 2,
        existingRowCompactionRunsOnce: repeatCompaction.rows === 0,
        compactedExistingRowsRepeatWritesNothing: legacyRepeatWroteNothing,
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

function splitTurn(
  turnId: string,
  startedAt: number,
  suffix?: string,
  editedPart: "a" | "b" = "a",
): ProviderHistoryFragment[] {
  const part = (label: "A" | "B") =>
    suffix && editedPart === label.toLowerCase()
      ? `Part ${label} ${startedAt} ${suffix}`
      : `Part ${label} ${startedAt}`;
  return [
    {
      turnId,
      status: "completed",
      startedAt,
      itemOffset: 0,
      complete: false,
      items: [{ type: "agentMessage", id: `${turnId}-a`, text: part("A"), status: "completed" }],
    },
    {
      turnId,
      status: "completed",
      startedAt,
      itemOffset: 1,
      complete: true,
      items: [{ type: "agentMessage", id: `${turnId}-b`, text: part("B"), status: "completed" }],
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
