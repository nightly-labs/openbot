import { randomUUID } from "node:crypto";
import { AGENT_MEMORY_CONTEXT_BUDGET_BYTES, essentialMemoryBytes } from "@openbot/contracts/agent-memory-context";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AgentMemory,
  AgentMemorySelection,
  AgentMemorySelectionChange,
  AgentMemorySelectionState,
  MemoryEntry,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Schema } from "effect";
import { initializeAgentMemorySelection } from "./agent-memory-selection";
import { databaseRows, requiredNumberColumn, requiredStringColumn } from "./database/database-rows";
import { MemoryStore, type MemoryTables, type SaveMemoryInput } from "./memory-store";
import type { OpenBotDatabase } from "./openbot-database";

export class AgentMemorySelectionError extends Schema.TaggedError<AgentMemorySelectionError>()(
  "AgentMemorySelectionError",
  {
    code: Schema.Literals(["budget", "conflict", "user-controlled", "query", "missing"]),
    message: Schema.String,
  },
) {}

export interface SaveAutomaticMemoryInput {
  agentId: string;
  memoryId?: string;
  text: string;
  sourceTurnId: string;
  expectedUpdatedAt?: string | null;
  expectedSelectionRevision?: number;
}

export interface RetrievedAgentMemory extends AgentMemory {
  inclusion: AgentMemorySelection["inclusion"];
  userControlled: boolean;
  revision: number;
}

export interface AgentMemorySearchResult {
  memories: RetrievedAgentMemory[];
  hasMore: boolean;
}

export interface AgentMemoryListPage extends AgentMemorySearchResult {
  nextCursor: string | null;
}

function agentMemoryTables(limit: () => number): MemoryTables {
  return {
    table: "projection_agent_memories",
    ownerColumn: "agent_id",
    aggregateType: "agent-memory",
    limit,
    limitMessage: (current) => sourceText("error.backend.agentMemoryLimit", { limit: current }),
  };
}

/** Owns saved agent memories, their selection, and local recall. Channel memories remain separate. */
export class AgentMemoryStore extends MemoryStore {
  constructor(database: OpenBotDatabase, limit: () => number = () => INPUT_LIMITS.agentMemories) {
    super(database, agentMemoryTables(limit));
  }

  override list(agentId: string): AgentMemory[] {
    return super.list(agentId).map((memory) => ({ ...memory, agentId }));
  }

  override get(agentId: string, memoryId: string): AgentMemory | null {
    const memory = super.get(agentId, memoryId);
    return memory && { ...memory, agentId };
  }

  override createManual(agentId: string, text: string): AgentMemory {
    return { ...super.createManual(agentId, text), agentId };
  }

  override duplicate(sourceAgentId: string, targetAgentId: string): AgentMemory[] {
    return this.withMemoryTransaction(() => {
      const source = this.listSelections(sourceAgentId);
      const originals = this.list(sourceAgentId);
      const copied = super.duplicate(sourceAgentId, targetAgentId);
      for (const [index, memory] of copied.entries()) {
        const selection = source.find((entry) => entry.memoryId === originals[index]?.id);
        if (selection)
          this.database.connection
            .prepare("UPDATE agent_memory_selections SET inclusion = ?, user_controlled = ? WHERE memory_id = ?")
            .run(selection.inclusion, Number(selection.userControlled), memory.id);
      }
      this.#assertBudget(targetAgentId);
      return copied.map((memory) => ({ ...memory, agentId: targetAgentId }));
    });
  }

  override updateManual(agentId: string, memoryId: string, text: string): AgentMemory {
    return { ...super.updateManual(agentId, memoryId, text), agentId };
  }

  saveAutomatic(input: SaveAutomaticMemoryInput): AgentMemory | null {
    if (
      input.memoryId &&
      input.expectedSelectionRevision !== undefined &&
      this.getSelection(input.agentId, input.memoryId)?.revision !== input.expectedSelectionRevision
    )
      return null;
    const memory = this.saveAutomaticEntry(input.agentId, input);
    return memory && { ...memory, agentId: input.agentId };
  }

  /** Dispatch reuses an existing transaction and otherwise owns commit and rollback. */
  withMemoryTransaction<T>(operation: () => T): T {
    // The wrapper receipt must not retain text after forget/clear removes the memory's own receipts.
    const output: { value?: { result: T } } = {};
    this.database.dispatch(`agent-memory:batch:${randomUUID()}`, [], () => {
      output.value = { result: operation() };
      return null;
    });
    if (!output.value) throw new Error("Memory transaction did not run.");
    return output.value.result;
  }

