import type { ConversationMessage, ConversationSnapshot } from "@openbot/contracts/ipc";
import { mergeImageGenerationInfo } from "@openbot/contracts/ipc";
import { type DynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { keptUnsavedImage } from "./conversation-writer";
import { objectValue } from "./database-rows";
import { currentConversationMessage } from "./legacy-conversation-message";

/** The conversation values of one thread event payload, read the way a replay reads them. */
export interface ThreadEventMessages {
  snapshot: ConversationSnapshot | null;
  appendedMessage: ConversationMessage | null;
  streamedMessage: ConversationMessage | null;
  importedMessage: ConversationMessage | null;
  /** One value for each item of the payload's `changedMessages`, null for an item that is not a message. */
  changedEntries: Array<ConversationMessage | null>;
  changedMessages: ConversationMessage[];
  removedMessageIds: string[];
  activeTurnId: unknown;
  hasActiveTurnChange: boolean;
}

/** Which part of the fold an event takes. `none` changes no message and not the latest sequence. */
export type ThreadEventBranch = "snapshot" | "streamed" | "message" | "changes" | "none";

export function threadEventMessages(record: DynamicRecord | null): ThreadEventMessages {
  const changedEntries = Array.isArray(record?.changedMessages)
    ? record.changedMessages.map(currentConversationMessage)
    : [];
  return {
    snapshot: conversationSnapshotValue(objectValue(record?.snapshot)),
    appendedMessage: currentConversationMessage(record?.appendedMessage),
    streamedMessage: currentConversationMessage(record?.streamedMessage),
    importedMessage: currentConversationMessage(record?.importedMessage),
    changedEntries,
    changedMessages: changedEntries.filter((message): message is ConversationMessage => message !== null),
    removedMessageIds: Array.isArray(record?.removedMessageIds) ? record.removedMessageIds.filter(isString) : [],
    activeTurnId: record?.activeTurnId,
    hasActiveTurnChange: record !== null && "activeTurnId" in record,
  };
}

/**
 * The messages and the active turn of one thread, folded from its events in sequence order.
 *
 * The one copy of the message rules of a replay. `ThreadReplay` uses it to rebuild a thread, and
 * `ThreadEventCompaction` uses it to find the parts of an event that a replay does not need. A
 * change here changes what both of them do.
 */
export class ThreadMessageFold {
  readonly #agentId: string;
  readonly #threadId: string;
  #latest: ConversationSnapshot | null = null;
  #latestSequence = 0;

  constructor(agentId: string, threadId: string) {
    this.#agentId = agentId;
    this.#threadId = threadId;
  }

  get latest(): ConversationSnapshot | null {
    return this.#latest;
  }

  get latestSequence(): number {
    return this.#latestSequence;
  }

  branchOf(event: ThreadEventMessages): ThreadEventBranch {
    if (event.snapshot) return "snapshot";
    if (this.#latest && event.streamedMessage) return "streamed";
    if (event.appendedMessage || event.importedMessage) return "message";
    if (event.changedMessages.length > 0 || event.removedMessageIds.length > 0 || event.hasActiveTurnChange) {
      return "changes";
    }
    return "none";
  }

  apply(sequence: number, event: ThreadEventMessages): ThreadEventBranch {
    const branch = this.branchOf(event);
    const { activeTurnId } = event;
    if (branch === "snapshot" && event.snapshot) {
      this.#latest = event.snapshot;
      this.#latestSequence = sequence;
    } else if (branch === "streamed" && this.#latest && event.streamedMessage) {
      // A flush of streamed text carries the message whole, not the delta, so it replaces the
      // one it names. Replacing rather than appending is what makes it safe to lose the earlier
      // flushes of the same run, which both the supersede on write and the prune on the next
      // whole snapshot do.
      const latest = this.#latest;
      const streamedMessage = event.streamedMessage;
      const index = latest.messages.findIndex((message) => message.id === streamedMessage.id);
      if (index >= 0) latest.messages[index] = structuredClone(streamedMessage);
      else latest.messages.push(structuredClone(streamedMessage));
      if (isString(activeTurnId) || activeTurnId === null) latest.activeTurnId = activeTurnId;
      this.#latestSequence = sequence;
    } else if (branch === "message") {
      const latest = this.#ensureLatest();
      const message = event.appendedMessage ?? event.importedMessage;
      if (!message) return branch;
      const index = latest.messages.findIndex((current) => current.id === message.id);
      const previousMessage = latest.messages[index];
      if (previousMessage && event.importedMessage) {
        latest.messages[index] = mergeReplayedMessage(previousMessage, message);
      } else if (index < 0) latest.messages.push(structuredClone(message));
      if (isString(activeTurnId) || activeTurnId === null) latest.activeTurnId = activeTurnId;
      this.#latestSequence = sequence;
    } else if (branch === "changes") {
      const latest = this.#ensureLatest();
      const removed = new Set(event.removedMessageIds);
      const changedById = new Map(event.changedMessages.map((message) => [message.id, message]));
      latest.messages = latest.messages
        .filter((message) => !removed.has(message.id))
        .map((message) => {
          const changed = changedById.get(message.id);
          return changed ? mergeReplayedLiveMessage(message, changed) : message;
        });
      const shown = new Set(latest.messages.map((message) => message.id));
      for (const message of event.changedMessages) {
        if (shown.has(message.id)) continue;
        latest.messages.push(structuredClone(message));
        shown.add(message.id);
      }
      if (isString(activeTurnId) || activeTurnId === null) latest.activeTurnId = activeTurnId;
      this.#latestSequence = sequence;
    }
    return branch;
  }

  #ensureLatest(): ConversationSnapshot {
    this.#latest ??= {
      agentId: this.#agentId,
      threadId: this.#threadId,
      activeTurnId: null,
      revision: 0,
      messages: [],
    };
    return this.#latest;
  }
}

