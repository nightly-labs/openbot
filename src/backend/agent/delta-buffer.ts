import type { AgentEvent, ConversationSnapshot } from "@openbot/contracts/ipc";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import type { OpenBotDatabase, StreamingMessageWrite } from "../openbot-database";
import type { ConversationRuntime } from "./conversation-runtime";

const logger = createOpenBotLogger("delta-buffer");

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
  bytes: number;
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

export class DeltaBuffer {
  readonly #conversation: ConversationRuntime;
  readonly #database: OpenBotDatabase;
  readonly #hooks: DeltaBufferHooks;
  readonly #pending = new Map<string, BufferedDelta>();
  #tick: NodeJS.Timeout | null = null;
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

  flush(key: string): void {
    this.#flush(key, false);
  }

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
