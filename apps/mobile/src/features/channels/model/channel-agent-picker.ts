import { create } from "zustand";

export interface ChannelAgentPickerRequest {
  serverId: string;
  members: readonly string[];
  toggle: (agentId: string) => void;
}

export const useChannelAgentPicker = create<{
  request: ChannelAgentPickerRequest | null;
  open: (request: ChannelAgentPickerRequest) => void;
}>((set) => ({
  request: null,
  open: (request) => set({ request }),
}));
