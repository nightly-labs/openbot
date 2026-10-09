import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AgentEvent,
  AgentMemory,
  CreateAgentMemoryInput,
  DeleteAgentMemoryInput,
  UpdateAgentMemoryInput,
} from "@openbot/contracts/ipc";
import { isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { AgentMemoryStore } from "../agent-memory-store";
import type { AgentStore } from "../agent-store";
import { normalizeMemoryText } from "../memory-store";
import { type DynamicToolCallParams, isRecord } from "../protocol";
import type { ConversationRuntime } from "./conversation-runtime";
import { type OpenBotToolResponse, openBotToolFailure, openBotToolResult } from "./routine-tools";

type PendingMemoryMutation =
  | {
      callId: string;
      type: "remember";
      agentId: string;
      epoch: number;
      memoryId?: string;
      text: string;
      sourceTurnId: string;
      expectedUpdatedAt?: string | null;
    }
  | {
      callId: string;
      type: "forget";
      agentId: string;
      epoch: number;
      memoryId: string;
      expectedUpdatedAt: string;
    };

export interface AgentMemoriesOptions {
  store: AgentStore;
  conversation: ConversationRuntime;
  emit(event: AgentEvent): void;
  emitError(code: string, error: unknown, agentId?: string): void;
  /** How many memories one agent can hold: the app setting. Omitted, the default cap. */
  limit?: () => number;
}

/**
 * What an agent remembers about its work between turns.
 *
 * The staging half is the reason this is a class and not a store wrapper. An agent's `remember` and
 * `forget_memory` calls do not take effect when the model makes them: they are held against the
 * turn and committed only if that turn completes, so a turn the user interrupts or that fails
 * leaves nothing behind. The epoch counter is what makes that safe against a concurrent manual
 * edit — `clearMemories` bumps it, and a staged mutation whose epoch has moved is dropped rather
 * than resurrecting a memory the user just deleted.
 */
export class AgentMemories {
  readonly #conversation: ConversationRuntime;
  readonly #emit: (event: AgentEvent) => void;
  readonly #emitError: (code: string, error: unknown, agentId?: string) => void;
  readonly #memories: AgentMemoryStore;
  readonly #pending = new Map<string, PendingMemoryMutation[]>();
  readonly #epochs = new Map<string, number>();

  constructor(options: AgentMemoriesOptions) {
    this.#conversation = options.conversation;
    this.#emit = options.emit;
    this.#emitError = options.emitError;
    this.#memories = new AgentMemoryStore(options.store.database, options.limit);
  }

  limit(): number {
    return this.#memories.limit();
  }

  list(agentId: string): AgentMemory[] {
    this.#conversation.requireKnownAgent(agentId);
    return this.#memories.list(agentId);
  }

  /** Unchecked read for callers that already hold the agent, such as the developer instructions. */
  listFor(agentId: string): AgentMemory[] {
    return this.#memories.list(agentId);
  }

  create(input: CreateAgentMemoryInput): AgentMemory {
    this.#conversation.requireKnownAgent(input.agentId);
    const memory = this.#memories.createManual(input.agentId, input.text);
    this.stateChanged(input.agentId);
    return memory;
  }

  update(input: UpdateAgentMemoryInput): AgentMemory {
    this.#conversation.requireKnownAgent(input.agentId);
    const memory = this.#memories.updateManual(input.agentId, input.memoryId, input.text);
    this.stateChanged(input.agentId);
    return memory;
  }

  delete(input: DeleteAgentMemoryInput): void {
    this.#conversation.requireKnownAgent(input.agentId);
    if (!this.#memories.delete(input.agentId, input.memoryId)) {
      throw new Error(sourceText("error.backend.memoryGone"));
    }
    this.stateChanged(input.agentId);
  }

  clear(agentId: string): void {
    this.#conversation.requireKnownAgent(agentId);
    this.#epochs.set(agentId, this.#epoch(agentId) + 1);
    if (this.#memories.clear(agentId) > 0) this.stateChanged(agentId);
  }

  duplicate(sourceAgentId: string, targetAgentId: string): void {
    this.#memories.duplicate(sourceAgentId, targetAgentId);
  }

  /**
   * The two `openbot` memory tools. Returns null when `tool` is not one of them.
   *
   * Invalid arguments are a failed tool result that the agent can correct. A throw reached the user
   * as a "Provider error" toast, and the agent got only an opaque fault (#1524).
   */
  handleTool(params: DynamicToolCallParams, senderAgentId: string): OpenBotToolResponse | null {
    if (params.tool === "remember") {
      const args = params.arguments;
      if (!isRecord(args) || !isString(args.text))
        return openBotToolFailure(sourceText("error.backend.memoryTextRequired"));
      const text = args.text.trim();
      if (!text) return openBotToolFailure(sourceText("error.backend.memoryTextRequired"));
      if (text.length > INPUT_LIMITS.agentMemoryText)
        return openBotToolFailure(sourceText("error.backend.memoryTextTooLong"));
      const memoryId = args.memoryId;
      if (
        memoryId !== undefined &&
        (!isString(memoryId) || memoryId.length === 0 || memoryId.length > INPUT_LIMITS.identifier)
      ) {
        return openBotToolFailure("memoryId is invalid.");
      }
      const current = memoryId ? this.#memories.get(senderAgentId, memoryId) : null;
      if (memoryId && !current) return openBotToolFailure("This memory does not belong to the current agent.");
      // A full agent hears it now, while it can still merge or forget in this turn. Staged anyway,
      // the save would fail at commit and the memory would be lost.
      if (!memoryId) {
        const projected = this.#projectedMemories(senderAgentId, params.turnId, params.callId);
        const normalized = normalizeMemoryText(text);
        const limit = this.#memories.limit();
        const saved = projected.size;
        if (saved >= limit && ![...projected.values()].some((memory) => memory.text === normalized)) {
          // Over the limit only when the user lowered it. The agent must not delete memories for that.
          const key =
            saved > limit ? "error.backend.agentMemoryLimitExceeded" : "error.backend.agentMemoryLimitReached";
          return openBotToolFailure(sourceText(key, { saved, limit }));
        }
      }
      this.#stage(params.turnId, {
        callId: params.callId,
        type: "remember",
        agentId: senderAgentId,
        epoch: this.#epoch(senderAgentId),
        ...(memoryId ? { memoryId } : {}),
        text,
        sourceTurnId: params.turnId,
        ...(memoryId ? { expectedUpdatedAt: current?.updatedAt ?? null } : {}),
      });
      return openBotToolResult({ status: "staged", memoryId: memoryId ?? null });
    }

    if (params.tool === "forget_memory") {
      const args = params.arguments;
      if (
        !isRecord(args) ||
        !isString(args.memoryId) ||
        args.memoryId.length === 0 ||
        args.memoryId.length > INPUT_LIMITS.identifier
      ) {
        return openBotToolFailure("memoryId is required.");
      }
      const current = this.#memories.get(senderAgentId, args.memoryId);
      if (!current) return openBotToolFailure("This memory does not belong to the current agent.");
      this.#stage(params.turnId, {
        callId: params.callId,
        type: "forget",
        agentId: senderAgentId,
        epoch: this.#epoch(senderAgentId),
        memoryId: current.id,
        expectedUpdatedAt: current.updatedAt,
      });
      return openBotToolResult({ status: "staged", memoryId: current.id });
    }

    return null;
  }

  /** Commits a turn's staged mutations, or discards them when the turn did not complete. */
  finishTurn(turnId: string, status: string): void {
    const pending = this.#pending.get(turnId) ?? [];
    this.#pending.delete(turnId);
    if (status !== "completed" || pending.length === 0) return;

    const affectedAgents = new Set<string>();
    for (const mutation of pending) {
      if (mutation.epoch !== this.#epoch(mutation.agentId)) continue;
      const before = JSON.stringify(this.#memories.list(mutation.agentId));
      try {
        if (mutation.type === "remember") this.#memories.saveAutomatic(mutation);
        else this.#memories.delete(mutation.agentId, mutation.memoryId, mutation.expectedUpdatedAt);
      } catch (error) {
        this.#emitError("memory_commit_failed", error, mutation.agentId);
        continue;
      }
      if (JSON.stringify(this.#memories.list(mutation.agentId)) !== before) affectedAgents.add(mutation.agentId);
    }
    for (const agentId of affectedAgents) this.stateChanged(agentId);
  }

  clearPending(): void {
    this.#pending.clear();
  }

  /**
   * A memory change invalidates the developer instructions the provider was started with, so every
   * thread of the agent is unloaded and the next turn on each of them rebuilds them.
   */
  stateChanged(agentId: string): void {
    const agent = this.#conversation.requireKnownAgent(agentId);
    this.#conversation.unloadAgentThreads(agent.id);
    this.#emit({ type: "memories-changed", agentId });
  }

  /**
   * The agent's memories, by id, once this turn's staged changes commit, replayed in staging order
   * as `finishTurn` applies them. A staged change that commit would skip, such as a forget of a
   * memory the same turn already updated, is skipped here too.
   *
   * Another turn of the agent, such as a channel turn beside its chat, commits apart: before this
   * one, after it, or never. So its new memories hold a place, and its forgets and updates free none.
   * A memory that another turn changes counts, but this turn can neither fold into it nor remove it.
   * A null text never matches.
   */
  #projectedMemories(
    agentId: string,
    turnId: string,
    exceptCallId: string,
  ): Map<string, { text: string | null; updatedAt: string | null }> {
    const epoch = this.#epoch(agentId);
    const counts = (mutation: PendingMemoryMutation) =>
      mutation.agentId === agentId && mutation.epoch === epoch && mutation.callId !== exceptCallId;
    const others = [...this.#pending]
      .filter(([pendingTurnId]) => pendingTurnId !== turnId)
      .flatMap(([, pending]) => pending.filter(counts));
    const changedElsewhere = new Set(others.flatMap((mutation) => (mutation.memoryId ? [mutation.memoryId] : [])));
    const memories = new Map<string, { text: string | null; updatedAt: string | null }>(
      this.#memories
        .list(agentId)
        .map((memory) => [
          memory.id,
          changedElsewhere.has(memory.id)
            ? { text: null, updatedAt: null }
            : { text: normalizeMemoryText(memory.text), updatedAt: memory.updatedAt },
        ]),
    );
    for (const mutation of (this.#pending.get(turnId) ?? []).filter(counts)) {
      if (mutation.type === "forget") {
        if (memories.get(mutation.memoryId)?.updatedAt === mutation.expectedUpdatedAt)
          memories.delete(mutation.memoryId);
        continue;
      }
      const text = normalizeMemoryText(mutation.text);
      const same = [...memories].find(([, memory]) => memory.text === text)?.[0];
      if (!mutation.memoryId) {
        if (same === undefined) memories.set(`staged:${mutation.callId}`, { text, updatedAt: null });
        continue;
      }
      const current = memories.get(mutation.memoryId);
      if (!current || (mutation.expectedUpdatedAt !== undefined && current.updatedAt !== mutation.expectedUpdatedAt))
        continue;
      // An update to the text of another memory folds the two into one.
      if (same !== undefined && same !== mutation.memoryId) memories.delete(mutation.memoryId);
      else memories.set(mutation.memoryId, { text, updatedAt: null });
    }
    for (const mutation of others) {
      if (mutation.type === "remember" && !mutation.memoryId)
        memories.set(`reserved:${mutation.callId}`, { text: null, updatedAt: null });
    }
    return memories;
  }

  #stage(turnId: string, mutation: PendingMemoryMutation): void {
    const pending = this.#pending.get(turnId) ?? [];
    if (!pending.some((candidate) => candidate.callId === mutation.callId)) pending.push(mutation);
    this.#pending.set(turnId, pending);
  }

  #epoch(agentId: string): number {
    return this.#epochs.get(agentId) ?? 0;
  }
}