  listSelections(agentId: string): AgentMemorySelection[] {
    return databaseRows(
      this.database.connection
        .prepare(
          `SELECT s.memory_id, s.inclusion, s.user_controlled, s.revision FROM agent_memory_selections s
       JOIN projection_agent_memories m ON m.memory_id = s.memory_id WHERE m.agent_id = ? ORDER BY s.memory_id`,
        )
        .all(agentId),
    ).map((row) => {
      const inclusion = requiredStringColumn(row, "inclusion");
      if (inclusion !== "essential" && inclusion !== "searchable") throw new Error("Invalid memory inclusion.");
      return {
        memoryId: requiredStringColumn(row, "memory_id"),
        inclusion,
        userControlled: requiredNumberColumn(row, "user_controlled") === 1,
        revision: requiredNumberColumn(row, "revision"),
      };
    });
  }

  getSelection(agentId: string, memoryId: string): AgentMemorySelection | null {
    return this.listSelections(agentId).find((selection) => selection.memoryId === memoryId) ?? null;
  }

  selectionState(agentId: string): AgentMemorySelectionState {
    const selections = this.listSelections(agentId);
    const essentialIds = new Set(
      selections.filter((selection) => selection.inclusion === "essential").map((selection) => selection.memoryId),
    );
    return {
      selections,
      usedBytes: essentialMemoryBytes(this.list(agentId).filter((memory) => essentialIds.has(memory.id))),
      budgetBytes: AGENT_MEMORY_CONTEXT_BUDGET_BYTES,
    };
  }

  setInclusions(
    agentId: string,
    changes: readonly AgentMemorySelectionChange[],
    actor: "user" | "agent",
  ): AgentMemorySelectionState {
    return this.withMemoryTransaction(() => {
      const ids = new Set<string>();
      if (changes.length > 25)
        throw new AgentMemorySelectionError({
          code: "conflict",
          message: sourceText("error.backend.memorySelectionConflict"),
        });
      const updates: AgentMemorySelection[] = [];
      for (const change of changes) {
        const current = this.getSelection(agentId, change.memoryId);
        if (!current || current.revision !== change.expectedRevision || ids.has(change.memoryId)) {
          throw new AgentMemorySelectionError({
            code: "conflict",
            message: sourceText("error.backend.memorySelectionConflict"),
          });
        }
        ids.add(change.memoryId);
        if (actor === "agent" && (current.userControlled || change.inclusion === "automatic")) {
          throw new AgentMemorySelectionError({
            code: "user-controlled",
            message: sourceText("error.backend.memorySelectionUserControlled"),
          });
        }
        updates.push({
          memoryId: change.memoryId,
          inclusion: change.inclusion === "automatic" ? current.inclusion : change.inclusion,
          userControlled: actor === "user" && change.inclusion !== "automatic",
          revision: current.revision + 1,
        });
      }
      const updated = new Map(updates.map((entry) => [entry.memoryId, entry]));
      const essentialIds = new Set(
        this.listSelections(agentId)
          .map((entry) => updated.get(entry.memoryId) ?? entry)
          .filter((entry) => entry.inclusion === "essential")
          .map((entry) => entry.memoryId),
      );
      if (
        essentialMemoryBytes(this.list(agentId).filter((memory) => essentialIds.has(memory.id))) >
        AGENT_MEMORY_CONTEXT_BUDGET_BYTES
      ) {
        throw new AgentMemorySelectionError({
          code: "budget",
          message: sourceText("error.backend.memoryEssentialBudget"),
        });
      }
      for (const selection of updates) {
        this.database.connection
          .prepare(
            "UPDATE agent_memory_selections SET inclusion = ?, user_controlled = ?, revision = ? WHERE memory_id = ?",
          )
          .run(selection.inclusion, Number(selection.userControlled), selection.revision, selection.memoryId);
      }
      return this.selectionState(agentId);
    });
  }

  initializeSelection(agentId: string): void {
    this.withMemoryTransaction(() => {
      initializeAgentMemorySelection(this.database.connection, agentId);
      this.#assertBudget(agentId);
    });
  }

  search(agentId: string, query: string, limit = 5): AgentMemorySearchResult {
    const terms = query.match(/[\p{L}\p{N}\p{M}]+/gu) ?? [];
    if (query.length > 256 || terms.length === 0 || !Number.isInteger(limit) || limit < 1 || limit > 10) {
      throw new AgentMemorySelectionError({ code: "query", message: sourceText("error.backend.memorySearchQuery") });
    }
    const expression = [...new Set(terms)].map((term) => `"${term}"`).join(" OR ");
    const ids = databaseRows(
      this.database.connection
        .prepare(
          `SELECT m.memory_id FROM agent_memory_search JOIN projection_agent_memories m ON m.rowid = agent_memory_search.rowid
       WHERE agent_memory_search MATCH ? AND m.agent_id = ?
       ORDER BY bm25(agent_memory_search), m.updated_at DESC, m.memory_id LIMIT ?`,
        )
        .all(expression, agentId, limit + 1),
    ).map((row) => requiredStringColumn(row, "memory_id"));
    const result: AgentMemorySearchResult = { memories: [], hasMore: ids.length > limit };
    for (const id of ids.slice(0, limit)) {
      const memory = this.#retrieved(agentId, id);
      if (
        Buffer.byteLength(JSON.stringify({ memories: [...result.memories, memory], hasMore: false }), "utf8") >
        AGENT_MEMORY_CONTEXT_BUDGET_BYTES
      ) {
        result.hasMore = true;
        break;
      }
      result.memories.push(memory);
    }
    return result;
  }

