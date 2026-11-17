import type { AgentEvent } from "@openbot/contracts/ipc";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import type { OpenBotDatabase } from "../openbot-database";
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
  timer: NodeJS.Timeout | null;
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
 * events. Deltas accumulate per message and flush on a 100 ms debounce, an
 * 8 KiB cap, item completion, or turn completion — whichever comes first.
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
      if (!existing.retrying && Buffer.byteLength(existing.text, "utf8") >= 8 * 1024) this.#flush(key, true);
      return;
    }
    const pending: BufferedDelta = { ...delta, timer: null };
    pending.timer = setTimeout(() => this.#flush(key, true), 100);
    this.#pending.set(key, pending);
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
    if (pending.timer) clearTimeout(pending.timer);
    const snapshot = this.#conversation.ensureSnapshot(pending.agentId, pending.publicThreadId);
    // Only the streamed message changed, and a flush lands ten times a second per streaming
    // message. Writing the whole thread here made the cost of one flush grow with the thread's
    // whole history, which is what saturated the main process when several agents streamed at once.
    try {
      snapshot.revision = this.#database.persistStreamingMessage({
        snapshot,
        messageId: pending.messageId,
        eventType: "response.delta-flushed",
        detail: {
          turnId: pending.turnId,
          messageId: pending.messageId,
          bytes: Buffer.byteLength(pending.text, "utf8"),
        },
      });
    } catch (error) {
      if (!isStorageFailure(error)) throw error;
      if (!this.#saveFailing) logger.warn("Unable to save streamed text; a later save stores it", toLogValue(error));
      this.#saveFailing = true;
      if (!keepOnFailure) return;
      pending.retrying = true;
      pending.timer = setTimeout(() => this.#flush(key, true), 100);
      this.#pending.set(key, pending);
      return;
    }
    if (this.#saveFailing) logger.info("Streamed text is saved again");
    this.#saveFailing = false;
    this.#hooks.emit({
      type: "conversation-delta",
      agentId: pending.agentId,
      threadId: pending.publicThreadId,
      turnId: pending.turnId,
      messageId: pending.messageId,
      delta: pending.text,
      createdAt: pending.createdAt,
      revision: snapshot.revision,
    });
  }

  flushTurn(turnId: string): void {
    for (const [key, pending] of this.#pending) {
      if (pending.turnId === turnId) this.flush(key);
    }
  }

  dispose(): void {
    for (const pending of this.#pending.values()) {
      if (pending.timer) clearTimeout(pending.timer);
    }
    this.#pending.clear();
  }
}
