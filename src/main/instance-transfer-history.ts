// The chats of the agents in an instance transfer file, when the user includes the chat history.
// Each agent has `agents/<key>/history/index.json`, which lists its chats and the files of their
// messages. The messages of a chat are in JSON parts of at most `PART_MESSAGES` messages, and each
// file is one entry, so the import never holds a whole long chat or all files in memory at once.
//
// An agent id in a message is written as the agent's key in the file, and a routine id stays the
// routine's key, so the import links each one to the copy that it made. A link to an agent or a
// routine that is not in the file goes.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  type AttachmentSummary,
  type Channel,
  type ChannelMessage,
  type ConversationMessage,
  isChannelMessage,
  isConversationMessage,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result } from "effect";
import type {
  AgentHistoryTransferFailed,
  HistoryFile,
  HistoryThread,
  ImportHistoryThreadInput,
} from "../backend/agent-history-transfer";
import { messageFiles, withRoutineCopies } from "../backend/agent-history-transfer";
import type { MailboxStore } from "../backend/mailbox-store";
import { type ArchiveFile, extractEntryEffect, readEntriesEffect, withArchive } from "./agent-archive";
import { type ArchiveOperationError, archiveCall, archiveFailure } from "./archive-effects";

/** Messages in one part. */
const PART_MESSAGES = 200;
/** The largest part or index the import reads. A message carries at most its text and trace. */
const PART_MAX_BYTES = 64 * 1024 * 1024;
const TITLE_SOURCES = ["auto", "agent", "user"] as const;
const ORIGINS = ["user", "agent"] as const;

/** The agent operations that read and write chats, as `AgentService` offers them. */
export interface TransferHistoryAgents {
  readTransferHistory(agentId: string): HistoryThread[];
  resolveTransferFile(
    attachmentId: string,
  ): Effect.Effect<{ path: string; mimeType: string; name: string } | null, AgentHistoryTransferFailed>;
  importTransferHistory(
    input: ImportHistoryThreadInput,
    readerId: string,
  ): Effect.Effect<void, AgentHistoryTransferFailed>;
}

/** An entry the export writes. */
export interface HistoryEntry {
  name: string;
  read: () => Promise<Uint8Array>;
}

interface IndexThread {
  main: boolean;
  title: string;
  titleSource: HistoryThread["titleSource"];
  origin: HistoryThread["origin"];
  archived: boolean;
  routineKey: string | null;
  parts: string[];
  preview?: string;
}

interface IndexFile {
  id: string;
  path: string;
  name: string;
  mimeType: string;
}

/**
 * Adds the agent's chats to the export. Returns the archive path of the index, or null when the agent
 * has no chat, with the bytes of the files it adds.
 */
export const exportHistory = Effect.fn("InstanceTransfer.exportHistory")(function* (
  agents: TransferHistoryAgents,
  agentId: string,
  prefix: string,
  agentKeys: ReadonlyMap<string, string>,
  entries: HistoryEntry[],
): Effect.fn.Return<{ index: string | null; bytes: number }, ArchiveOperationError> {
  const threads = agents.readTransferHistory(agentId);
  if (threads.length === 0) return { index: null, bytes: 0 };
  const folder = `${prefix}history`;
  const files: IndexFile[] = [];
  const fileIds = new Set<string>();
  const indexThreads: IndexThread[] = [];
  let bytes = 0;
  for (const [threadIndex, thread] of threads.entries()) {
    const messages = thread.messages.map((message) => exportedMessage(message, agentKeys));
    bytes += yield* addMessageFiles(
      (id) => agents.resolveTransferFile(id),
      messages,
      `${folder}/files/`,
      files,
      fileIds,
      entries,
    );
    const parts: string[] = [];
    for (let start = 0; start < messages.length; start += PART_MESSAGES) {
      const name = `${folder}/chat-${threadIndex + 1}-${parts.length + 1}.json`;
      const part = jsonPart(messages.slice(start, start + PART_MESSAGES));
      bytes += part.bytes;
      parts.push(name);
      entries.push({ name, read: part.read });
    }
    indexThreads.push({
      main: thread.main,
      title: thread.title,
      titleSource: thread.titleSource,
      origin: thread.origin,
      archived: thread.archived,
      routineKey: thread.routineId,
      parts,
      ...(thread.preview ? { preview: thread.preview } : {}),
    });
  }
  const index = `${folder}/index.json`;
  const data = new TextEncoder().encode(JSON.stringify({ threads: indexThreads, files }));
  entries.push({ name: index, read: () => Promise.resolve(data) });
  return { index, bytes: bytes + data.byteLength };
});

