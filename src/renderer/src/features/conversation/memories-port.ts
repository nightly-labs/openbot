// The seam that lets one memories page serve an agent and a channel.
//
// Everything the page renders is owner-agnostic; only the five calls, the event filter and three
// words of copy are not. They live here, so `AgentMemoriesSettings` names no owner at all.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AgentMemorySelectionState,
  MemoryEntry,
  OpenBotDesktopApi,
  SetAgentMemoryInclusionInput,
} from "@openbot/contracts/ipc";

export interface MemoriesPort {
  ownerId: string;
  /** The name the page shows the user, such as `Chief` or `Project Falcon`. */
  ownerLabel: string;
  /** The word the page reads in its sentences: "This agent has no saved memories yet." */
  ownerNoun: "agent" | "channel";
  /** Null when another computer holds the cap: its host refuses a memory past it. */
  limit: number | null;
  list: () => Promise<MemoryEntry[]>;
  selection?: {
    read: () => Promise<AgentMemorySelectionState | null>;
    set: (changes: SetAgentMemoryInclusionInput["changes"]) => Promise<AgentMemorySelectionState>;
  };
  create: (text: string) => Promise<void>;
  update: (memoryId: string, text: string) => Promise<void>;
  remove: (memoryId: string) => Promise<void>;
  clear: () => Promise<void>;
  /** Returns the unsubscribe function. The owner-id filter belongs to the port, not the page. */
  subscribe: (reload: () => void) => () => void;
}

/** The host calls an agent's memories make. The desktop sends them through preload. */
export type AgentMemoriesApi = Pick<
  OpenBotDesktopApi["agent"],
  | "listMemories"
  | "getMemorySelection"
  | "setMemoryInclusion"
  | "createMemory"
  | "updateMemory"
  | "deleteMemory"
  | "clearMemories"
  | "onEvent"
>;

export function agentMemoriesPort(
  agentId: string,
  agentName: string,
  limit: number | null,
  api: AgentMemoriesApi = window.openbot.agent,
): MemoriesPort {
  return {
    ownerId: agentId,
    ownerLabel: agentName,
    ownerNoun: "agent",
    limit,
    list: () => api.listMemories(agentId),
    selection: {
      read: () => api.getMemorySelection(agentId),
      set: (changes) => api.setMemoryInclusion({ agentId, changes }),
    },
    create: async (text) => {
      await api.createMemory({ agentId, text });
    },
    update: async (memoryId, text) => {
      await api.updateMemory({ agentId, memoryId, text });
    },
    remove: (memoryId) => api.deleteMemory({ agentId, memoryId }),
    clear: () => api.clearMemories(agentId),
    subscribe: (reload) =>
      api.onEvent((event) => {
        if (event.type === "memories-changed" && event.agentId === agentId) reload();
      }),
  };
}

/** The host calls a channel's memories make. The desktop sends them through preload. */
export type ChannelMemoriesApi = Pick<
  OpenBotDesktopApi["agent"],
  | "listChannelMemories"
  | "createChannelMemory"
  | "updateChannelMemory"
  | "deleteChannelMemory"
  | "clearChannelMemories"
  | "onEvent"
>;

export function channelMemoriesPort(
  channelId: string,
  channelName: string,
  api: ChannelMemoriesApi = window.openbot.agent,
): MemoriesPort {
  return {
    ownerId: channelId,
    ownerLabel: channelName,
    ownerNoun: "channel",
    limit: INPUT_LIMITS.channelMemories,
    list: () => api.listChannelMemories(channelId),
    create: async (text) => {
      await api.createChannelMemory({ channelId, text });
    },
    update: async (memoryId, text) => {
      await api.updateChannelMemory({ channelId, memoryId, text });
    },
    remove: (memoryId) => api.deleteChannelMemory({ channelId, memoryId }),
    clear: () => api.clearChannelMemories(channelId),
    subscribe: (reload) =>
      api.onEvent((event) => {
        if (event.type === "channel-memories-changed" && event.channelId === channelId) reload();
      }),
  };
}
