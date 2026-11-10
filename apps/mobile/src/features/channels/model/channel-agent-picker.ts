import { create } from "zustand";

/**
 * The agent list that the Agents row of the channel form opens. The form keeps the unsaved members,
 * so the list only starts from them and gives each change back to the form.
 */
export interface ChannelAgentPickerRequest {
  serverId: string;
  /** The agent ids of the members when the list opens. */
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
