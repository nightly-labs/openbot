import type { DatabaseSync } from "node:sqlite";
import { type AgentProviderId, type ConversationMessage, ROUTINE_QUIET_ANSWER_ITEM_TYPE } from "@openbot/contracts/ipc";
import { Duration, Effect } from "effect";
import { generatedMediaKind } from "./agent/image-generation";
import {
  isNoUpdateAnswer,
  isNoUpdateToolCall,
  isTextAnswer,
  keptQuietAnswer,
  quietNarration,
  quietTeammateTurnDelivery,
  teammateRequest,
} from "./agent/routine-quiet-runs";
import { mergeProviderHistoryMessages, messagesFromThreadItems, threadTurnBaseTime } from "./conversation-snapshots";
import { databaseRow, decodeConversationMessageJson, requiredStringColumn } from "./database/database-rows";
import type { DeliveryContext } from "./mailbox-store";
import type { ThreadItem } from "./protocol";
import { type ProviderClientOperationError, providerFailure, providerSync } from "./provider-client-effects";
import type {
  ProviderHistoryConsumer,
  ProviderHistoryFragment,
  ProviderHistoryRequest,
  ReadProviderHistory,
} from "./provider-history";

/** The synchronous database boundary needed by the bounded provider-history importer. */
interface ProviderHistoryImportDatabase {
  readonly connection: DatabaseSync;
  ensureProviderHistoryImport(input: {
    sessionId: string;
    threadId: string;
    provider: AgentProviderId;
    externalSessionId: string;
  }): { state: string; createdAt: string };
  stageProviderHistoryFragment(input: { sessionId: string; fragment: ProviderHistoryFragment }): {
    turnImported: boolean;
    rewroteItems: boolean;
    compactedItems: boolean;
  };
  dropCompactedProviderHistoryItems(sessionId: string, turnId: string): void;
  stagedProviderHistoryItems(input: {
    sessionId: string;
    turnId: string;
    afterIndex?: number;
    limit?: number;
  }): Array<{ itemIndex: number; item: ThreadItem }>;
  markProviderHistoryImportState(sessionId: string, state: "pending" | "active" | "complete" | "failed"): void;
  importProviderHistoryMessages(input: {
    sessionId: string;
    turnId: string;
    agentId: string;
    threadId: string;
    messages: readonly ConversationMessage[];
    /** Highest staged item included in this normalized page. */
    throughItemIndex?: number;
    complete: boolean;
    compact?: boolean;
    detail?: unknown;
  }): void;
}

export interface ProviderHistoryImportInput {
  database: ProviderHistoryImportDatabase;
  readHistory: ReadProviderHistory;
  sessionId: string;
  provider: AgentProviderId;
  externalSessionId: string;
  agentId: string;
  publicThreadId: string;
  cwd?: string;
  findDelivery(deliveryId: string): DeliveryContext | null;
  findMessageDelivery(messageId: string): DeliveryContext | null;
  /**
   * Whether this routine delivery can have ended quiet: a scheduled, script or webhook run, or a run
   * of a deleted routine, whose record is gone. A Test run cannot.
   */
  quietRoutineDelivery(deliveryId: string): boolean;
  /**
   * Whether a teammate's update in this thread can have ended quiet: the agent's own chat or a
   * routine's side thread, as at the turn completion. Left out, it cannot.
   */
  quietTeammateThread?: boolean;
  /**
   * Whether this teammate's answer replies to a request that a quiet routine run of the agent sent.
   * Its turn can have ended quiet after a call to the no-update tool. A run whose record is gone does
   * not count: the tool refused its answer, so the answer showed. Left out, no answer counts.
   */
  continuesQuietRun?(delivery: DeliveryContext["delivery"]): boolean;
  /**
   * Whether this teammate request has its result: the agent's own `send_message` reply in the turn that
   * ran it (#7465), or the turn's answer that OpenBot sent when the turn ended (#8021). The turn can
   * then have ended quiet, as at the turn completion. Left out, it cannot.
   */
  requestAnswered?(deliveryId: string): boolean;
}

export interface ProviderHistoryImportResult {
  turns: number;
  messages: number;
}

/** A bounded normalized page. It is never represented as a conversation snapshot. */
interface ProviderHistoryPartial {
  turnId: string;
  status?: string;
  startedAt?: number;
  itemOffset: number;
  baseTime?: number;
  complete: boolean;
  messages: readonly ConversationMessage[];
}

