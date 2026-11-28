import type { AttachmentSummary, ConversationMessage } from "@openbot/contracts/ipc";
import { parseRoutineRunConversationEventItemType, routineRunConversationEventItemType } from "@openbot/contracts/ipc";
import { Effect, Schema } from "effect";
import type { AgentThreadRecord, AgentThreadStore } from "./agent-threads/agent-thread-store";
import { copyBranchMessages } from "./agent-threads/agent-thread-store";
import { databaseRows, decodeConversationMessageJson, requiredStringColumn } from "./database/database-rows";
import type { MailboxStore } from "./mailbox-store";
import type { OpenBotDatabase } from "./openbot-database";

export const HISTORY_IMPORTED_EVENT = "thread.history-imported";
const IMPORT_BATCH = 200;

export interface HistoryThread {
  main: boolean;
  title: string;
  titleSource: "auto" | "agent" | "user";
  origin: "user" | "agent";
  archived: boolean;
  routineId: string | null;
  messages: ConversationMessage[];
  preview?: string;
}

export interface HistoryFile {
  path: string;
  name: string;
  mimeType: string;
}

export interface ImportHistoryThreadInput {
  agentId: string;
  thread: HistoryThread;
  files: ReadonlyMap<string, HistoryFile>;
  agentIds: ReadonlyMap<string, string>;
  routineIds: ReadonlyMap<string, string>;
  runIds: ReadonlyMap<string, string>;
}

export class AgentHistoryTransferFailed extends Schema.TaggedError<AgentHistoryTransferFailed>()(
  "AgentHistoryTransferFailed",
  { cause: Schema.Defect() },
) {}

export interface AgentHistoryTransferOptions {
  database: OpenBotDatabase;
  threads: AgentThreadStore;
  mailbox: Pick<
    MailboxStore,
    "resolveAttachment" | "stageGeneratedCopy" | "persistGeneratedAttachmentsWith" | "discardStagedGeneratedAttachments"
  >;
  mainThread(agentId: string): string;
  registerTaskThread(agentId: string, threadId: string): void;
}

export class AgentHistoryTransfer {
  readonly #options: AgentHistoryTransferOptions;

  constructor(options: AgentHistoryTransferOptions) {
    this.#options = options;
  }

  readThreads(agentId: string, mainThreadId: string | null): HistoryThread[] {
    const threads: HistoryThread[] = [];
    if (mainThreadId) {
      const messages = this.#messages(mainThreadId);
      if (messages.length > 0)
        threads.push({
          main: true,
          title: "",
          titleSource: "auto",
          origin: "user",
          archived: false,
          routineId: null,
          messages,
        });
    }
    for (const record of this.#options.threads.list(agentId)) {
      const messages = this.#messages(record.threadId);
      if (messages.length === 0) continue;
      threads.push(sideThread(record, messages));
    }
    return threads;
  }

  readonly resolveFile = Effect.fn("AgentHistoryTransfer.resolveFile")(function* (
    this: AgentHistoryTransfer,
    attachmentId: string,
  ) {
    return yield* this.#options.mailbox
      .resolveAttachment(attachmentId)
      .pipe(Effect.mapError((failure) => new AgentHistoryTransferFailed({ cause: failure.cause })));
  });