/** The message as the file keeps it: no queue state, and an agent named by its key in the file. */
function exportedMessage(message: ConversationMessage, agentKeys: ReadonlyMap<string, string>): ConversationMessage {
  const { delivery: _delivery, reaction: _reaction, reactions: _reactions, senderAgentId, ...rest } = message;
  const sender = senderAgentId ? agentKeys.get(senderAgentId) : undefined;
  return { ...rest, ...(sender ? { senderAgentId: sender } : {}) };
}

/**
 * Writes the chats of one imported agent. A chat that fails is a warning, and the others go on.
 * The files are copied out of the archive to `scratch`, which this removes at the end.
 */
export const importHistory = Effect.fn("InstanceTransfer.importHistory")(function* (
  archive: ArchiveFile,
  agents: TransferHistoryAgents,
  input: {
    index: string;
    agentId: string;
    agentName: string;
    prefix: string;
    agentIds: ReadonlyMap<string, string>;
    routineIds: ReadonlyMap<string, string>;
    runIds: ReadonlyMap<string, string>;
    scratch: string;
    readerId: string;
  },
  warnings: string[],
) {
  const folder = `${input.prefix}history/`;
  const index = decodeIndex((yield* readEntriesEffect(archive, [input.index], PART_MAX_BYTES))[input.index], folder);
  if (!index) {
    warnings.push(sourceText("error.import.transferHistorySkipped", { name: input.agentName }));
    return;
  }
  const directory = join(input.scratch, randomUUID());
  yield* Effect.acquireUseRelease(
    archiveCall(() => mkdir(directory, { recursive: true, mode: 0o700 })),
    () =>
      Effect.gen(function* () {
        const files = yield* extractMessageFiles(archive, index.files, directory);
        let failed = 0;
        for (const thread of index.threads) {
          const result = yield* Effect.result(
            Effect.gen(function* () {
              const messages: ConversationMessage[] = [];
              for (const part of thread.parts) {
                const bytes = (yield* readEntriesEffect(archive, [part], PART_MAX_BYTES))[part];
                messages.push(...decodePart(bytes));
              }
              if (messages.length === 0) return;
              yield* agents
                .importTransferHistory(
                  {
                    agentId: input.agentId,
                    thread: { ...thread, routineId: thread.routineKey, messages },
                    files,
                    agentIds: input.agentIds,
                    routineIds: input.routineIds,
                    runIds: input.runIds,
                  },
                  input.readerId,
                )
                .pipe(Effect.mapError((failure) => archiveFailure(failure.cause)));
            }),
          );
          if (Result.isFailure(result)) failed += 1;
        }
        if (failed > 0)
          warnings.push(sourceText("error.import.transferChatsSkipped", { name: input.agentName, count: failed }));
      }),
    () => archiveCall(() => rm(directory, { recursive: true, force: true })).pipe(Effect.ignore),
  );
});

/**
 * Adds the files of `messages` that `files` does not list yet, each as `<folder><n>`, and returns
 * their bytes. A file that is gone keeps its card, as in a branch. Chats and channel messages share it.
 */
const addMessageFiles = Effect.fn("InstanceTransfer.addMessageFiles")(function* (
  resolveFile: TransferHistoryAgents["resolveTransferFile"],
  messages: readonly ConversationMessage[],
  folder: string,
  files: IndexFile[],
  fileIds: Set<string>,
  entries: HistoryEntry[],
): Effect.fn.Return<number> {
  let bytes = 0;
  for (const attachment of messages.flatMap(messageFiles)) {
    if (fileIds.has(attachment.id)) continue;
    fileIds.add(attachment.id);
    const file = yield* resolveFile(attachment.id).pipe(Effect.orElseSucceed(() => null));
    if (!file) continue;
    const path = `${folder}${files.length + 1}`;
    files.push({ id: attachment.id, path, name: file.name, mimeType: file.mimeType });
    bytes += attachment.size;
    entries.push({ name: path, read: () => readFile(file.path) });
  }
  return bytes;
});

