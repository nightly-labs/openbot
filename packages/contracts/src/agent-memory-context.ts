import type { MemoryEntry } from "./ipc-agent-memories";

export const AGENT_MEMORY_CONTEXT_BUDGET_BYTES = 8192;
type ContextMemory = Pick<MemoryEntry, "id" | "text" | "origin">;

/** One format for migration selection, mutation budgets, and provider instructions. */
export function serializeEssentialMemories(memories: readonly ContextMemory[]): string {
  const entries = memories.map(({ id, text, origin }) => ({ id, text, origin }));
  return `<agent_memories count="${entries.length}">\n${JSON.stringify(entries)}\n</agent_memories>`;
}

export function essentialMemoryBytes(memories: readonly ContextMemory[]): number {
  return new TextEncoder().encode(serializeEssentialMemories(memories)).byteLength;
}
