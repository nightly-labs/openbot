import { AGENT_MEMORY_CONTEXT_BUDGET_BYTES, essentialMemoryBytes } from "@openbot/contracts/agent-memory-context";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AgentEvent,
  AgentMemory,
  AgentMemorySelectionState,
  ConversationMemoryChange,
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
import type { MemoryReviewOperation } from "./memory-review-prompt";
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
      duplicate?: { memoryId: string; expectedRevision: number };
      inclusion: "essential" | "searchable";
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

/** The memories that a background review read, and the epoch it read them in. */
export interface MemoryReviewBase {
  epoch: number;
  limit: number;
  essentialBytes: number;
  memories: { memory: AgentMemory; inclusion: "essential" | "searchable"; userControlled: boolean }[];
}

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

  /** The memories that a background review reads, with the epoch that its changes must still match. */
  reviewBase(agentId: string): MemoryReviewBase {
    const selections = new Map(this.#memories.listSelections(agentId).map((entry) => [entry.memoryId, entry]));
    const memories = this.#memories.list(agentId).map((memory) => ({
      memory,
      inclusion: selections.get(memory.id)?.inclusion ?? ("searchable" as const),
      userControlled: selections.get(memory.id)?.userControlled ?? false,
    }));
    return {
      epoch: this.#epoch(agentId),
      limit: this.#memories.limit(),
      essentialBytes: essentialMemoryBytes(
        memories.filter((entry) => entry.inclusion === "essential").map((entry) => entry.memory),
      ),
      memories,
    };
  }

  /**
   * Commits the changes of a background review as one turn of the agent, through the checks of the
   * memory tools: the cap, the essential budget, duplicates and the user's choices. A review changes
   * only the memories that the agent saved, and only while they hold the text that the review read.
   * A clear since `reviewBase` drops every change.
   */
  applyReview(
    agentId: string,
    base: MemoryReviewBase,
    operations: readonly MemoryReviewOperation[],
    turnId: string,
  ): ConversationMemoryChange[] {
    if (base.epoch !== this.#epoch(agentId)) return [];
    const read = new Map(base.memories.map((entry) => [entry.memory.id, entry]));
    // Forgets first, so that the adds find the room they free.
    const ordered = [
      ...operations.filter((operation) => operation.type === "forget"),
      ...operations.filter((operation) => operation.type === "update"),
      ...operations.filter((operation) => operation.type === "add"),
    ];
    const changed = new Set(operations.flatMap((operation) => (operation.type === "add" ? [] : [operation.memoryId])));
    const saved = new Set(
      this.#memories
        .list(agentId)
        .filter((memory) => !changed.has(memory.id))
        .map((memory) => memory.text),
    );
    ordered.forEach((operation, index) => {
      // An add of a saved text would only change that memory's inclusion, which can be the user's choice.
      if (operation.type === "add" && saved.has(normalizeMemoryText(operation.text))) return;
      if (operation.type !== "add") {
        const entry = read.get(operation.memoryId);
        const current = this.#memories.get(agentId, operation.memoryId);
        if (
          !entry ||
          entry.userControlled ||
          entry.memory.origin === "manual" ||
          current?.updatedAt !== entry.memory.updatedAt
        )
          return;
      }
      this.handleTool(
        {
          threadId: "",
          turnId,
          callId: `${turnId}:${index}`,
          namespace: null,
          tool: operation.type === "forget" ? "forget_memory" : "remember",
          arguments:
            operation.type === "forget"
              ? { memoryId: operation.memoryId }
              : operation.type === "update"
                ? { memoryId: operation.memoryId, text: operation.text }
                : { text: operation.text, inclusion: operation.inclusion },
        },
        agentId,
      );
    });
    return this.finishTurn(turnId, "completed").get(agentId) ?? [];
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
      const result = memoryRecallResult(
        this.#memories.search(senderAgentId, parsed.data.query, parsed.data.limit),
        redact,
      );
      this.#emitRecallProgress(params, senderAgentId, result.count);
      return result.response;
    }
    if (params.tool === "list_memories") {
      const parsed = listMemoriesInput.safeParse(params.arguments);
      if (!parsed.success) return openBotToolFailure("after must be a memory ID or null.");
      const result = memoryRecallResult(this.#memories.listPage(senderAgentId, parsed.data.after ?? null), redact);
      this.#emitRecallProgress(params, senderAgentId, result.count);
      return result.response;
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
      const planned = this.#plannedContext(senderAgentId, params.turnId, params.callId);
      const duplicateEntry = [...planned.all].find(([key, memory]) => key !== memoryId && memory.text === text);
      const duplicate = duplicateEntry?.[1];
      const sourceSelection = current ? this.#memories.getSelection(senderAgentId, current.id) : null;
      const duplicateSelection = duplicate ? this.#memories.getSelection(senderAgentId, duplicate.id) : null;
      const selectedId = duplicate?.id ?? current?.id;
      const selectedKey = duplicateEntry?.[0] ?? current?.id;
      const selection = duplicateSelection ?? sourceSelection;
      if (duplicate && sourceSelection?.userControlled)
        return openBotToolFailure(sourceText("error.backend.memorySelectionUserControlled"));
      if (selection?.userControlled && args.inclusion !== undefined && args.inclusion !== selection.inclusion)
        return openBotToolFailure(sourceText("error.backend.memorySelectionUserControlled"));
      if (!current && duplicate && selection?.userControlled)
        return openBotToolResult({ status: "unchanged", memoryId: duplicate.id, inclusion: selection.inclusion });
      const plannedEssentials = planned.essential;
      const intendedInclusion =
        args.inclusion ??
        (selection?.userControlled
          ? selection.inclusion
          : selectedKey && plannedEssentials.has(selectedKey)
            ? "essential"
            : "searchable");
      let inclusion: "essential" | "searchable" = intendedInclusion;
      if (inclusion === "essential") {
        const others = [...plannedEssentials]
          .filter(([key, memory]) => key !== current?.id && key !== duplicateEntry?.[0] && memory.text !== text)
          .map(([, memory]) => memory);
        const candidate = {
          id: selectedId ?? "00000000-0000-0000-0000-000000000000",
          text,
          origin: duplicate?.origin ?? ("automatic" as const),
        };
        if (essentialMemoryBytes([...others, candidate]) > AGENT_MEMORY_CONTEXT_BUDGET_BYTES) {
          if (current && sourceSelection?.inclusion === "essential")
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
        ...(sourceSelection ? { expectedSelectionRevision: sourceSelection.revision } : {}),
        ...(duplicate && duplicateSelection
          ? { duplicate: { memoryId: duplicate.id, expectedRevision: duplicateSelection.revision } }
          : {}),
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

  /**
   * Commits a turn's staged mutations, or discards them when the turn did not complete. Answers the
   * memories that the commit saved, updated and forgot, by agent. A mutation that another turn made
   * stale, such as a change of a memory that a parallel thread changed first, is `notChanged`, so the
   * thread that made it can show it. A mutation that its text already holds is not in it.
   */
  finishTurn(turnId: string, status: string): Map<string, ConversationMemoryChange[]> {
    const pending = this.#pending.get(turnId) ?? [];
    this.#pending.delete(turnId);
    const changes = new Map<string, ConversationMemoryChange[]>();
    if (status !== "completed" || pending.length === 0) return changes;

    const affectedAgents = new Set<string>();
    const createdMemories = new Set<string>();
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
      const previousMemory =
        mutation.type === "selection" || !mutation.memoryId
          ? null
          : this.#memories.get(mutation.agentId, mutation.memoryId);
      const previousIds =
        mutation.type === "remember" && !mutation.memoryId
          ? new Set(this.#memories.list(mutation.agentId).map((memory) => memory.id))
          : null;
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
          this.#commitRemember(
            {
              ...mutation,
              ...(mutation.duplicate
                ? {
                    duplicate: {
                      ...mutation.duplicate,
                      expectedRevision: revisionAfterOwnChanges(
                        mutation.agentId,
                        mutation.duplicate.memoryId,
                        mutation.duplicate.expectedRevision,
                      ),
                    },
                  }
                : {}),
              ...(mutation.memoryId && mutation.expectedSelectionRevision !== undefined
                ? {
                    expectedSelectionRevision: revisionAfterOwnChanges(
                      mutation.agentId,
                      mutation.memoryId,
                      mutation.expectedSelectionRevision,
                    ),
                  }
                : {}),
            },
            createdMemories,
          );
        else if (
          !this.#memories.getSelection(mutation.agentId, mutation.memoryId)?.userControlled &&
          this.#memories.getSelection(mutation.agentId, mutation.memoryId)?.revision ===
            revisionAfterOwnChanges(mutation.agentId, mutation.memoryId, mutation.expectedSelectionRevision)
        )
          this.#memories.delete(mutation.agentId, mutation.memoryId, mutation.expectedUpdatedAt);
      } catch (error) {
        this.#emitError("memory_commit_failed", error, mutation.agentId);
        addChanges(changes, mutation.agentId, this.#refusedChanges(mutation, previousMemory));
        continue;
      }
      for (const selection of this.#memories.listSelections(mutation.agentId)) {
        const previous = previousSelections.find((entry) => entry.memoryId === selection.memoryId);
        if (!previous) {
          createdMemories.add(selection.memoryId);
          continue;
        }
        if (previous.revision === selection.revision) continue;
        const key = `${mutation.agentId}:${selection.memoryId}`;
        const revisions = ownRevisions.get(key) ?? new Map<number, number>();
        revisions.set(previous.revision, selection.revision);
        ownRevisions.set(key, revisions);
      }
      if (this.#storedState(mutation.agentId) === before) {
        addChanges(changes, mutation.agentId, this.#refusedChanges(mutation, previousMemory));
        continue;
      }
      affectedAgents.add(mutation.agentId);
      addChanges(changes, mutation.agentId, this.#committedChanges(mutation, previousMemory, previousIds));
    }
    for (const agentId of affectedAgents) this.stateChanged(agentId);
    return changes;
  }

  /**
   * The change that a skipped mutation did not make. A save or update whose text the agent already
   * holds, and a forget of a memory that is gone, lost nothing.
   */
  #refusedChanges(mutation: PendingMemoryMutation, previous: AgentMemory | null): ConversationMemoryChange[] {
    if (mutation.type === "selection") return [];
    if (mutation.type === "forget") {
      if (!previous || !this.#memories.get(mutation.agentId, mutation.memoryId)) return [];
      return [{ memoryId: previous.id, action: "notChanged", text: previous.text }];
    }
    if (this.#memories.list(mutation.agentId).some((memory) => memory.text === mutation.text)) return [];
    const memoryId = mutation.memoryId ?? mutation.duplicate?.memoryId ?? `unsaved-${mutation.callId}`;
    return [{ memoryId: memoryId.slice(0, INPUT_LIMITS.identifier), action: "notChanged", text: mutation.text }];
  }

  /** What one committed mutation did to the memory texts. A change of inclusion only is not shown. */
  #committedChanges(
    mutation: PendingMemoryMutation,
    previous: AgentMemory | null,
    previousIds: ReadonlySet<string> | null,
  ): ConversationMemoryChange[] {
    if (mutation.type === "selection") return [];
    if (mutation.type === "forget") {
      if (!previous || this.#memories.get(mutation.agentId, mutation.memoryId)) return [];
      return [{ memoryId: previous.id, action: "forgotten", text: previous.text }];
    }
    if (previous) {
      const current = this.#memories.get(mutation.agentId, previous.id);
      if (!current || current.text === previous.text) return [];
      return [{ memoryId: current.id, action: "updated", text: current.text, previousText: previous.text }];
    }
    return this.#memories
      .list(mutation.agentId)
      .filter((memory) => !previousIds?.has(memory.id))
      .map((memory) => ({ memoryId: memory.id, action: "saved" as const, text: memory.text }));
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

  #commitRemember(mutation: Extract<PendingMemoryMutation, { type: "remember" }>, createdMemories: Set<string>): void {
    this.#memories.withMemoryTransaction(() => {
      const duplicate = this.#memories
        .list(mutation.agentId)
        .find((memory) => memory.id !== mutation.memoryId && memory.text === mutation.text);
      const duplicateSelection = duplicate ? this.#memories.getSelection(mutation.agentId, duplicate.id) : null;
      if (mutation.duplicate) {
        if (
          duplicate?.id !== mutation.duplicate.memoryId ||
          duplicateSelection?.revision !== mutation.duplicate.expectedRevision
        )
          return;
      } else if (duplicate && !createdMemories.has(duplicate.id)) return;
      if (duplicateSelection?.userControlled && duplicateSelection.inclusion !== mutation.inclusion) return;
      if (mutation.memoryId) {
        const current = this.#memories.get(mutation.agentId, mutation.memoryId);
        const selection = this.#memories.getSelection(mutation.agentId, mutation.memoryId);
        if (
          !current ||
          !selection ||
          selection.revision !== mutation.expectedSelectionRevision ||
          (duplicate && selection.userControlled)
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
      });
      if (!memory) return;
      const selection = this.#memories.getSelection(mutation.agentId, memory.id);
      if (!selection || selection.inclusion === mutation.inclusion || selection.userControlled) return;
      const next = [...this.essentialFor(mutation.agentId), memory];
      // Another turn may have used the remaining budget. Keep the saved text searchable.
      if (mutation.inclusion === "essential" && essentialMemoryBytes(next) > AGENT_MEMORY_CONTEXT_BUDGET_BYTES) return;
      this.#memories.setInclusions(
        mutation.agentId,
        [{ memoryId: memory.id, inclusion: mutation.inclusion, expectedRevision: selection.revision }],
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
      if (
        !current ||
        changedElsewhere.has(mutation.memoryId) ||
        (current.updatedAt !== null &&
          mutation.expectedUpdatedAt !== undefined &&
          current.updatedAt !== mutation.expectedUpdatedAt)
      )
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

  /** A step of the turn's activity, so the chat shows that the agent looked in its memory. */
  #emitRecallProgress(params: DynamicToolCallParams, agentId: string, count: number): void {
    this.#emit({
      type: "turn-progress",
      agentId,
      threadId: this.#conversation.publicThreadId(agentId, params.threadId),
      turnId: params.turnId,
      detail: sourceText("status.agent.memoriesSearched", { count }),
    });
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
): { response: OpenBotToolResponse; count: number } {
  while (
    Buffer.byteLength(redact(JSON.stringify(result)), "utf8") > AGENT_MEMORY_CONTEXT_BUDGET_BYTES &&
    result.memories.length > 0
  ) {
    result.memories.pop();
    result.hasMore = true;
    if ("nextCursor" in result) result.nextCursor = result.memories.at(-1)?.id ?? null;
  }
  return {
    response: { success: true, contentItems: [{ type: "inputText", text: redact(JSON.stringify(result)) }] },
    count: result.memories.length,
  };
}

function addChanges(
  changes: Map<string, ConversationMemoryChange[]>,
  agentId: string,
  added: readonly ConversationMemoryChange[],
): void {
  if (added.length === 0) return;
  changes.set(agentId, [...(changes.get(agentId) ?? []), ...added]);
}