/**
 * Imports provider history as a stream of completed turns.
 *
 * The provider adapter owns its cursors. This layer keeps only incomplete turns in the durable
 * staging tables, then reads one bounded item page at a time and writes that page in one
 * transaction.
 * It never writes a full conversation snapshot and never deletes a message missing from a page.
 * A completed turn that an earlier import committed, and that did not change, is not imported again.
 *
 * A Codex or Claude turn keeps only item hashes after its import. When one of its items changes, the
 * turn imports only after a read wrote each of its items in full again: in the same read when the
 * change is in its first fragment, else in the next read. Until then the import stays `active`, so
 * the next start reads a retired session again. It never imports from a hash.
 */
export function importProviderHistory(
  input: ProviderHistoryImportInput,
): Effect.Effect<ProviderHistoryImportResult, ProviderClientOperationError> {
  return Effect.gen(function* () {
    const resumeKey = yield* providerSync(() =>
      importResumeKey(
        input,
        input.database.ensureProviderHistoryImport({
          sessionId: input.sessionId,
          threadId: input.publicThreadId,
          provider: input.provider,
          externalSessionId: input.externalSessionId,
        }),
      ),
    );
    let turns = 0;
    let messages = 0;
    let providerCovered = false;
    // A compacted turn that changed and waits for the next read to import it.
    let turnWaits = false;
    const seenTurns = new Set<string>();
    // Compacted turns whose first fragment in this read wrote its items in full, so this read writes
    // each item of the turn that the provider still sends in full.
    const rewrittenTurns = new Set<string>();
    const consume: ProviderHistoryConsumer = (fragment) =>
      Effect.gen(function* () {
        const staged = yield* providerSync(() =>
          input.database.stageProviderHistoryFragment({ sessionId: input.sessionId, fragment }),
        );
        if (!seenTurns.has(fragment.turnId)) {
          seenTurns.add(fragment.turnId);
          if (staged.rewroteItems) rewrittenTurns.add(fragment.turnId);
        }
        if (!fragment.complete) return true;
        providerCovered = true;
        // An earlier import committed this turn, and staging found no change since then.
        if (staged.turnImported) return true;
        if (staged.compactedItems) {
          // An earlier fragment of this read kept hashes; the next read writes them in full.
          if (!rewrittenTurns.has(fragment.turnId)) {
            turnWaits = true;
            return true;
          }
          // This read wrote each item that the provider still sends, so these are gone from it.
          yield* providerSync(() => input.database.dropCompactedProviderHistoryItems(input.sessionId, fragment.turnId));
        }
        // ACP replay has stable item IDs only inside the provider transcript. It has no stable
        // OpenBot turn ID, so normalizing it into the conversation projection would duplicate a
        // live turn after release and reload. Keep the bounded raw records for handoff and reads;
        // live OpenBot turns already committed their normalized messages under durable IDs.
        if (fragment.recordsOnly) {
          yield* providerSync(() =>
            input.database.importProviderHistoryMessages({
              sessionId: input.sessionId,
              turnId: fragment.turnId,
              agentId: input.agentId,
              threadId: input.publicThreadId,
              messages: [],
              complete: true,
              detail: {
                provider: input.provider,
                externalSessionId: input.externalSessionId,
                turnId: fragment.turnId,
                recordsOnly: true,
              },
            }),
          );
          turns += 1;
          return true;
        }
        const imported = yield* importCompletedTurn(input, fragment);
        turns += 1;
        messages += imported;
        return true;
      });

    yield* input
      .readHistory(
        {
          threadId: input.externalSessionId,
          ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
          items: "full",
          providerOnly: true,
          ...(resumeKey === undefined ? {} : { resumeKey }),
        } satisfies ProviderHistoryRequest,
        consume,
      )
      .pipe(
        Effect.tapError(() =>
          Effect.sync(() => {
            input.database.markProviderHistoryImportState(input.sessionId, "failed");
          }),
        ),
      );
    // A waiting turn keeps the import `active`, so the next start reads a retired session again.
    if (providerCovered)
      yield* providerSync(() =>
        input.database.markProviderHistoryImportState(input.sessionId, turnWaits ? "active" : "complete"),
      );
    return { turns, messages };
  });
}

/**
 * Whether a start reads the history of a retired session. It does not when the last read ended
 * complete after the session was retired: the session has no new turns, and no turn waits.
 */
export function retiredSessionNeedsHistoryRead(
  imported: { state: string; updatedAt: string } | null,
  retiredAt: string,
): boolean {
  return imported?.state !== "complete" || imported.updatedAt < retiredAt;
}

