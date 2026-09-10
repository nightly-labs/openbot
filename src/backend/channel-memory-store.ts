import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { ChannelMemory } from "@openbot/contracts/ipc";
import { MemoryStore, type MemoryTables } from "./memory-store";
import type { OpenBotDatabase } from "./openbot-database";

const CHANNEL_MEMORY_TABLES: MemoryTables = {
  table: "projection_channel_memories",
  ownerColumn: "channel_id",
  aggregateType: "channel-memory",
  limit: INPUT_LIMITS.channelMemories,
  limitMessage: `A channel can have up to ${INPUT_LIMITS.channelMemories} memories.`,
};

/** The channel twin of `AgentMemoryStore`: the same `MemoryStore`, with a channel for an owner. */
export class ChannelMemoryStore extends MemoryStore {
  constructor(database: OpenBotDatabase) {
    super(database, CHANNEL_MEMORY_TABLES);
  }

  override list(channelId: string): ChannelMemory[] {
    return super.list(channelId).map((memory) => ({ ...memory, channelId }));
  }

  override get(channelId: string, memoryId: string): ChannelMemory | null {
    const memory = super.get(channelId, memoryId);
    return memory && { ...memory, channelId };
  }

  override createManual(channelId: string, text: string): ChannelMemory {
    return { ...super.createManual(channelId, text), channelId };
  }

  override updateManual(channelId: string, memoryId: string, text: string): ChannelMemory {
    return { ...super.updateManual(channelId, memoryId, text), channelId };
  }

  /**
   * A channel tool writes at call time, so there is no `expectedUpdatedAt` race to guard. `commandId`
   * is the call's own receipt key: a retried tool call reads it and saves nothing more.
   */
  saveFromTool(channelId: string, text: string, sourceTurnId: string, commandId: string): ChannelMemory {
    const memory = this.saveAutomaticEntry(channelId, { text, sourceTurnId, commandId });
    if (!memory) throw new Error("This memory no longer exists.");
    return { ...memory, channelId };
  }

  /** `channel_forget_memory` names the text, not an id: the model never sees a memory id. */
  deleteByText(channelId: string, text: string): boolean {
    const target = text.trim();
    const memory = this.list(channelId).find((entry) => entry.text === target);
    return memory ? this.delete(channelId, memory.id) : false;
  }
}
