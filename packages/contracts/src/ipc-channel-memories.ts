import { INPUT_LIMITS } from "./input-limits";
import { isMemoryEntry, type MemoryEntry } from "./ipc-agent-memories";
import { isDynamicRecord, isString } from "./runtime-values";

/** A channel memory is an agent memory with a channel for an owner. Same shape, same limits. */
export interface ChannelMemory extends MemoryEntry {
  channelId: string;
}

export function isChannelMemory(value: unknown): value is ChannelMemory {
  return (
    isDynamicRecord(value) &&
    isMemoryEntry(value) &&
    isString(value.channelId) &&
    value.channelId.length > 0 &&
    value.channelId.length <= INPUT_LIMITS.identifier
  );
}

export function decodeChannelMemory(value: unknown): ChannelMemory {
  if (!isChannelMemory(value)) throw new Error("Invalid channel memory response.");
  return value;
}

export function decodeChannelMemories(value: unknown): ChannelMemory[] {
  if (!Array.isArray(value) || !value.every(isChannelMemory)) throw new Error("Invalid channel memory response.");
  return value;
}

export interface CreateChannelMemoryInput {
  channelId: string;
  text: string;
}

export interface UpdateChannelMemoryInput {
  channelId: string;
  memoryId: string;
  text: string;
}

export interface DeleteChannelMemoryInput {
  channelId: string;
  memoryId: string;
}
