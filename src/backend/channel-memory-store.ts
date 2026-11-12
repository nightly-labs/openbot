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
    if (!memory) throw new Error(sourceText("error.backend.memoryGone"));
    return { ...memory, channelId };
  }

  /**
   * The fallback of `channel_forget_memory` when it has no `memoryId`. An exact, case-sensitive
   * match wins first: `MemoryStore#save` does not merge entries that differ only by case, so two
   * such entries can coexist, and forgetting one must not delete the other instead. Then a
   * case-insensitive match, since a model retypes the fact rather than copying it verbatim. Last, a
   * match that also ignores line breaks, full-width forms, quote and dash styles, because the packet
   * shows each memory on one line and a model rewrites punctuation (#7428). That match must select
   * exactly one memory: no part of a text selects a memory.
   */
  deleteByText(channelId: string, text: string): boolean {
    const target = text.trim();
    const entries = this.list(channelId);
    const exact = entries.find((entry) => entry.text === target);
    const folded = foldMemoryText(target);
    const similar = entries.filter((entry) => foldMemoryText(entry.text) === folded);
    const memory =
      exact ??
      entries.find((entry) => entry.text.toLowerCase() === target.toLowerCase()) ??
      (similar.length === 1 ? similar[0] : undefined);
    return memory ? this.delete(channelId, memory.id) : false;
  }
}

/** Compatibility forms (full-width punctuation, `…`), quote and dash styles, whitespace, and case. */
function foldMemoryText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u2018-\u201f"`]/gu, "'")
    .replace(/[\u2010-\u2015\u2212]/gu, "-")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}
