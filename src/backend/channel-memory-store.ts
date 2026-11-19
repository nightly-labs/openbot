import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { ChannelMemory } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { MemoryStore, type MemoryTables } from "./memory-store";
import type { OpenBotDatabase } from "./openbot-database";

const CHANNEL_MEMORY_TABLES: MemoryTables = {
  table: "projection_channel_memories",
  ownerColumn: "channel_id",
  ownerKey: "channelId",
  aggregateType: "channel-memory",
  limit: () => INPUT_LIMITS.channelMemories,
  limitMessage: (limit) => sourceText("error.backend.channelMemoryLimit", { limit }),
};

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

  saveFromTool(channelId: string, text: string, sourceTurnId: string, commandId: string): ChannelMemory {
    const memory = this.saveAutomaticEntry(channelId, { text, sourceTurnId, commandId });
    if (!memory) throw new Error(sourceText("error.backend.memoryGone"));
    return { ...memory, channelId };
  }

  deleteByText(channelId: string, text: string): boolean {
    const target = text.trim();
    const entries = this.list(channelId);
    const exact = entries.find((entry) => entry.text === target);
    const memory = exact ?? entries.find((entry) => entry.text.toLowerCase() === target.toLowerCase());
    return memory ? this.delete(channelId, memory.id) : false;
  }
}
