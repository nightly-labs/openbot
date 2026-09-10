// The seam that lets one memories modal serve an agent and a channel.
//
// Everything the modal renders is owner-agnostic; only the five calls, the event filter and three
// words of copy are not. They live here, so `AgentMemoriesModal` names no owner at all.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { MemoryEntry } from "@openbot/contracts/ipc";

export interface MemoriesPort {
  ownerId: string;
  /** The name the modal shows the user, such as `Chief` or `Project Falcon`. */
  ownerLabel: string;
  /** The word the modal reads in its sentences: "This agent has no saved memories yet." */
  ownerNoun: "agent" | "channel";
  limit: number;
  list: () => Promise<MemoryEntry[]>;
  create: (text: string) => Promise<void>;
  update: (memoryId: string, text: string) => Promise<void>;
  remove: (memoryId: string) => Promise<void>;
  clear: () => Promise<void>;
  /** Returns the unsubscribe function. The owner-id filter belongs to the port, not the modal. */
  subscribe: (reload: () => void) => () => void;
}

export function agentMemoriesPort(agentId: string, agentName: string): MemoriesPort {
  return {
    ownerId: agentId,
    ownerLabel: agentName,
    ownerNoun: "agent",
    limit: INPUT_LIMITS.agentMemories,
    list: () => window.openbot.agent.listMemories(agentId),
    create: async (text) => {
      await window.openbot.agent.createMemory({ agentId, text });
    },
    update: async (memoryId, text) => {
      await window.openbot.agent.updateMemory({ agentId, memoryId, text });
    },
    remove: (memoryId) => window.openbot.agent.deleteMemory({ agentId, memoryId }),
    clear: () => window.openbot.agent.clearMemories(agentId),
    subscribe: (reload) =>
      window.openbot.agent.onEvent((event) => {
        if (event.type === "memories-changed" && event.agentId === agentId) reload();
      }),
  };
}

export function channelMemoriesPort(channelId: string, channelName: string): MemoriesPort {
  return {
    ownerId: channelId,
    ownerLabel: channelName,
    ownerNoun: "channel",
    limit: INPUT_LIMITS.channelMemories,
    list: () => window.openbot.agent.listChannelMemories(channelId),
    create: async (text) => {
      await window.openbot.agent.createChannelMemory({ channelId, text });
    },
    update: async (memoryId, text) => {
      await window.openbot.agent.updateChannelMemory({ channelId, memoryId, text });
    },
    remove: (memoryId) => window.openbot.agent.deleteChannelMemory({ channelId, memoryId }),
    clear: () => window.openbot.agent.clearChannelMemories(channelId),
    subscribe: (reload) =>
      window.openbot.agent.onEvent((event) => {
        if (event.type === "channel-memories-changed" && event.channelId === channelId) reload();
      }),
  };
}