/** The bound of one compaction batch is in the store; this pause lets other work run between them. */
const COMPACTION_PAUSE = Duration.millis(5);

export interface ProviderHistoryCompactionResult {
  rows: number;
  bytes: number;
  batches: number;
}

/**
 * Compacts the imported Codex and Claude items of a database from before compaction, one small
 * transaction at a time. A new import compacts its turn itself, so this has work only once.
 */
export function compactImportedProviderHistory(
  database: {
    compactImportedProviderHistory(afterRowId: number): { lastRowId: number | null; rows: number; bytes: number };
  },
  pause: Duration.Duration = COMPACTION_PAUSE,
): Effect.Effect<ProviderHistoryCompactionResult, ProviderClientOperationError> {
  return Effect.gen(function* () {
    const result = { rows: 0, bytes: 0, batches: 0 };
    let afterRowId = 0;
    for (;;) {
      const batch = yield* providerSync(() => database.compactImportedProviderHistory(afterRowId));
      if (batch.lastRowId === null) return result;
      result.rows += batch.rows;
      result.bytes += batch.bytes;
      result.batches += 1;
      afterRowId = batch.lastRowId;
      yield* Effect.sleep(pause);
    }
  });
}

/**
 * The key that lets the provider read send only changed turns. It is given only when the last read
 * of this import row ended complete, and no complete turn waits for its import. A new import row has
 * a new creation time, so a cursor of an earlier row does not apply to it.
 */
function importResumeKey(
  input: ProviderHistoryImportInput,
  current: { state: string; createdAt: string },
): string | undefined {
  if (current.state !== "complete") return undefined;
  const waiting = databaseRow(
    input.database.connection
      .prepare(
        `SELECT 1 AS waiting FROM provider_history_turns
         WHERE session_id = ? AND imported = 0 AND complete = 1 LIMIT 1`,
      )
      .get(input.sessionId),
  );
  return waiting ? undefined : `${input.sessionId}:${current.createdAt}`;
}

function importCompletedTurn(
  input: ProviderHistoryImportInput,
  fragment: ProviderHistoryFragment,
): Effect.Effect<number, ProviderClientOperationError> {
  return Effect.gen(function* () {
    // Only a completed turn can end quiet; a failed or interrupted turn keeps its answers.
    const routine =
      fragment.status === undefined || fragment.status === "completed"
        ? yield* routineTurnAnswers(input, fragment.turnId)
        : "none";
    // One for the whole turn: a repeated note on a later page stays out, as at the turn completion.
    const keep = routine === "none" ? null : keptRoutineMessage(routine, input.provider);
    // A turn that the live client stored under another ID gets its messages under that ID.
    const liveTurnId = fragment.liveTurnId ?? fragment.turnId;
    const toLiveTurn = (message: ConversationMessage): ConversationMessage =>
      liveTurnId !== fragment.turnId && message.turnId === fragment.turnId
        ? { ...message, turnId: liveTurnId }
        : message;
    let importedCount = 0;
    let afterIndex = -1;
    let complete = false;
    let baseTime: number | undefined;
    while (!complete) {
      const page = yield* providerSync(() =>
        input.database.stagedProviderHistoryItems({
          sessionId: input.sessionId,
          turnId: fragment.turnId,
          afterIndex,
          limit: 50,
        }),
      );
      const last = page.at(-1);
      complete = page.length < 50;
      if (page.length > 0 && (!last || last.itemIndex <= afterIndex)) {
        return yield* Effect.fail(
          providerFailure(new Error("Provider history staging returned a repeated item index.")),
        );
      }
      const turn = {
        id: fragment.turnId,
        ...(fragment.status === undefined ? {} : { status: fragment.status }),
        ...(fragment.startedAt === undefined ? {} : { startedAt: fragment.startedAt }),
      };
      baseTime ??= threadTurnBaseTime(
        turn,
        page.map(({ item }) => item),
        input.findDelivery,
      );
      const partial: ProviderHistoryPartial = {
        turnId: fragment.turnId,
        ...(fragment.status === undefined ? {} : { status: fragment.status }),
        ...(fragment.startedAt === undefined ? {} : { startedAt: fragment.startedAt }),
        itemOffset: page[0]?.itemIndex ?? afterIndex + 1,
        baseTime,
        complete,
        messages: messagesFromThreadItems(
          input.agentId,
          { ...turn, baseTime },
          page.map(({ item }) => item),
          page[0]?.itemIndex ?? afterIndex + 1,
          input.findDelivery,
          input.findMessageDelivery,
        ),
      };
      // The turn completion dropped these answers from the chat, or kept them as quiet answers, so the
      // import does the same.
      const pageMessages = (keep === null ? partial.messages : partial.messages.flatMap(keep)).map(toLiveTurn);
      const reconciled =
        input.provider === "claude"
          ? mergeProviderHistoryMessages(
              // Claude can use a new provider ID for a reply that OpenBot already published under the
              // live turn ID. Read only matching IDs from SQLite, so reconciliation never materializes
              // the full chat or the full turn.
              readStoredTurnMessages(input.database, input.publicThreadId, liveTurnId, pageMessages),
              pageMessages,
              input.provider,
            )
          : [...pageMessages];
      yield* providerSync(() =>
        input.database.importProviderHistoryMessages({
          sessionId: input.sessionId,
          turnId: fragment.turnId,
          agentId: input.agentId,
          threadId: input.publicThreadId,
          messages: reconciled,
          ...(last === undefined ? {} : { throughItemIndex: last.itemIndex }),
          complete,
          compact: input.provider === "codex" || input.provider === "claude",
          detail: {
            provider: input.provider,
            externalSessionId: input.externalSessionId,
            turnId: fragment.turnId,
          },
        }),
      );
      importedCount += reconciled.length;
      if (last) afterIndex = last.itemIndex;
      if (page.length === 0) complete = true;
      yield* Effect.yieldNow;
    }
    return importedCount;
  });
}

