import type { AgentEvent, ConversationSnapshot } from "@openbot/contracts/ipc";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import type { OpenBotDatabase, StreamingMessageWrite } from "../openbot-database";
import type { ConversationRuntime } from "./conversation-runtime";

const logger = createOpenBotLogger("delta-buffer");

// SQLite primary result codes after which a later write can work: SQLITE_BUSY, SQLITE_LOCKED,
// SQLITE_IOERR and SQLITE_FULL. `node:sqlite` reports extended codes, whose low byte is the primary one.
const STORAGE_FAILURE_CODES = new Set([5, 6, 10, 13]);

function isStorageFailure(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "ERR_SQLITE_ERROR") return false;
  return "errcode" in error && typeof error.errcode === "number" && STORAGE_FAILURE_CODES.has(error.errcode & 0xff);
}

export interface PendingDeltaInput {
  agentId: string;
  externalThreadId: string;
  publicThreadId: string;
  turnId: string;
  messageId: string;
  text: string;
  createdAt: string;
}

interface BufferedDelta extends PendingDeltaInput {
  /**
   * The UTF-8 size of `text`, added up for each delta, so the size cap does not measure the whole
   * text again on each one. A character split between two deltas counts as two, so it can be a few bytes high.
   */
  bytes: number;
  /** The last save failed. The size cap then waits for the timer, so a failing disk gets one write per 100 ms. */
  retrying?: boolean;
}

export interface DeltaBufferHooks {
  emit(event: AgentEvent): void;
}

export interface DeltaBufferOptions {
  conversation: ConversationRuntime;
  database: OpenBotDatabase;
  hooks: DeltaBufferHooks;
}

/**
 * Coalesces `item/agentMessage/delta` notifications into `conversation-delta`
 * events. Deltas accumulate per message and flush at most 100 ms after the
 * first one, at an 8 KiB cap, at item completion, or at turn completion —
 * whichever comes first. All messages that wait for the 100 ms tick are saved
 * in one transaction.
 *
 * Owns the pending map and its timers. Persistence goes through the database,
 * snapshots through the conversation runtime, delivery through `emit`; the
 * class never imports the facade.
 */
export class DeltaBuffer {
  readonly #conversation: ConversationRuntime;
  readonly #database: OpenBotDatabase;
  readonly #hooks: DeltaBufferHooks;
  readonly #pending = new Map<string, BufferedDelta>();
  /** One timer for all waiting messages: with many agents, one timer for each message made one commit for each. */
  #tick: NodeJS.Timeout | null = null;
  /** A save failed and no save worked since, so later failures are not logged again. */
  #saveFailing = false;

  constructor(options: DeltaBufferOptions) {
    this.#conversation = options.conversation;
    this.#database = options.database;
    this.#hooks = options.hooks;
  }

  buffer(delta: PendingDeltaInput): void {
    const key = `${delta.externalThreadId}:${delta.turnId}:${delta.messageId}`;
    const existing = this.#pending.get(key);
    if (existing) {
      existing.text += delta.text;
      existing.bytes += Buffer.byteLength(delta.text, "utf8");
      if (!existing.retrying && existing.bytes >= 8 * 1024) this.#flush(key, true);
      return;
    }
    this.#pending.set(key, { ...delta, bytes: Buffer.byteLength(delta.text, "utf8") });
    this.#schedule();
  }

