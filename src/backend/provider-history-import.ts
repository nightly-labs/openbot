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
  quietRoutineDelivery(deliveryId: string): boolean;
  quietTeammateThread?: boolean;
  continuesQuietRun?(delivery: DeliveryContext["delivery"]): boolean;
  requestAnswered?(deliveryId: string): boolean;
}

export interface ProviderHistoryImportResult {
  turns: number;
  messages: number;
}

interface ProviderHistoryPartial {
  turnId: string;
  status?: string;
  startedAt?: number;
  itemOffset: number;
  baseTime?: number;
  complete: boolean;
  messages: readonly ConversationMessage[];
}

export function importProviderHistory(
  input: ProviderHistoryImportInput,
): Effect.Effect<ProviderHistoryImportResult, ProviderClientOperationError> {
  return Effect.gen(function* () {
    const current = yield* providerSync(() =>
      input.database.ensureProviderHistoryImport({
        sessionId: input.sessionId,
        threadId: input.publicThreadId,
        provider: input.provider,
        externalSessionId: input.externalSessionId,
      }),
    );
    const resumeKey = yield* providerSync(() => importResumeKey(input, current));
    let turns = 0;
    let messages = 0;
    let providerCovered = false;
    let turnWaits = false;
    const seenTurns = new Set<string>();
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
        if (staged.turnImported) return true;
        if (staged.compactedItems) {
          if (!rewrittenTurns.has(fragment.turnId)) {
            turnWaits = true;
            return true;
          }
          yield* providerSync(() => input.database.dropCompactedProviderHistoryItems(input.sessionId, fragment.turnId));
        }
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
    if (providerCovered || current.state === "complete")
      yield* providerSync(() =>
        input.database.markProviderHistoryImportState(input.sessionId, turnWaits ? "active" : "complete"),
      );
    return { turns, messages };
  });
}

export function retiredSessionNeedsHistoryRead(
  imported: { state: string; updatedAt: string } | null,
  retiredAt: string,
): boolean {
  return imported?.state !== "complete" || imported.updatedAt < retiredAt;
}

const COMPACTION_PAUSE = Duration.millis(5);

export interface ProviderHistoryCompactionResult {
  rows: number;
  bytes: number;
  batches: number;
}

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
    const routine =
      fragment.status === undefined || fragment.status === "completed"
        ? yield* routineTurnAnswers(input, fragment.turnId)
        : "none";
    const keep = routine === "none" ? null : keptRoutineMessage(routine, input.provider);
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
      const pageMessages = (keep === null ? partial.messages : partial.messages.flatMap(keep)).map(toLiveTurn);
      const reconciled =
        input.provider === "claude"
          ? mergeProviderHistoryMessages(
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

type RoutineTurnAnswers = "none" | "answered" | "image" | "quiet";

function routineTurnAnswers(
  input: ProviderHistoryImportInput,
  turnId: string,
): Effect.Effect<RoutineTurnAnswers, ProviderClientOperationError> {
  return Effect.gen(function* () {
    let routine: boolean | undefined;
    let requestsOnly = true;
    let markers = 0;
    let reported = false;
    let noUpdateCalled = false;
    let failureReported = false;
    let imageGenerated = false;
    let needsNoUpdate = false;
    let afterIndex = -1;
    while (true) {
      const page = yield* providerSync(() =>
        input.database.stagedProviderHistoryItems({ sessionId: input.sessionId, turnId, afterIndex, limit: 50 }),
      );
      for (const { item } of page) {
        if (routine !== false && item.type === "userMessage" && typeof item.clientId === "string") {
          const delivery = input.findDelivery(item.clientId)?.delivery;
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
    if (requestsOnly) return imageGenerated || reported || storedTurnReport(input, turnId) ? "answered" : "quiet";
    return markers > 0 && !reported && !imageGenerated ? "quiet" : "answered";
  });
}

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