/**
 * How a turn that a quiet routine run, a teammate update or an answered request (`quietTeammateTurnDelivery`) started answered: `quiet` when each answer is only the
 * no-update marker, or the agent called the no-update tool or ran only answered teammate requests,
 * and generated no image, so the turn
 * completion kept only its quiet answers; `image` when the agent called the tool
 * and generated an image, so the completion dropped only the text answers; `answered` for any
 * other such turn, and `none` for a turn that no quiet routine run started. A Test run keeps its
 * answers, as the turn completion does. Decided from the staged items alone,
 * one bounded page at a time, so it needs no stored state.
 */
type RoutineTurnAnswers = "none" | "answered" | "image" | "quiet";

function routineTurnAnswers(
  input: ProviderHistoryImportInput,
  turnId: string,
): Effect.Effect<RoutineTurnAnswers, ProviderClientOperationError> {
  return Effect.gen(function* () {
    let routine: boolean | undefined;
    // Only answered teammate requests: the turn completion makes their text answers quiet (#7465).
    let requestsOnly = true;
    let markers = 0;
    let reported = false;
    let noUpdateCalled = false;
    let failureReported = false;
    let imageGenerated = false;
    // A teammate's answer to a quiet routine run is quiet only after a call to the no-update tool.
    let needsNoUpdate = false;
    let afterIndex = -1;
    while (true) {
      const page = yield* providerSync(() =>
        input.database.stagedProviderHistoryItems({ sessionId: input.sessionId, turnId, afterIndex, limit: 50 }),
      );
      for (const { item } of page) {
        // Every delivery of the turn must be a scheduled run or a teammate update, as at the turn
        // completion: a message steered into the turn waits for the answer.
        if (routine !== false && item.type === "userMessage" && typeof item.clientId === "string") {
          const delivery = input.findDelivery(item.clientId)?.delivery;
          // A continuation turn has its own client ID, so the check uses the delivery's ID.
          const continuesQuietRun =
            delivery !== undefined &&
            input.quietTeammateThread === true &&
            input.continuesQuietRun?.(delivery) === true;
          if (continuesQuietRun) needsNoUpdate = true;
          routine =
            delivery !== undefined &&
            ((input.quietTeammateThread === true &&
              quietTeammateTurnDelivery(delivery, (request) => input.requestAnswered?.(request.id) === true)) ||
              (delivery.sender.kind === "routine" && input.quietRoutineDelivery(delivery.id)) ||
              continuesQuietRun);
          requestsOnly &&= delivery !== undefined && teammateRequest(delivery);
          // A completed delivery with an error is a run whose agent reported a failure: never quiet.
          if (delivery?.status === "completed" && delivery.error !== null) failureReported = true;
        }
        if (item.type === "agentMessage" && typeof item.text === "string" && item.text && item.phase !== "commentary") {
          if (isNoUpdateAnswer(item.text)) markers += 1;
          else reported = true;
        }
        if (generatedMediaKind(item)) imageGenerated = true;
        if (isNoUpdateToolCall(item)) noUpdateCalled = true;
      }
      const last = page.at(-1);
      if (routine === false) return "none";
      if (page.length < 50 || !last || last.itemIndex <= afterIndex) break;
      afterIndex = last.itemIndex;
    }
    if (!routine || (needsNoUpdate && !noUpdateCalled)) return "none";
    if (failureReported) return "answered";
    if (noUpdateCalled) return imageGenerated ? "image" : "quiet";
    // A file, an image or a question keeps the turn shown, as at the turn completion.
    if (requestsOnly) return imageGenerated || storedTurnReport(input, turnId) ? "answered" : "quiet";
    return markers > 0 && !reported && !imageGenerated ? "quiet" : "answered";
  });
}

