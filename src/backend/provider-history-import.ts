import type { DatabaseSync } from "node:sqlite";
import { type AgentProviderId, type ConversationMessage, ROUTINE_QUIET_ANSWER_ITEM_TYPE } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { generatedMediaKind } from "./agent/image-generation";
import {
  isNoUpdateAnswer,
  isNoUpdateToolCall,
  isTextAnswer,
  keptQuietAnswer,
  quietTeammateDelivery,
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
  };
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
    const consume: ProviderHistoryConsumer = (fragment) =>
      Effect.gen(function* () {
        const staged = yield* providerSync(() =>
          input.database.stageProviderHistoryFragment({ sessionId: input.sessionId, fragment }),
        );
        if (!fragment.complete) return true;
        providerCovered = true;
        // An earlier import committed this turn, and staging found no change since then.
        if (staged.turnImported) return true;
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
    if (providerCovered)
      yield* providerSync(() => input.database.markProviderHistoryImportState(input.sessionId, "complete"));
    return { turns, messages };
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
      const pageMessages =
        routine === "none" ? partial.messages : partial.messages.flatMap(keptRoutineMessage(routine));
      const reconciled =
        input.provider === "claude"
          ? mergeProviderHistoryMessages(
              // Claude can use a new provider ID for a reply that OpenBot already published under the
              // live turn ID. Read only matching IDs from SQLite, so reconciliation never materializes
              // the full chat or the full turn.
              readStoredTurnMessages(input.database, input.publicThreadId, fragment.turnId, pageMessages),
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
 * How a turn that a quiet routine run or a teammate update (`quietTeammateDelivery`) started answered: `quiet` when each answer is only the
 * no-update marker, or the agent called the no-update tool and generated no image, so the turn
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
            ((input.quietTeammateThread === true && quietTeammateDelivery(delivery)) ||
              (delivery.sender.kind === "routine" && input.quietRoutineDelivery(delivery.id)) ||
              continuesQuietRun);
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
    return markers > 0 && !reported && !imageGenerated ? "quiet" : "answered";
  });
}

function keptRoutineMessage(routine: Exclude<RoutineTurnAnswers, "none">) {
  return (message: ConversationMessage): ConversationMessage[] => {
    if (message.author !== "assistant") return [message];
    if (routine === "quiet") {
      return keptQuietAnswer(message) ? [{ ...message, itemType: ROUTINE_QUIET_ANSWER_ITEM_TYPE }] : [];
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