/** Copies the listed files out of the archive into `directory`, by their ids. A file that fails is left out. */
const extractMessageFiles = Effect.fn("InstanceTransfer.extractMessageFiles")(function* (
  archive: ArchiveFile,
  files: readonly IndexFile[],
  directory: string,
): Effect.fn.Return<Map<string, HistoryFile>, ArchiveOperationError> {
  const extracted = new Map<string, HistoryFile>();
  yield* withArchive(archive.path, (handle) =>
    Effect.gen(function* () {
      for (const [number, file] of files.entries()) {
        const entry = archive.entries.get(file.path);
        if (!entry) continue;
        const target = join(directory, String(number + 1));
        const written = yield* Effect.result(extractEntryEffect(handle, entry, target, 0o600));
        if (Result.isSuccess(written))
          extracted.set(file.id, { path: target, name: file.name, mimeType: file.mimeType });
      }
    }),
  );
  return extracted;
});

function decodeIndex(
  bytes: Uint8Array | undefined,
  folder: string,
): { threads: IndexThread[]; files: IndexFile[] } | null {
  return parsed(bytes, (value) => decodeIndexValue(value, folder), null);
}

function decodeIndexValue(value: unknown, folder: string): { threads: IndexThread[]; files: IndexFile[] } | null {
  if (!isDynamicRecord(value) || !Array.isArray(value.threads) || !Array.isArray(value.files)) return null;
  const inFolder = (path: unknown): path is string =>
    typeof path === "string" && path.startsWith(folder) && !path.includes("..");
  const threads = value.threads.flatMap((item): IndexThread[] => {
    if (!isDynamicRecord(item) || !Array.isArray(item.parts) || !item.parts.every(inFolder)) return [];
    const titleSource = TITLE_SOURCES.find((known) => known === item.titleSource) ?? "agent";
    const origin = ORIGINS.find((known) => known === item.origin) ?? "user";
    return [
      {
        main: item.main === true,
        title:
          typeof item.title === "string" && item.title.trim()
            ? item.title.slice(0, 200)
            : sourceText("status.agent.importedChatTitle"),
        titleSource,
        origin,
        archived: item.archived === true,
        routineKey: typeof item.routineKey === "string" ? item.routineKey : null,
        parts: item.parts,
        ...(item.main === true && typeof item.preview === "string" ? { preview: item.preview } : {}),
      },
    ];
  });
  const files = value.files.flatMap((item): IndexFile[] =>
    isDynamicRecord(item) &&
    typeof item.id === "string" &&
    inFolder(item.path) &&
    typeof item.name === "string" &&
    typeof item.mimeType === "string"
      ? [{ id: item.id, path: item.path, name: item.name.slice(0, 255), mimeType: item.mimeType.slice(0, 255) }]
      : [],
  );
  // One own chat at most: a second one would mix two chats.
  const main = threads.findIndex((thread) => thread.main);
  return { threads: threads.filter((thread, number) => !thread.main || number === main), files };
}

/** The valid messages of a part. An invalid one is left out. */
function decodePart(bytes: Uint8Array | undefined): ConversationMessage[] {
  return parsed(bytes, (value) => (Array.isArray(value) ? value.filter(isConversationMessage) : []), []);
}