export function conversationSnapshotValue(value: DynamicRecord | null): ConversationSnapshot | null {
  // Snapshots written before the bot-to-agent rename spell the id `botId`, and a database restored from
  // the user's own file copy still carries them however far the migrations have run. Rejecting one here
  // makes `rebuildThreadProjection` throw and the conversation unrecoverable, so both spellings are read.
  const agentId = value?.agentId ?? value?.botId;
  if (
    !value ||
    !isString(agentId) ||
    (!isString(value.threadId) && value.threadId !== null) ||
    (!isString(value.activeTurnId) && value.activeTurnId !== null) ||
    !isNumber(value.revision) ||
    !Array.isArray(value.messages)
  ) {
    return null;
  }
  const messages = value.messages.map(currentConversationMessage).filter((message) => message !== null);
  if (messages.length !== value.messages.length) return null;
  return {
    agentId,
    threadId: value.threadId,
    activeTurnId: value.activeTurnId,
    revision: value.revision,
    messages,
  };
}

function mergeReplayedMessage(existing: ConversationMessage, imported: ConversationMessage): ConversationMessage {
  const attachments = mergeReplayValues(existing.attachments, imported.attachments, (value) => value.id);
  const reactions = mergeReplayValues(existing.reactions, imported.reactions, (value) => JSON.stringify(value));
  const turnId = existing.turnId ?? imported.turnId;
  const imageGeneration = mergeImageGenerationInfo(existing.imageGeneration, imported.imageGeneration);
  return {
    ...existing,
    ...imported,
    id: existing.id,
    author: existing.author,
    createdAt: existing.createdAt,
    ...(turnId === undefined ? {} : { turnId }),
    ...(attachments === undefined ? {} : { attachments }),
    ...(reactions === undefined ? {} : { reactions }),
    ...(imported.delivery === undefined && existing.delivery ? { delivery: existing.delivery } : {}),
    ...(imported.exchange === undefined && existing.exchange ? { exchange: existing.exchange } : {}),
    ...(imported.senderMember === undefined && existing.senderMember ? { senderMember: existing.senderMember } : {}),
    ...(imageGeneration ? { imageGeneration } : {}),
    ...keptUnsavedImage(existing, imported, imageGeneration),
  };
}

export function mergeReplayedLiveMessage(
  existing: ConversationMessage,
  updated: ConversationMessage,
): ConversationMessage {
  const turnId = updated.turnId ?? existing.turnId;
  return {
    ...existing,
    ...updated,
    id: existing.id,
    author: existing.author,
    // Mailbox updates can move a queued message to the time it joined a running turn.
    createdAt: updated.delivery ? updated.createdAt : existing.createdAt,
    ...(turnId === undefined ? {} : { turnId }),
  };
}

function mergeReplayValues<T>(
  existing: T[] | undefined,
  imported: T[] | undefined,
  key: (value: T) => string,
): T[] | undefined {
  if (existing === undefined && imported === undefined) return undefined;
  const values = new Map((existing ?? []).map((value) => [key(value), value]));
  for (const value of imported ?? []) values.set(key(value), value);
  return [...values.values()];
}