  readonly importThread = Effect.fn("AgentHistoryTransfer.importThread")(function* (
    this: AgentHistoryTransfer,
    input: ImportHistoryThreadInput,
  ) {
    const { agentId, thread } = input;
    const options = this.#options;
    const threadId = yield* step(() => {
      if (thread.main) return options.mainThread(agentId);
      const routineId = thread.routineId ? input.routineIds.get(thread.routineId) : undefined;
      const record = options.threads.create({
        agentId,
        origin: thread.origin,
        title: thread.title,
        titleSource: thread.titleSource === "user" ? "agent" : thread.titleSource,
        ...(routineId ? { routineId } : {}),
      });
      if (thread.titleSource === "user") options.threads.rename(record.threadId, thread.title);
      if (thread.archived) options.threads.close(record.taskId);
      options.registerTaskThread(agentId, record.threadId);
      return record.threadId;
    });
    const messages = importedMessages(thread.messages, input.agentIds, input.routineIds, input.runIds);
    for (let start = 0; start < messages.length; start += IMPORT_BATCH) {
      const batch = messages.slice(start, start + IMPORT_BATCH);
      const staged: string[] = [];
      yield* Effect.gen(function* () {
        const copies = new Map<string, AttachmentSummary>();
        for (const attachment of batch.flatMap(messageFiles)) {
          const file = input.files.get(attachment.id);
          if (!file || copies.has(attachment.id)) continue;
          const copy = yield* options.mailbox
            .stageGeneratedCopy({ ...file, sourcePath: file.path, ownerAgentId: agentId, ownerThreadId: threadId })
            .pipe(Effect.mapError((failure) => new AgentHistoryTransferFailed({ cause: failure.cause })));
          staged.push(copy.id);
          copies.set(attachment.id, copy);
        }
        const changedMessages = batch.map((message) => withFiles(message, copies));
        yield* step(() =>
          options.mailbox.persistGeneratedAttachmentsWith(staged, "attachment.history-imported", () =>
            options.database.persistConversationChanges({
              agentId,
              threadId,
              activeTurnId: null,
              changedMessages,
              eventType: HISTORY_IMPORTED_EVENT,
              keepMessageTimes: true,
            }),
          ),
        );
      }).pipe(Effect.onError(() => options.mailbox.discardStagedGeneratedAttachments(staged).pipe(Effect.ignore)));
    }
    return { threadId, lastMessageId: messages.at(-1)?.id ?? null };
  });

  #messages(threadId: string): ConversationMessage[] {
    const rows = databaseRows(
      this.#options.database.connection
        .prepare("SELECT message_json FROM projection_thread_messages WHERE thread_id = ? ORDER BY ordinal, message_id")
        .all(threadId),
    );
    return rows.map((row) => decodeConversationMessageJson(requiredStringColumn(row, "message_json")));
  }
}

function sideThread(record: AgentThreadRecord, messages: ConversationMessage[]): HistoryThread {
  return {
    main: false,
    title: record.title,
    titleSource: record.titleSource,
    origin: record.origin,
    archived: record.closedAt !== null,
    routineId: record.routineId,
    messages,
  };
}

function importedMessages(
  messages: readonly ConversationMessage[],
  agentIds: ReadonlyMap<string, string>,
  routineIds: ReadonlyMap<string, string>,
  runIds: ReadonlyMap<string, string>,
): ConversationMessage[] {
  return copyBranchMessages(messages, new Map()).map((message) => {
    const { exchange: _exchange, senderAgentId, ...copy } = withRoutineCopies(message, routineIds, runIds);
    const sender = senderAgentId ? agentIds.get(senderAgentId) : undefined;
    return {
      ...copy,
      status: copy.status === "streaming" ? "interrupted" : copy.status,
      ...(sender ? { senderAgentId: sender } : {}),
    };
  });
}

export function withRoutineCopies(
  message: ConversationMessage,
  routineIds: ReadonlyMap<string, string>,
  runIds: ReadonlyMap<string, string>,
): ConversationMessage {
  const { routine, ...rest } = message;
  const routineId = routine ? routineIds.get(routine.routineId) : undefined;
  const event = parseRoutineRunConversationEventItemType(message.itemType);
  const eventRoutine = event ? routineIds.get(event.routineId) : undefined;
  return {
    ...rest,
    ...(routine && routineId
      ? { routine: { ...routine, routineId, runId: runIds.get(routine.runId) ?? routine.runId } }
      : {}),
    ...(event && eventRoutine
      ? {
          itemType: routineRunConversationEventItemType(
            event.status,
            eventRoutine,
            runIds.get(event.runId) ?? event.runId,
          ),
        }
      : {}),
  };
}

export function messageFiles(message: ConversationMessage): AttachmentSummary[] {
  return [...(message.attachments ?? []), ...(message.voiceRecording ? [message.voiceRecording] : [])];
}

function withFiles(message: ConversationMessage, copies: ReadonlyMap<string, AttachmentSummary>): ConversationMessage {
  if (copies.size === 0) return message;
  const file = (attachment: AttachmentSummary) => copies.get(attachment.id) ?? attachment;
  return {
    ...message,
    ...(message.attachments ? { attachments: message.attachments.map(file) } : {}),
    ...(message.voiceRecording ? { voiceRecording: file(message.voiceRecording) } : {}),
  };
}

function step<T>(run: () => T): Effect.Effect<T, AgentHistoryTransferFailed> {
  return Effect.try({ try: run, catch: (cause) => new AgentHistoryTransferFailed({ cause }) });
}
