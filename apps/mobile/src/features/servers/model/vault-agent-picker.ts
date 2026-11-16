import { create } from "zustand";

/**
 * The agent list that the Agents row of a Vault item opens. The item form keeps the unsaved agents,
 * so the list only starts from them and gives each change back to the form.
 */
export interface VaultAgentPickerRequest {
  serverId: string;
  /** The agents when the list opens: null is every agent, also each agent that is added later. */
  agents: readonly string[] | null;
  onChange: (agents: string[] | null) => void;
}

export const useVaultAgentPicker = create<{
  request: VaultAgentPickerRequest | null;
  open: (request: VaultAgentPickerRequest) => void;
}>((set) => ({
  request: null,
  open: (request) => set({ request }),
}));
