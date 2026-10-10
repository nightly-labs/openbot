import { AGENT_MEMORY_CONTEXT_BUDGET_BYTES, essentialMemoryBytes } from "@openbot/contracts/agent-memory-context";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AgentEvent,
  AgentMemory,
  AgentMemorySelectionState,
  CreateAgentMemoryInput,
  DeleteAgentMemoryInput,
  SetAgentMemoryInclusionInput,
  UpdateAgentMemoryInput,
} from "@openbot/contracts/ipc";
import { isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { redactText } from "@openbot/logging";
import {
  type AgentMemoryListPage,
  type AgentMemorySearchResult,
  AgentMemorySelectionError,
  AgentMemoryStore,
} from "../agent-memory-store";
import type { AgentStore } from "../agent-store";
import { normalizeMemoryText } from "../memory-store";
import { type DynamicToolCallParams, isRecord } from "../protocol";
import type { ConversationRuntime } from "./conversation-runtime";
import { listMemoriesInput, searchMemoriesInput, setMemoryInclusionInput } from "./memory-tool-inputs";
import { type OpenBotToolResponse, openBotToolFailure, openBotToolResult } from "./routine-tools";

type PendingMemoryMutation =
  | {
      callId: string;
      type: "selection";
      agentId: string;
      epoch: number;
      memoryId?: never;
      changes: SetAgentMemoryInclusionInput["changes"];
    }
  | {
      callId: string;
      type: "remember";
      agentId: string;
      epoch: number;
      memoryId?: string;
      text: string;
      sourceTurnId: string;
      expectedUpdatedAt?: string | null;
      expectedSelectionRevision?: number;
      inclusion?: "essential" | "searchable";
    }
  | {
      callId: string;
      type: "forget";
      agentId: string;
      epoch: number;
      memoryId: string;
      expectedUpdatedAt: string;
      expectedSelectionRevision: number;
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

  essentialFor(agentId: string): AgentMemory[] {
    const ids = new Set(
      this.#memories
        .listSelections(agentId)
        .filter((entry) => entry.inclusion === "essential")
        .map((entry) => entry.memoryId),
    );
    return this.#memories.list(agentId).filter((memory) => ids.has(memory.id));
  }

  selectionState(agentId: string): AgentMemorySelectionState {
    this.#conversation.requireKnownAgent(agentId);
    return this.#memories.selectionState(agentId);
  }

  setInclusions(input: SetAgentMemoryInclusionInput): AgentMemorySelectionState {
    this.#conversation.requireKnownAgent(input.agentId);
    const result = this.#memories.setInclusions(input.agentId, input.changes, "user");
    this.stateChanged(input.agentId);
    return result;
  }

  initializeSelection(agentId: string): void {
    this.#conversation.requireKnownAgent(agentId);
    this.#memories.initializeSelection(agentId);
    this.stateChanged(agentId);
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

  /** Return expected memory failures to the agent without exposing database errors or memory text. */
  handleTool(
    params: DynamicToolCallParams,
    senderAgentId: string,
    redact: (value: string) => string = redactText,
  ): OpenBotToolResponse | null {
    try {
      return this.#handleTool(params, senderAgentId, redact);
    } catch (error) {
      const message =
        error instanceof AgentMemorySelectionError ? error.message : sourceText("error.backend.memoryOperationFailed");
      return openBotToolFailure(message);
    }
  }

  #handleTool(
    params: DynamicToolCallParams,
    senderAgentId: string,
    redact: (value: string) => string,
  ): OpenBotToolResponse | null {
    if (params.tool === "search_memories") {
      const parsed = searchMemoriesInput.safeParse(params.arguments);
      if (!parsed.success) return openBotToolFailure(sourceText("error.backend.memorySearchQuery"));
      return memoryRecallResult(this.#memories.search(senderAgentId, parsed.data.query, parsed.data.limit), redact);
    }
    if (params.tool === "list_memories") {
      const parsed = listMemoriesInput.safeParse(params.arguments);
      if (!parsed.success) return openBotToolFailure("after must be a memory ID or null.");
      return memoryRecallResult(this.#memories.listPage(senderAgentId, parsed.data.after ?? null), redact);
    }
    if (params.tool === "set_memory_inclusion") {
      const parsed = setMemoryInclusionInput.safeParse(params.arguments);
      if (!parsed.success) return openBotToolFailure("Provide 1 to 25 memory selections with their current revisions.");
      const ids = new Set<string>();
      const planned = this.#plannedContext(senderAgentId, params.turnId, params.callId);
      const essentials = planned.essential;
      for (const change of parsed.data.changes) {
        const selection = this.#memories.getSelection(senderAgentId, change.memoryId);
        const memory = this.#memories.get(senderAgentId, change.memoryId);
        if (!selection || !memory || selection.revision !== change.expectedRevision || ids.has(change.memoryId))
          return openBotToolFailure(sourceText("error.backend.memorySelectionConflict"));
        if (selection.userControlled)
          return openBotToolFailure(sourceText("error.backend.memorySelectionUserControlled"));
        ids.add(change.memoryId);
        if (change.inclusion === "essential") essentials.set(memory.id, planned.all.get(memory.id) ?? memory);
        else essentials.delete(memory.id);
      }
      if (essentialMemoryBytes([...essentials.values()]) > AGENT_MEMORY_CONTEXT_BUDGET_BYTES)
        return openBotToolFailure(sourceText("error.backend.memoryEssentialBudget"));
      this.#stage(params.turnId, {
        callId: params.callId,
        type: "selection",
        agentId: senderAgentId,
        epoch: this.#epoch(senderAgentId),
        changes: parsed.data.changes,
      });
      return openBotToolResult({ status: "staged" });
    }
    if (params.tool === "remember") {
      const args = params.arguments;
      if (!isRecord(args) || !isString(args.text))
        return openBotToolFailure(sourceText("error.backend.memoryTextRequired"));
      const text = args.text.trim();
      if (!text) return openBotToolFailure(sourceText("error.backend.memoryTextRequired"));
      if (text.length > INPUT_LIMITS.agentMemoryText)
        return openBotToolFailure(sourceText("error.backend.memoryTextTooLong"));
      if (args.inclusion !== undefined && args.inclusion !== "essential" && args.inclusion !== "searchable")
        return openBotToolFailure("inclusion must be essential or searchable.");
      const memoryId = args.memoryId;
      if (
        memoryId !== undefined &&
        (!isString(memoryId) || memoryId.length === 0 || memoryId.length > INPUT_LIMITS.identifier)
      ) {
        return openBotToolFailure("memoryId is invalid.");
      }
      const current = memoryId ? this.#memories.get(senderAgentId, memoryId) : null;
      if (memoryId && !current) return openBotToolFailure("This memory does not belong to the current agent.");
      const duplicate = !current ? this.#memories.list(senderAgentId).find((memory) => memory.text === text) : null;
      const selectedId = current?.id ?? duplicate?.id;
      const selection = selectedId ? this.#memories.getSelection(senderAgentId, selectedId) : null;
      if (selection?.userControlled && args.inclusion !== undefined && args.inclusion !== selection.inclusion)
        return openBotToolFailure(sourceText("error.backend.memorySelectionUserControlled"));
      const plannedEssentials = this.#plannedContext(senderAgentId, params.turnId, params.callId).essential;
      const intendedInclusion =
        args.inclusion ?? (selectedId && plannedEssentials.has(selectedId) ? "essential" : "searchable");
      let inclusion: "essential" | "searchable" = intendedInclusion;
      if (inclusion === "essential") {
        const others = [...plannedEssentials.values()].filter(
          (memory) => memory.id !== selectedId && (current || memory.text !== text),
        );
        const candidate = {
          id: selectedId ?? "00000000-0000-0000-0000-000000000000",
          text,
          origin: duplicate?.origin ?? ("automatic" as const),
        };
        if (essentialMemoryBytes([...others, candidate]) > AGENT_MEMORY_CONTEXT_BUDGET_BYTES) {
          if (current && selection?.inclusion === "essential")
            return openBotToolFailure(sourceText("error.backend.memoryEssentialBudget"));
          inclusion = "searchable";
        }
      }
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
        ...(current && selection ? { expectedSelectionRevision: selection.revision } : {}),
        inclusion,
      });
      return openBotToolResult({
        status: "staged",
        memoryId: memoryId ?? null,
        inclusion,
        ...(inclusion !== intendedInclusion ? { note: sourceText("error.backend.memoryEssentialBudget") } : {}),
      });
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
      const selection = this.#memories.getSelection(senderAgentId, current.id);
      if (selection?.userControlled)
        return openBotToolFailure(sourceText("error.backend.memorySelectionUserControlled"));
      this.#stage(params.turnId, {
        callId: params.callId,
        type: "forget",
        agentId: senderAgentId,
        epoch: this.#epoch(senderAgentId),
        memoryId: current.id,
        expectedUpdatedAt: current.updatedAt,
        expectedSelectionRevision: selection?.revision ?? -1,
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
    const ownRevisions = new Map<string, Map<number, number>>();
    const revisionAfterOwnChanges = (agentId: string, memoryId: string, revision: number): number => {
      const changes = ownRevisions.get(`${agentId}:${memoryId}`);
      let next = revision;
      while (changes?.has(next)) next = changes.get(next) ?? next;
      return next;
    };
    for (const mutation of pending) {
      if (mutation.epoch !== this.#epoch(mutation.agentId)) continue;
      const before = this.#storedState(mutation.agentId);
      const previousSelections = this.#memories.listSelections(mutation.agentId);
      try {
        if (mutation.type === "selection")
          this.#memories.setInclusions(
            mutation.agentId,
            mutation.changes.map((change) => ({
              ...change,
              expectedRevision: revisionAfterOwnChanges(mutation.agentId, change.memoryId, change.expectedRevision),
            })),
            "agent",
          );
        else if (mutation.type === "remember")
          this.#commitRemember({
            ...mutation,
            ...(mutation.memoryId && mutation.expectedSelectionRevision !== undefined
              ? {
                  expectedSelectionRevision: revisionAfterOwnChanges(
                    mutation.agentId,
                    mutation.memoryId,
                    mutation.expectedSelectionRevision,
                  ),
                }
              : {}),
          });
        else if (
          !this.#memories.getSelection(mutation.agentId, mutation.memoryId)?.userControlled &&
          this.#memories.getSelection(mutation.agentId, mutation.memoryId)?.revision ===
            revisionAfterOwnChanges(mutation.agentId, mutation.memoryId, mutation.expectedSelectionRevision)
        )
          this.#memories.delete(mutation.agentId, mutation.memoryId, mutation.expectedUpdatedAt);
      } catch (error) {
        this.#emitError("memory_commit_failed", error, mutation.agentId);
        continue;
      }
      for (const selection of this.#memories.listSelections(mutation.agentId)) {
        const previous = previousSelections.find((entry) => entry.memoryId === selection.memoryId);
        if (!previous || previous.revision === selection.revision) continue;
        const key = `${mutation.agentId}:${selection.memoryId}`;
        const revisions = ownRevisions.get(key) ?? new Map<number, number>();
        revisions.set(previous.revision, selection.revision);
        ownRevisions.set(key, revisions);
      }
      if (this.#storedState(mutation.agentId) !== before) affectedAgents.add(mutation.agentId);
    }
    for (const agentId of affectedAgents) this.stateChanged(agentId);
  }

  /** Reserve prompt space for this turn's staged changes, without making them visible to search. */
  #plannedContext(agentId: string, turnId: string, exceptCallId: string) {
    const all = new Map<string, Pick<AgentMemory, "id" | "text" | "origin">>(
      this.#memories.list(agentId).map((memory) => [memory.id, memory]),
    );
    const selected = new Map<string, Pick<AgentMemory, "id" | "text" | "origin">>(
      this.essentialFor(agentId).map((memory) => [memory.id, memory]),
    );
    for (const pending of this.#pending.get(turnId) ?? []) {
      if (pending.agentId !== agentId || pending.callId === exceptCallId || pending.epoch !== this.#epoch(agentId))
        continue;
      if (pending.type === "selection") {
        for (const change of pending.changes) {
          const memory = all.get(change.memoryId);
          if (change.inclusion === "essential" && memory) selected.set(memory.id, memory);
          else selected.delete(change.memoryId);
        }
      } else if (pending.type === "forget") {
        selected.delete(pending.memoryId);
        all.delete(pending.memoryId);
      } else {
        const duplicate = [...all].find(([, memory]) => memory.text === pending.text && memory.id !== pending.memoryId);
        const key = duplicate?.[0] ?? pending.memoryId ?? `pending:${pending.callId}`;
        if (duplicate && pending.memoryId) {
          selected.delete(pending.memoryId);
          all.delete(pending.memoryId);
        }
        const memory = duplicate?.[1] ?? {
          id: pending.memoryId ?? "00000000-0000-0000-0000-000000000000",
          text: pending.text,
          origin: "automatic" as const,
        };
        all.set(key, memory);
        if (pending.inclusion === "essential") selected.set(key, memory);
        else selected.delete(key);
      }
    }
    return { all, essential: selected };
  }

  #storedState(agentId: string): string {
    return JSON.stringify({
      memories: this.#memories.list(agentId),
      selection: this.#memories.listSelections(agentId),
    });
  }

  #commitRemember(mutation: Extract<PendingMemoryMutation, { type: "remember" }>): void {
    this.#memories.withMemoryTransaction(() => {
      if (mutation.memoryId) {
        const current = this.#memories.get(mutation.agentId, mutation.memoryId);
        const selection = this.#memories.getSelection(mutation.agentId, mutation.memoryId);
        if (
          !current ||
          !selection ||
          current.updatedAt !== mutation.expectedUpdatedAt ||
          selection.revision !== mutation.expectedSelectionRevision
        )
          return;
        // An explicit move to searchable can make room for a longer corrected text.
        if (mutation.inclusion === "searchable" && selection.inclusion === "essential") {
          this.#memories.setInclusions(
            mutation.agentId,
            [{ memoryId: current.id, inclusion: "searchable", expectedRevision: selection.revision }],
            "agent",
          );
        }
      }
      const memory = this.#memories.saveAutomatic({
        agentId: mutation.agentId,
        ...(mutation.memoryId ? { memoryId: mutation.memoryId } : {}),
        text: mutation.text,
        sourceTurnId: mutation.sourceTurnId,
        expectedUpdatedAt: mutation.expectedUpdatedAt,
      });
      if (!memory || mutation.inclusion !== "essential") return;
      const selection = this.#memories.getSelection(mutation.agentId, memory.id);
      if (!selection || selection.inclusion === "essential" || selection.userControlled) return;
      const next = [...this.essentialFor(mutation.agentId), memory];
      // Another turn may have used the remaining budget. Keep the saved text searchable.
      if (essentialMemoryBytes(next) > AGENT_MEMORY_CONTEXT_BUDGET_BYTES) return;
      this.#memories.setInclusions(
        mutation.agentId,
        [{ memoryId: memory.id, inclusion: "essential", expectedRevision: selection.revision }],
        "agent",
      );
    });
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
      if (mutation.type === "selection") continue;
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

/** Redaction can expand text, so bound the final provider payload as well as the store result. */
function memoryRecallResult(
  result: AgentMemorySearchResult | AgentMemoryListPage,
  redact: (value: string) => string,
): OpenBotToolResponse {
  while (
    Buffer.byteLength(redact(JSON.stringify(result)), "utf8") > AGENT_MEMORY_CONTEXT_BUDGET_BYTES &&
    result.memories.length > 0
  ) {
    result.memories.pop();
    result.hasMore = true;
    if ("nextCursor" in result) result.nextCursor = result.memories.at(-1)?.id ?? null;
  }
  return { success: true, contentItems: [{ type: "inputText", text: redact(JSON.stringify(result)) }] };
}
