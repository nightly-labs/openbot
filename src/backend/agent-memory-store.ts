import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AgentMemory } from "@openbot/contracts/ipc";
import { MemoryStore, type MemoryTables } from "./memory-store";
import type { OpenBotDatabase } from "./openbot-database";

export interface SaveAutomaticMemoryInput {
  agentId: string;
  memoryId?: string;
  text: string;
  sourceTurnId: string;
  expectedUpdatedAt?: string | null;
}

const AGENT_MEMORY_TABLES: MemoryTables = {
  table: "projection_agent_memories",
  ownerColumn: "agent_id",
  aggregateType: "agent-memory",
  limit: INPUT_LIMITS.agentMemories,
  limitMessage: `An agent can have up to ${INPUT_LIMITS.agentMemories} memories.`,
};

/**
 * All the SQL is in `MemoryStore`. This class only names the owner: it re-attaches `agentId` to
 * every row so `AgentMemory` keeps the exact shape its callers and IPC guards already expect.
 */
export class AgentMemoryStore extends MemoryStore {
  constructor(database: OpenBotDatabase) {
    super(database, AGENT_MEMORY_TABLES);
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
    return super.duplicate(sourceAgentId, targetAgentId).map((memory) => ({ ...memory, agentId: targetAgentId }));
  }

  override updateManual(agentId: string, memoryId: string, text: string): AgentMemory {
    return { ...super.updateManual(agentId, memoryId, text), agentId };
  }

  saveAutomatic(input: SaveAutomaticMemoryInput): AgentMemory | null {
    const memory = this.saveAutomaticEntry(input.agentId, input);
    return memory && { ...memory, agentId: input.agentId };
  }
}