/** The JSON of an entry through `decode`, or `fallback` when the entry is not JSON. */
function parsed<T>(bytes: Uint8Array | undefined, decode: (value: unknown) => T, fallback: T): T {
  if (!bytes) return fallback;
  try {
    return decode(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } catch {
    return fallback;
  }
}

/** The channel operations that read and write channel messages, as `ChannelService` offers them. */
export interface TransferChannelHistory {
  store: {
    get(channelId: string): Channel;
    messages(channelId: string, before?: number, limit?: number): ChannelMessage[];
    update(channel: Channel, changes: { messages: ChannelMessage[] }, operationId?: string): Channel;
    /** The thread of one agent in the channel. The files of imported messages belong to it. */
    context(channelId: string, agentId: string): { threadId: string };
  };
  /** Stores the files of imported messages, as the chat import does. */
  mailbox: Pick<
    MailboxStore,
    "stageGeneratedCopy" | "persistGeneratedAttachmentsWith" | "discardStagedGeneratedAttachments"
  >;
}

/** The files of a channel's messages in the file, as the manifest lists them. */
export type ChannelFile = IndexFile;

/** What `importChannelMessages` writes. */
interface ImportChannelInput {
  channelId: string;
  parts: readonly string[];
  files: readonly ChannelFile[];
  prefix: string;
  agentIds: ReadonlyMap<string, string>;
  routineIds: ReadonlyMap<string, string>;
  runIds: ReadonlyMap<string, string>;
  exporter: string | null;
  actor: { id: string; name: string };
  /** An imported agent of the channel, which keeps the files of the people's messages. */
  fileOwner: string | null;
  scratch: string;
}

/**
 * Adds a channel's shown messages to the export, as JSON parts, with the files of the messages in
 * `<prefix>files/`. An agent author is written as its key in the file. A file that is gone keeps its
 * card, as in a chat.
 */
export const exportChannelMessages = Effect.fn("InstanceTransfer.exportChannelMessages")(function* (
  channels: TransferChannelHistory,
  resolveFile: TransferHistoryAgents["resolveTransferFile"],
  channelId: string,
  prefix: string,
  agentKeys: ReadonlyMap<string, string>,
  entries: HistoryEntry[],
): Effect.fn.Return<{ parts: string[]; files: ChannelFile[]; bytes: number }> {
  const messages = channels.store.messages(channelId).flatMap((entry): ChannelMessage[] => {
    if (entry.author.kind === "agent") {
      const key = agentKeys.get(entry.author.id);
      if (!key) return [];
      entry = { ...entry, author: { ...entry.author, id: key } };
    }
    return [{ ...entry, taskId: null, message: exportedMessage(entry.message, agentKeys) }];
  });
  const files: ChannelFile[] = [];
  const fileIds = new Set<string>();
  let bytes = 0;
  bytes += yield* addMessageFiles(
    resolveFile,
    messages.map((entry) => entry.message),
    `${prefix}files/`,
    files,
    fileIds,
    entries,
  );
  const parts: string[] = [];
  for (let start = 0; start < messages.length; start += PART_MESSAGES) {
    const name = `${prefix}messages-${parts.length + 1}.json`;
    const part = jsonPart(messages.slice(start, start + PART_MESSAGES));
    bytes += part.bytes;
    parts.push(name);
    entries.push({ name, read: part.read });
  }
  return { parts, files, bytes };
});

/**
 * One JSON part of the file. The size is counted now, and the bytes are made again when the archive
 * writes the part, so the export does not keep the encoded history of every chat in memory.
 */
function jsonPart(value: readonly unknown[]): { bytes: number; read: HistoryEntry["read"] } {
  return {
    bytes: Buffer.byteLength(JSON.stringify(value)),
    read: () => Promise.resolve(new TextEncoder().encode(JSON.stringify(value))),
  };
}

/**
 * Writes the messages of an imported channel in batches of one part. Each message gets a new id and
 * no task. An agent author points to its copy, and a message of an agent that the user did not import
 * is left out. The person who exported is the person who imports.
 *
 * The files of the messages are copied out of the archive to `scratch`, which this removes at the
 * end, and saved with each batch as files of an agent's thread in the channel: the author's, or for a
 * person's message the thread of `fileOwner`. Deleting the channel removes them with that thread.
 */
export const importChannelMessages = Effect.fn("InstanceTransfer.importChannelMessages")(function* (
  archive: ArchiveFile,
  channels: TransferChannelHistory,
  input: ImportChannelInput,
): Effect.fn.Return<void, ArchiveOperationError> {
  const directory = join(input.scratch, randomUUID());
  yield* Effect.acquireUseRelease(
    archiveCall(() => mkdir(directory, { recursive: true, mode: 0o700 })),
    () => importChannelParts(archive, channels, input, directory),
    () => archiveCall(() => rm(directory, { recursive: true, force: true })).pipe(Effect.ignore),
  );
});

const importChannelParts = Effect.fn("InstanceTransfer.importChannelParts")(function* (
  archive: ArchiveFile,
  channels: TransferChannelHistory,
  input: ImportChannelInput,
  directory: string,
): Effect.fn.Return<void, ArchiveOperationError> {
  const files = yield* extractMessageFiles(
    archive,
    input.files.filter((file) => file.path.startsWith(input.prefix)),
    directory,
  );
  const threads = new Map<string, string>();
  const threadOf = (agentId: string) => {
    let threadId = threads.get(agentId);
    if (!threadId) {
      threadId = channels.store.context(input.channelId, agentId).threadId;
      threads.set(agentId, threadId);
    }
    return threadId;
  };
  const ids = new Map<string, string>();
  for (const part of input.parts) {
    if (!part.startsWith(input.prefix) || part.includes("..")) continue;
    const bytes = (yield* readEntriesEffect(archive, [part], PART_MAX_BYTES))[part];
    const batch = parsed(bytes, (value) => (Array.isArray(value) ? value.filter(isChannelMessage) : []), []).flatMap(
      (entry): ChannelMessage[] => {
        let author = entry.author;
        if (author.kind === "agent") {
          const agentId = input.agentIds.get(author.id);
          if (!agentId) return [];
          author = { ...author, id: agentId };
        } else if (author.kind === "member" && author.id === input.exporter)
          author = { kind: "member", ...input.actor };
        const id = randomUUID();
        ids.set(entry.id, id);
        const {
          delivery: _delivery,
          reaction: _reaction,
          reactions: _reactions,
          exchange: _exchange,
          ...message
        } = entry.message;
        const senderAgentId = message.senderAgentId ? input.agentIds.get(message.senderAgentId) : undefined;
        const replyTo = message.replyToMessageId ? ids.get(message.replyToMessageId) : undefined;
        // A routine and a run point to their copies here.
        const {
          senderAgentId: _sender,
          replyToMessageId: _reply,
          ...rest
        } = withRoutineCopies(message, input.routineIds, input.runIds);
        return [
          {
            id,
            channelId: input.channelId,
            sequence: 0,
            author,
            taskId: null,
            superseded: entry.superseded,
            message: {
              ...rest,
              id,
              status: rest.status === "streaming" ? "interrupted" : rest.status,
              ...(senderAgentId ? { senderAgentId } : {}),
              ...(replyTo ? { replyToMessageId: replyTo } : {}),
            },
          },
        ];
      },
    );
    if (batch.length === 0) continue;
    const staged: string[] = [];
    yield* Effect.gen(function* () {
      const copies = new Map<string, AttachmentSummary>();
      for (const entry of batch) {
        const owner = entry.author.kind === "agent" ? entry.author.id : input.fileOwner;
        if (!owner) continue;
        for (const attachment of messageFiles(entry.message)) {
          const file = files.get(attachment.id);
          if (!file || copies.has(attachment.id)) continue;
          const copy = yield* channels.mailbox
            .stageGeneratedCopy({ ...file, sourcePath: file.path, ownerAgentId: owner, ownerThreadId: threadOf(owner) })
            .pipe(Effect.mapError((failure) => archiveFailure(failure.cause)));
          staged.push(copy.id);
          copies.set(attachment.id, copy);
        }
      }
      const written = batch.map((entry) => ({ ...entry, message: withMessageFiles(entry.message, copies) }));
      yield* archiveCall(async () => {
        channels.mailbox.persistGeneratedAttachmentsWith(staged, "attachment.history-imported", () =>
          channels.store.update(channels.store.get(input.channelId), { messages: written }),
        );
      });
    }).pipe(Effect.onError(() => channels.mailbox.discardStagedGeneratedAttachments(staged).pipe(Effect.ignore)));
  }
});

/** The message with each file that has a copy here pointing to the copy. A file with none keeps its card. */
function withMessageFiles(
  message: ConversationMessage,
  copies: ReadonlyMap<string, AttachmentSummary>,
): ConversationMessage {
  if (copies.size === 0) return message;
  const file = (attachment: AttachmentSummary) => copies.get(attachment.id) ?? attachment;
  return {
    ...message,
    ...(message.attachments ? { attachments: message.attachments.map(file) } : {}),
    ...(message.voiceRecording ? { voiceRecording: file(message.voiceRecording) } : {}),
  };
}

/** The checked file list of a channel in the manifest: each path inside the channel's folder. */
export function decodeChannelFiles(value: unknown, prefix: string): ChannelFile[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ChannelFile[] =>
    isDynamicRecord(item) &&
    typeof item.id === "string" &&
    typeof item.path === "string" &&
    item.path.startsWith(`${prefix}files/`) &&
    !item.path.includes("..") &&
    typeof item.name === "string" &&
    typeof item.mimeType === "string"
      ? [{ id: item.id, path: item.path, name: item.name.slice(0, 255), mimeType: item.mimeType.slice(0, 255) }]
      : [],
  );
}