  listPage(agentId: string, after: string | null = null): AgentMemoryListPage {
    const ids = databaseRows(
      this.database.connection
        .prepare(
          `SELECT memory_id FROM projection_agent_memories WHERE agent_id = ? AND (? IS NULL OR memory_id > ?)
       ORDER BY memory_id LIMIT 26`,
        )
        .all(agentId, after, after),
    ).map((row) => requiredStringColumn(row, "memory_id"));
    const result: AgentMemoryListPage = { memories: [], hasMore: ids.length > 25, nextCursor: null };
    for (const id of ids.slice(0, 25)) {
      const memory = this.#retrieved(agentId, id);
      if (
        Buffer.byteLength(
          JSON.stringify({ memories: [...result.memories, memory], hasMore: true, nextCursor: id }),
          "utf8",
        ) > AGENT_MEMORY_CONTEXT_BUDGET_BYTES
      ) {
        result.hasMore = true;
        break;
      }
      result.memories.push(memory);
    }
    result.nextCursor = result.hasMore ? (result.memories.at(-1)?.id ?? null) : null;
    return result;
  }

  protected override save(agentId: string, input: SaveMemoryInput): MemoryEntry {
    return this.withMemoryTransaction(() => {
      const duplicate = input.memoryId
        ? this.list(agentId).find((memory) => memory.id !== input.memoryId && memory.text === input.text.trim())
        : undefined;
      const mergeSelection =
        input.memoryId && duplicate ? this.#mergedSelection(agentId, input.memoryId, duplicate.id) : null;
      if (!duplicate && input.memoryId && this.getSelection(agentId, input.memoryId)?.inclusion === "essential") {
        const selections = new Set(
          this.listSelections(agentId)
            .filter((entry) => entry.inclusion === "essential")
            .map((entry) => entry.memoryId),
        );
        const proposed = this.list(agentId)
          .filter((memory) => selections.has(memory.id))
          .map((memory) =>
            memory.id === input.memoryId ? { ...memory, text: input.text.trim(), origin: input.origin } : memory,
          );
        if (essentialMemoryBytes(proposed) > AGENT_MEMORY_CONTEXT_BUDGET_BYTES) {
          throw new AgentMemorySelectionError({
            code: "budget",
            message: sourceText("error.backend.memoryEssentialBudget"),
          });
        }
      }
      const memory = super.save(agentId, input);
      if (mergeSelection) {
        this.database.connection
          .prepare(
            `UPDATE agent_memory_selections SET inclusion = ?, user_controlled = ?, revision = revision + 1
           WHERE memory_id = ?`,
          )
          .run(mergeSelection.inclusion, Number(mergeSelection.userControlled), memory.id);
        this.#assertBudget(agentId);
      }
      return memory;
    });
  }

  #mergedSelection(agentId: string, sourceId: string, targetId: string): AgentMemorySelection {
    const source = this.getSelection(agentId, sourceId);
    const target = this.getSelection(agentId, targetId);
    if (!source || !target)
      throw new AgentMemorySelectionError({ code: "missing", message: sourceText("error.backend.memoryGone") });
    if (source.userControlled && target.userControlled && source.inclusion !== target.inclusion) {
      throw new AgentMemorySelectionError({
        code: "conflict",
        message: sourceText("error.backend.memorySelectionConflict"),
      });
    }
    if (target.userControlled) return target;
    if (source.userControlled) return { ...source, memoryId: targetId };
    return { ...target, inclusion: source.inclusion === "essential" ? "essential" : target.inclusion };
  }

  #assertBudget(agentId: string): void {
    if (this.selectionState(agentId).usedBytes > AGENT_MEMORY_CONTEXT_BUDGET_BYTES) {
      throw new AgentMemorySelectionError({
        code: "budget",
        message: sourceText("error.backend.memoryEssentialBudget"),
      });
    }
  }

  #retrieved(agentId: string, memoryId: string): RetrievedAgentMemory {
    const memory = this.get(agentId, memoryId);
    const selection = this.getSelection(agentId, memoryId);
    if (!memory || !selection)
      throw new AgentMemorySelectionError({ code: "missing", message: sourceText("error.backend.memoryGone") });
    return {
      ...memory,
      inclusion: selection.inclusion,
      userControlled: selection.userControlled,
      revision: selection.revision,
    };
  }
}