  #schedule(): void {
    this.#tick ??= setTimeout(() => this.#flushWaiting(), 100);
  }

  /**
   * Saves and sends the buffered text of one message now, before its item or turn completes. The
   * write of that completion sends the whole message, so text that this save cannot store is not kept.
   */
  flush(key: string): void {
    this.#flush(key, false);
  }

  /**
   * A short storage failure (an antivirus scan, memory pressure) must not reach the process as an
   * uncaught exception: on the desktop, Electron shows that as an error box (#10504). The text is
   * still in the snapshot, and each save writes the whole message, so a later save stores it. While
   * the message streams, the text stays here and goes out with the next save that works: the
   * renderer drops a delta that has no new revision, and a revision only comes from a stored write.
   */
  #flush(key: string, keepOnFailure: boolean): void {
    const pending = this.#pending.get(key);
    if (!pending) return;
    this.#pending.delete(key);
    const snapshot = this.#conversation.ensureSnapshot(pending.agentId, pending.publicThreadId);
    let revision: number;
    try {
      revision = this.#database.persistStreamingMessage(streamingWrite(snapshot, pending));
    } catch (error) {
      if (!isStorageFailure(error)) throw error;
      this.#saveFailed(error);
      if (keepOnFailure) this.#keep(key, pending);
      return;
    }
    this.#saved();
    this.#send(snapshot, pending, revision);
  }

  /** Saves every waiting message in one transaction, then sends the text of each one that was kept. */
  #flushWaiting(): void {
    this.#tick = null;
    if (this.#pending.size === 0) return;
    const waiting = [...this.#pending].map(([key, pending]) => ({
      key,
      pending,
      snapshot: this.#conversation.ensureSnapshot(pending.agentId, pending.publicThreadId),
    }));
    this.#pending.clear();
    let results: ReturnType<OpenBotDatabase["persistStreamingMessages"]>;
    try {
      results = this.#database.persistStreamingMessages(
        waiting.map(({ snapshot, pending }) => streamingWrite(snapshot, pending)),
      );
    } catch (error) {
      if (!isStorageFailure(error)) throw error;
      this.#saveFailed(error);
      for (const { key, pending } of waiting) this.#keep(key, pending);
      return;
    }
    let unexpected: { error: unknown } | undefined;
    let failed = false;
    for (const [index, { key, pending, snapshot }] of waiting.entries()) {
      const result = results[index];
      if (!result) continue;
      if ("error" in result) {
        // An error that is not a storage failure drops that message's buffer and is thrown, as a
        // save of one message does. The other messages are kept and sent first.
        if (!isStorageFailure(result.error)) {
          unexpected ??= result;
          continue;
        }
        if (!failed) this.#saveFailed(result.error);
        failed = true;
        this.#keep(key, pending);
        continue;
      }
      this.#send(snapshot, pending, result.revision);
    }
    if (!failed) this.#saved();
    if (unexpected) throw unexpected.error;
  }

  /** The text stays here and goes out with the next save that works. */
  #keep(key: string, pending: BufferedDelta): void {
    pending.retrying = true;
    this.#pending.set(key, pending);
    this.#schedule();
  }

  #saveFailed(error: unknown): void {
    if (!this.#saveFailing) logger.warn("Unable to save streamed text; a later save stores it", toLogValue(error));
    this.#saveFailing = true;
  }

  #saved(): void {
    if (this.#saveFailing) logger.info("Streamed text is saved again");
    this.#saveFailing = false;
  }

  #send(snapshot: ConversationSnapshot, pending: BufferedDelta, revision: number): void {
    snapshot.revision = revision;
    this.#hooks.emit({
      type: "conversation-delta",
      agentId: pending.agentId,
      threadId: pending.publicThreadId,
      turnId: pending.turnId,
      messageId: pending.messageId,
      delta: pending.text,
      createdAt: pending.createdAt,
      revision,
    });
  }

  flushTurn(turnId: string): void {
    for (const [key, pending] of this.#pending) {
      if (pending.turnId === turnId) this.flush(key);
    }
  }

  dispose(): void {
    if (this.#tick) clearTimeout(this.#tick);
    this.#tick = null;
    this.#pending.clear();
  }
}

// Only the streamed message changed, and a flush lands ten times a second per streaming message.
// Writing the whole thread here made the cost of one flush grow with the thread's whole history,
// which is what saturated the main process when several agents streamed at once.
function streamingWrite(snapshot: ConversationSnapshot, pending: BufferedDelta): StreamingMessageWrite {
  return {
    snapshot,
    messageId: pending.messageId,
    eventType: "response.delta-flushed",
    detail: {
      turnId: pending.turnId,
      messageId: pending.messageId,
      bytes: Buffer.byteLength(pending.text, "utf8"),
    },
  };
}