/**
 * Whether the chat holds a file or a question of this turn. OpenBot writes them to the chat itself, so
 * the provider history does not hold them; the import reads the stored messages instead.
 */
function storedTurnReport(input: ProviderHistoryImportInput, turnId: string): boolean {
  const row = input.database.connection
    .prepare(
      `SELECT 1 AS found FROM projection_thread_messages
       WHERE thread_id = ? AND turn_id = ? AND author = 'assistant'
         AND (item_type = 'question_prompt' OR json_array_length(message_json, '$.attachments') > 0)
       LIMIT 1`,
    )
    .get(input.publicThreadId, turnId);
  return row !== undefined;
}

function keptRoutineMessage(routine: Exclude<RoutineTurnAnswers, "none">, provider: AgentProviderId) {
  const narration = quietNarration(provider);
  return (message: ConversationMessage): ConversationMessage[] => {
    if (message.author !== "assistant") return [message];
    if (routine === "quiet") {
      return keptQuietAnswer(message) || narration(message)
        ? [{ ...message, itemType: ROUTINE_QUIET_ANSWER_ITEM_TYPE }]
        : [];
    }
    if (routine === "image") return isTextAnswer(message) ? [] : [message];
    return message.itemType === "commentary" || !isNoUpdateAnswer(message.text) ? [message] : [];
  };
}

function readStoredTurnMessages(
  database: ProviderHistoryImportDatabase,
  threadId: string,
  turnId: string,
  imported: readonly ConversationMessage[],
): ConversationMessage[] {
  /*
   * Claude's live stream publishes narration with IDs that differ from the IDs in its transcript.
   * Read one identity separately so reconciliation can see that the turn already has narration.
   * The query returns one ID only; message JSON is fetched only for this turn's candidate IDs
   * below. Do not query all rows for a turn: a long tool-heavy turn is still a bounded import page,
   * while the projection may contain many old records.
   */
  const identityRows = database.connection
    .prepare(
      `SELECT message_id FROM projection_thread_messages
       WHERE thread_id = ? AND turn_id = ?
         AND substr(message_id, 1, ?) = ?
       LIMIT 1`,
    )
    .all(threadId, turnId, `${turnId}:narration:`.length, `${turnId}:narration:`);
  const identityIds = identityRows.flatMap((row) => {
    const value = databaseRow(row);
    if (!value) return [];
    return [requiredStringColumn(value, "message_id")];
  });
  const ids = [
    ...new Set([
      `${turnId}:assistant`,
      // Live Claude collapses all thinking for a turn under this canonical identity. Provider
      // transcript reasoning keeps its own IDs, so this row is the duplicate check only.
      `${turnId}:reasoning`,
      ...identityIds,
      ...imported.flatMap((message) => (message.id ? [message.id] : [])),
    ]),
  ];
  const placeholders = ids.map(() => "?").join(", ");
  const rows = database.connection
    .prepare(
      `SELECT message_json FROM projection_thread_messages
       WHERE thread_id = ? AND message_id IN (${placeholders})`,
    )
    .all(threadId, ...ids);
  const messages = new Map<string, ConversationMessage>();
  for (const row of rows) {
    const message = decodeStoredMessageRow(row);
    if (message) messages.set(message.id, message);
  }
  return [...messages.values()];
}

function decodeStoredMessageRow(row: unknown): ConversationMessage | null {
  if (!row || typeof row !== "object" || !("message_json" in row) || typeof row.message_json !== "string") return null;
  try {
    return decodeConversationMessageJson(row.message_json);
  } catch {
    return null;
  }
}
